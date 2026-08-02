import re
import sys
import json
import subprocess
from pathlib import Path

from utils import FFMPEG, FFPROBE

BASE_DIR = Path(__file__).resolve().parent.parent

if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
else:
    WORKING_DIR = BASE_DIR

DOWNLOADS = WORKING_DIR / "downloads"
TIMELINE = WORKING_DIR / "timeline.json"

# -------------------------------------------------------
# Smart-trim tuning
# -------------------------------------------------------
# Fraction of the source clip to treat as "intro"/"outro" and avoid picking
# a start point from, so we don't just anchor on the very first cut either.
EDGE_MARGIN_RATIO = 0.10
# Scene-change thresholds to try, from most to least selective. ffmpeg's
# `scene` score is 0-1; higher = bigger visual change between frames.
SCENE_THRESHOLDS = [0.35, 0.2, 0.1]


def get_duration(file):
    try:
        result = subprocess.check_output([
            str(FFPROBE),
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file)
        ])
        return float(result.strip())
    except Exception as e:
        print(f"⚠️ Error probing duration for {file}: {e}")
        return 0.0


def detect_scene_change_times(source, threshold):
    """Runs ffmpeg's scene-change detector and returns a list of timestamps
    (in seconds) where the frame-to-frame visual change exceeds `threshold`.
    Returns an empty list if none are found or detection fails."""
    cmd = [
        str(FFMPEG),
        "-i", str(source),
        "-vf", f"select='gt(scene,{threshold})',showinfo",
        "-f", "null", "-",
    ]
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except Exception as e:
        print(f"⚠️ Scene detection failed for {source}: {e}")
        return []

    return [float(m) for m in re.findall(r"pts_time:(\d+\.?\d*)", result.stderr)]


def pick_smart_start(source, source_duration, needed_duration):
    """Chooses a start offset that centers the trim window on the most
    visually interesting moment available, instead of always taking the
    first `needed_duration` seconds. Falls back to the clip's midpoint if
    no usable scene-change data is found."""
    if source_duration <= 0 or source_duration <= needed_duration:
        return 0.0

    margin = min(source_duration * EDGE_MARGIN_RATIO, source_duration / 2)
    window_start = margin
    window_end = max(margin, source_duration - needed_duration - margin)

    fallback_start = max(0.0, (source_duration - needed_duration) / 2)

    if window_start >= window_end:
        print("   ↳ clip too short for edge margins, using midpoint")
        return fallback_start

    for threshold in SCENE_THRESHOLDS:
        candidates = [
            t for t in detect_scene_change_times(source, threshold)
            if window_start <= t <= window_end
        ]
        if candidates:
            # Prefer the change closest to the middle of the usable window,
            # so the clip has some "lead-in" before and after the cut.
            window_mid = (window_start + window_end) / 2
            anchor = min(candidates, key=lambda t: abs(t - window_mid))
            start = anchor - (needed_duration / 2)
            start = max(0.0, min(start, source_duration - needed_duration))
            print(
                f"   ↳ scene change at {anchor:.2f}s (threshold={threshold}) "
                f"-> trimming from {start:.2f}s"
            )
            return start

    print("   ↳ no clear scene changes detected, using midpoint")
    return fallback_start


if not TIMELINE.exists():
    raise FileNotFoundError(f"Timeline missing: {TIMELINE}")

with open(TIMELINE, "r", encoding="utf8") as f:
    timeline_data = json.load(f)

clips = timeline_data.get("clips", [])
asset_types = timeline_data.get("asset_types", {})

# -------------------------------------------------------
# Filename key compatibility
# -------------------------------------------------------
# timeline.json is written by create_timeline.py, which stores the chosen
# asset under the "video" key as a path already relative to WORKING_DIR
# (e.g. "downloads/clip3.mp4") — not a bare filename. Older/alternate
# writers may use "file"/"clip"/"filename" with just a bare filename
# relative to DOWNLOADS instead. Handle both shapes.
FILENAME_KEYS = ("video", "file", "clip", "filename")


def get_clip_reference(clip):
    for key in FILENAME_KEYS:
        value = clip.get(key)
        if value:
            return value
    return None


def resolve_clip_source(reference):
    """Returns (source_path, asset_type_lookup_key). `reference` may be a
    bare filename ("clip3.mp4") or a path already including the downloads
    folder ("downloads/clip3.mp4") — asset_types is keyed on whatever exact
    string form create_timeline.py used, so we check both forms."""
    ref_path = Path(reference)

    if ref_path.is_absolute():
        source = ref_path
    elif len(ref_path.parts) > 1:
        # already includes a folder component, e.g. "downloads/clip3.mp4"
        source = WORKING_DIR / ref_path
    else:
        # bare filename, assumed to live directly under downloads/
        source = DOWNLOADS / ref_path

    return source, ref_path.name


