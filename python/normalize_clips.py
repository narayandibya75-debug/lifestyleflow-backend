import re
import sys
import json
import subprocess
from utils import FFMPEG, FFPROBE
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------
# Working directory
# ---------------------------------------------------
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

DOWNLOADS = WORKING_DIR / "downloads"
TIMELINE_FILE = WORKING_DIR / "timeline.json"

if not TIMELINE_FILE.exists():
    raise FileNotFoundError(f"Timeline not found: {TIMELINE_FILE}")

with open(TIMELINE_FILE, encoding="utf-8") as f:
    timeline_data = json.load(f)
    timeline = timeline_data["clips"]

# ---------------------------------------------------
# Normalization targets
# ---------------------------------------------------
FPS = 30

# Consistent output data rate so clips pulled from different stock sources
# (different original bitrates/codecs) don't sit unevenly next to each
# other after concatenation.
TARGET_BITRATE = "6M"
TARGET_BUFSIZE = "12M"

# Brightness is measured per-clip (via ffmpeg's signalstats) and nudged
# toward this target mean luma (0-255 scale), clamped so no single clip
# gets pushed to an unnatural extreme.
TARGET_BRIGHTNESS = 128.0
BRIGHTNESS_MAX_ADJUST = 0.15  # eq=brightness range is roughly -1..1

# Saturation isn't measured per-clip here (that needs an HSV pass, not just
# signalstats) — this is a flat, consistent nudge applied to every clip so
# the palette reads the same across sources. Set to 1.0 to disable.
TARGET_SATURATION = 1.05

# These clips are muted downstream anyway (final audio is the narration
# track mixed in video.py), so loudness normalization is a no-op unless you
# flip this on to keep and normalize each clip's original ambient audio.
KEEP_SOURCE_AUDIO = False
TARGET_LOUDNESS_LUFS = -16.0


def measure_avg_brightness(source):
    """Runs ffmpeg's signalstats filter over the clip and returns the mean
    luma (YAVG, 0-255) across sampled frames, or None if it can't be read."""
    cmd = [
        str(FFMPEG),
        "-i", str(source),
        "-vf", "signalstats,metadata=print",
        "-f", "null", "-",
    ]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
    except Exception as e:
        print(f"   ⚠️ Brightness probe failed: {e}")
        return None

    values = [float(v) for v in re.findall(r"lavfi\.signalstats\.YAVG=([\d.]+)", result.stdout)]
    if not values:
        return None
    return sum(values) / len(values)


def compute_brightness_adjustment(avg_brightness):
    if avg_brightness is None:
        return 0.0
    diff = (TARGET_BRIGHTNESS - avg_brightness) / 255.0
    return max(-BRIGHTNESS_MAX_ADJUST, min(BRIGHTNESS_MAX_ADJUST, diff))


# ---------------------------------------------------
# Calculate Total Duration to Determine Layout Mode
# ---------------------------------------------------
total_duration = sum(float(clip.get("duration", 0)) for clip in timeline)

if total_duration > 60.0:
    WIDTH = 1920
    HEIGHT = 1080
    layout_mode = "LONG-FORM VIDEO (16:9 Widescreen)"
else:
    WIDTH = 1080
    HEIGHT = 1920
    layout_mode = "YOUTUBE SHORTS (9:16 Vertical)"

print(f"📊 Total Video Duration: {total_duration:.2f}s -> Layout: {layout_mode}")
print(f"🎬 Normalizing {len(timeline)} clips to resolution {WIDTH}x{HEIGHT}...")

def run_ffmpeg(cmd):
    """Runs ffmpeg, capturing combined stdout+stderr so we can inspect the
    actual error text afterward instead of guessing from a numeric return
    code (ffmpeg/x264 reports these inconsistently depending on *where* in
    the pipeline a failure occurs). Output is printed either way so nothing
    is lost from the console."""
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    print(result.stdout)
    return result.returncode, result.stdout


def looks_like_memory_error(text: str) -> bool:
    text = text.lower()
    return (
        "malloc" in text
        or "cannot allocate memory" in text
        or "error while opening encoder" in text
    )


