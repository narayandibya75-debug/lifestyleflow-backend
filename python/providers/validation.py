# python/providers/validation.py
#
# After any provider claims success, we verify the output ourselves rather
# than trusting the provider's return value alone — a provider could return
# True with a truncated, zero-duration, or corrupt file. Any failure here
# sends the scene to the next fallback tier instead of poisoning the final
# render with a broken clip.

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from utils import FFPROBE

MIN_FILE_SIZE_BYTES = 50_000  # anything smaller is almost certainly a truncated/error response


@dataclass
class ValidationResult:
    valid: bool
    reason: str = ""


def _probe(path: Path) -> Optional[dict]:
    try:
        result = subprocess.run(
            [
                str(FFPROBE),
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def validate_video_clip(
    path: Path,
    expected_duration: Optional[float] = None,
    min_width: int = 0,
    min_height: int = 0,
    duration_tolerance: float = 3.0,
) -> ValidationResult:
    """Validates a generated/downloaded video clip.

    Checks (in order, cheapest first): file exists, non-zero/non-trivial
    size, ffprobe can open it (playable), it has a video stream with a
    sane resolution, and — if `expected_duration` is given — the clip is
    at least long enough to trim down to that duration.
    """
    if not path.exists():
        return ValidationResult(False, "file does not exist")

    size = path.stat().st_size
    if size < MIN_FILE_SIZE_BYTES:
        return ValidationResult(False, f"file too small ({size} bytes)")

    probe = _probe(path)
    if probe is None:
        return ValidationResult(False, "file is not playable (ffprobe could not open it)")

    video_streams = [s for s in probe.get("streams", []) if s.get("codec_type") == "video"]
    if not video_streams:
        return ValidationResult(False, "no video stream found")

    stream = video_streams[0]
    width = int(stream.get("width", 0) or 0)
    height = int(stream.get("height", 0) or 0)

    if width <= 0 or height <= 0:
        return ValidationResult(False, "invalid resolution reported by ffprobe")

    if min_width and width < min_width:
        return ValidationResult(False, f"resolution too low ({width}x{height})")
    if min_height and height < min_height:
        return ValidationResult(False, f"resolution too low ({width}x{height})")

    duration = float(probe.get("format", {}).get("duration", 0) or 0)
    if duration <= 0:
        return ValidationResult(False, "zero or unknown duration")

    if expected_duration:
        # A clip longer than the scene needs is completely normal for stock
        # footage (and most AI providers don't hit an exact duration
        # either) — trim_clips.py's smart-trim step picks the best window
        # out of a longer clip downstream. Only reject a clip that's too
        # SHORT to trim from; there is no such thing as "too long" here.
        min_acceptable = expected_duration - duration_tolerance
        if duration < min_acceptable:
            return ValidationResult(
                False,
                f"clip too short to use (got {duration:.1f}s, need at least "
                f"~{min_acceptable:.1f}s for a {expected_duration:.1f}s scene)",
            )

    return ValidationResult(True)


def validate_image(path: Path) -> ValidationResult:
    """Lighter-weight validation for still-frame fallback assets (used by
    the Stability AI image fallback, and any future image-only provider)."""
    if not path.exists():
        return ValidationResult(False, "file does not exist")

    size = path.stat().st_size
    if size < 10_000:
        return ValidationResult(False, f"file too small ({size} bytes)")

    return ValidationResult(True)