# Validate every clip up front, before any ffmpeg work starts, so a bad
# timeline entry fails immediately with a clear report instead of after
# several clips have already been processed.
missing = [
    (i, clip) for i, clip in enumerate(clips, start=1) if not get_clip_reference(clip)
]
if missing:
    details = "\n".join(f"  Scene {i}: {clip}" for i, clip in missing)
    raise KeyError(
        f"{len(missing)} clip(s) in timeline.json have no asset reference under any of "
        f"{FILENAME_KEYS}. Check what key create_timeline.py is writing "
        f"the chosen asset under:\n{details}"
    )

print("\n==========================")
print("TIMELINE VALIDATION")
print("==========================\n")

# Calculate total timeline duration to decide project aspect ratio globally
total_duration = 0.0
for clip in clips:
    duration = float(clip.get("duration", 0))
    total_duration += duration
    print(f"Scene {clip.get('scene')}: {get_clip_reference(clip)} | Duration: {duration:.2f}s")

# Global Output Target Configuration
FPS = 30
if total_duration > 60.0:
    WIDTH = 1920
    HEIGHT = 1080
    layout_mode = "LONG-FORM (16:9 Widescreen)"
else:
    WIDTH = 1080
    HEIGHT = 1920
    layout_mode = "SHORTS (9:16 Vertical)"

print(f"\n📊 Total Video Duration: {total_duration:.2f}s -> Configured Layout: {layout_mode}")
print(f"🎬 Preparing {len(clips)} clips at {WIDTH}x{HEIGHT}...\n")

def run_ffmpeg(cmd):
    """Runs ffmpeg, capturing combined stdout+stderr so we can inspect the
    actual error text afterward instead of guessing from a numeric return
    code (which ffmpeg/x264 reports inconsistently depending on *where* in
    the pipeline a failure occurs — we've seen -12 for one memory failure
    and -542398533 'Generic error in an external library' for another).
    Output is printed either way so nothing is lost from the console."""
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    print(result.stdout)
    return result.returncode, result.stdout


def looks_like_memory_error(output: str) -> bool:
    text = output.lower()
    return (
        "malloc" in text
        or "cannot allocate memory" in text
        or "error while opening encoder" in text
    )