# `-threads N` before -i only caps demux/decode threads, not libx264's own
# internal thread pool (which otherwise auto-detects the CPU core count —
# seen in logs as "threads=18" regardless of that flag). Combined with a
# 20-frame lookahead and a 12MB vbv buffer, that's enough concurrent memory
# to fail with "malloc ... failed" / "Generic error in an external library"
# under system memory pressure. -x264-params is what actually reaches the
# encoder's own thread/lookahead/buffer settings.
X264_PARAMS_NORMAL = "threads=2:lookahead_threads=1:rc-lookahead=10"
X264_PARAMS_LOW_MEMORY = "threads=1:lookahead_threads=0:rc-lookahead=0:bframes=0"

# ---------------------------------------------------
# Normalization Pipeline Loop
# ---------------------------------------------------
for index, clip in enumerate(timeline, start=1):

    source = DOWNLOADS / f"trimmed{index}.mp4"

    if not source.exists():
        raise FileNotFoundError(f"Missing expected source: {source}")

    output = DOWNLOADS / f"norm_trimmed{index}.mp4"
    duration = float(clip.get("duration", 0))

    print(f"⚙️ Normalizing Scene {index}/{len(timeline)} ({duration:.2f}s)")

    avg_brightness = measure_avg_brightness(source)
    brightness_adj = compute_brightness_adjustment(avg_brightness)
    if avg_brightness is not None:
        print(f"   ↳ measured brightness {avg_brightness:.1f}/255 -> eq brightness {brightness_adj:+.3f}")
    else:
        print("   ↳ brightness unmeasured, leaving unadjusted")

    video_filter = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={WIDTH}:{HEIGHT},"
        f"eq=brightness={brightness_adj:.4f}:saturation={TARGET_SATURATION},"
        f"fps={FPS}"
    )

    def add_audio_args(cmd):
        if KEEP_SOURCE_AUDIO:
            cmd += [
                "-af", f"loudnorm=I={TARGET_LOUDNESS_LUFS}:TP=-1.5:LRA=11",
                "-c:a", "aac",
                "-b:a", "192k",
            ]
        else:
            cmd += ["-an"]  # Drops audio to ensure clean concatenation downstream
        return cmd

    def build_cmd(x264_params):
        cmd = [
            str(FFMPEG),
            "-y",
            "-threads", "2",
            "-t", str(duration),
            "-i", str(source),

            "-vf", video_filter,

            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",

            "-preset", "faster",
            "-crf", "18",
            "-b:v", TARGET_BITRATE,       # Consistent data rate across all sourced clips
            "-maxrate", TARGET_BITRATE,
            "-bufsize", TARGET_BUFSIZE,
            "-x264-params", x264_params,
        ]
        return add_audio_args(cmd) + [str(output)]

    def build_cmd_low_memory(x264_params):
        # Drops the vbv rate-control buffer (-b:v/-maxrate/-bufsize) too,
        # since that buffer is itself extra memory the encoder has to hold
        # onto; crf-only encoding needs less of it.
        cmd = [
            str(FFMPEG),
            "-y",
            "-threads", "2",
            "-t", str(duration),
            "-i", str(source),

            "-vf", video_filter,

            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",

            "-preset", "faster",
            "-crf", "18",
            "-x264-params", x264_params,
        ]
        return add_audio_args(cmd) + [str(output)]

    def build_cmd_plain():
        # Last-resort fallback: no -x264-params override, no vbv buffer,
        # single thread, fastest preset — in case the flags themselves
        # (rather than genuine memory pressure) are what this particular
        # ffmpeg/x264 build doesn't like.
        cmd = [
            str(FFMPEG),
            "-y",
            "-threads", "1",
            "-t", str(duration),
            "-i", str(source),

            "-vf", video_filter,

            "-pix_fmt", "yuv420p",
            "-c:v", "libx264",

            "-preset", "ultrafast",
            "-crf", "23",
        ]
        return add_audio_args(cmd) + [str(output)]

    attempts = [
        ("normal", build_cmd(X264_PARAMS_NORMAL)),
        ("low-memory", build_cmd_low_memory(X264_PARAMS_LOW_MEMORY)),
        ("plain fallback (no x264-params, no vbv buffer)", build_cmd_plain()),
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

print("\n✅ All clips successfully normalized.")