for index, clip in enumerate(clips, start=1):
    reference = get_clip_reference(clip)
    source, basename = resolve_clip_source(reference)

    if not source.exists():
        raise FileNotFoundError(f"Source file not found: {source}")

    duration = float(clip["duration"])
    output = DOWNLOADS / f"trimmed{index}.mp4"
    # asset_types is keyed on whatever exact string create_timeline.py used
    # when it wrote this clip (e.g. "downloads/clip3.mp4"), so check that
    # exact form first, then fall back to just the bare filename.
    asset_type = asset_types.get(reference) or asset_types.get(basename)

    print(f"⚙️ Processing Scene {index}/{len(clips)}: {basename} ({asset_type or 'video'}) | {duration:.2f}s")

    # -------------------------------------------------
    # Encoder memory safety
    # -------------------------------------------------
    # `-threads N` placed before -i only constrains demux/decode threads —
    # it does NOT cap libx264's own internal thread pool, which otherwise
    # auto-detects the CPU core count (seen in logs as e.g. "threads=18")
    # regardless of that flag. On high-resolution source clips (4K-ish
    # vertical stock footage), that many encoder threads each holding their
    # own frame buffers plus a 20-frame lookahead window can exhaust
    # available memory and crash with "malloc ... failed" / "Cannot
    # allocate memory", especially under any concurrent system memory
    # pressure. -x264-params is the option that actually reaches the
    # encoder's own thread/lookahead settings.
    X264_PARAMS_NORMAL = "threads=2:lookahead_threads=1:rc-lookahead=10"
    # Used only if the normal attempt fails with an OOM-shaped error: strip
    # this down further (single thread, no lookahead, no B-frames) to
    # minimize memory footprint even at some encoding-efficiency cost.
    X264_PARAMS_LOW_MEMORY = "threads=1:lookahead_threads=0:rc-lookahead=0:bframes=0"

    # -------------------------------------------------
    # IMAGE PROCESSING (With Adaptive Zoompan Framework)
    # -------------------------------------------------
    if asset_type == "image":
        # Calculate dynamic zoom limits safely for both aspect ratios
        zoom_filter = (
            f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},"
            f"zoompan=z='min(zoom+0.0007,1.15)':d={max(1, int(duration * FPS))}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',"
            f"scale={WIDTH}:{HEIGHT},fps={FPS}"
        )

        def build_cmd(x264_params):
            return [
                str(FFMPEG),
                "-y",
                "-threads", "2",
                "-loop", "1",
                "-t", str(duration),
                "-i", str(source),
                "-vf", zoom_filter,
                "-pix_fmt", "yuv420p",
                "-c:v", "libx264",
                "-preset", "faster",
                "-x264-params", x264_params,
                str(output),
            ]

        def build_cmd_plain():
            # Last-resort fallback: no -x264-params override at all, in
            # case that flag itself (rather than genuine memory pressure)
            # is what this particular ffmpeg/x264 build doesn't like.
            return [
                str(FFMPEG),
                "-y",
                "-threads", "1",
                "-loop", "1",
                "-t", str(duration),
                "-i", str(source),
                "-vf", zoom_filter,
                "-pix_fmt", "yuv420p",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                str(output),
            ]

    # -------------------------------------------------
    # VIDEO PROCESSING (Smart trim: center on the most
    # visually interesting moment instead of the first N seconds)
    # -------------------------------------------------
    else:
        source_duration = get_duration(source)
        start_time = pick_smart_start(source, source_duration, duration)

        # Two-stage seek: a single -ss before -i jumps straight to the
        # nearest keyframe at/before start_time and asks the decoder to
        # start cold from there. On stock footage with sparse or irregular
        # GOPs that's often not a clean keyframe in practice, producing
        # "no frame!" / "Invalid data found" / missing-reference-picture
        # errors while the decoder scrambles to recover.
        #
        # Instead: seek coarsely to a couple seconds *before* the real
        # target (still before -i, so it's fast), let the decoder run from
        # an actual keyframe for a moment to warm up its reference frames,
        # then do a second, frame-accurate -ss *after* -i for the exact
        # remaining offset.
        COARSE_SEEK_LEAD = 2.0
        coarse_start = max(0.0, start_time - COARSE_SEEK_LEAD)
        precise_offset = round(start_time - coarse_start, 3)

        def build_cmd(x264_params):
            return [
                str(FFMPEG),
                "-y",
                "-threads", "2",
                "-err_detect", "ignore_err",   # tolerate minor corruption in the source instead of aborting
                "-fflags", "+discardcorrupt",
                "-ss", str(coarse_start),      # coarse, keyframe-level seek (fast, before -i)
                "-i", str(source),
                "-ss", str(precise_offset),    # precise, frame-accurate seek from the warm decoder state
                "-t", str(duration),
                "-vf", (
                    f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                    f"crop={WIDTH}:{HEIGHT},"
                    f"fps={FPS}"
                ),
                "-an",
                "-c:v", "libx264",
                "-preset", "faster",
                "-pix_fmt", "yuv420p",
                "-x264-params", x264_params,
                str(output),
            ]

        def build_cmd_plain():
            # Last-resort fallback: no -x264-params override at all, in
            # case that flag itself (rather than genuine memory pressure)
            # is what this particular ffmpeg/x264 build doesn't like.
            return [
                str(FFMPEG),
                "-y",
                "-threads", "1",
                "-err_detect", "ignore_err",
                "-fflags", "+discardcorrupt",
                "-ss", str(coarse_start),
                "-i", str(source),
                "-ss", str(precise_offset),
                "-t", str(duration),
                "-vf", (
                    f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                    f"crop={WIDTH}:{HEIGHT},"
                    f"fps={FPS}"
                ),
                "-an",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-pix_fmt", "yuv420p",
                str(output),
            ]


    # Execute the normalization pipeline, retrying with progressively more
    # conservative encode profiles if the attempt fails with what looks
    # like a memory-related encoder error, instead of failing the whole
    # pipeline outright. Detection is based on the actual ffmpeg output
    # text, not the numeric return code, since that code varies depending
    # on where in the pipeline the failure surfaces.
    attempts = [
        ("normal", build_cmd(X264_PARAMS_NORMAL)),
        ("low-memory", build_cmd(X264_PARAMS_LOW_MEMORY)),
        ("plain fallback (no x264-params override)", build_cmd_plain()),
    ]

    returncode, ffmpeg_log = None, ""
    for attempt_index, (label, attempt_cmd) in enumerate(attempts):
        if attempt_index > 0:
            print(f"⚠️ Scene {index}: retrying with the '{label}' encode profile...")

        returncode, ffmpeg_log = run_ffmpeg(attempt_cmd)

        if returncode == 0:
            break

        if not looks_like_memory_error(ffmpeg_log):
            raise subprocess.CalledProcessError(returncode, attempt_cmd, output=ffmpeg_log)

    if returncode != 0:
        raise subprocess.CalledProcessError(returncode, attempts[-1][1], output=ffmpeg_log)

print("\n✅ All clips successfully prepared and normalized.")