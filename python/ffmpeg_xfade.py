import sys
import json
import subprocess
from utils import FFMPEG, FFPROBE
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# -------------------------------------------------------
# Working directory configuration
# -------------------------------------------------------
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

DOWNLOADS = WORKING_DIR / "downloads"
TIMELINE_FILE = WORKING_DIR / "timeline.json"
OUTPUT = DOWNLOADS / "merged_transition.mp4"

TRANSITION = 0.4

if not TIMELINE_FILE.exists():
    raise FileNotFoundError(f"Timeline configuration missing: {TIMELINE_FILE}")

with open(TIMELINE_FILE, encoding="utf-8") as f:
    clips = json.load(f)["clips"]

if len(clips) == 0:
    raise Exception("Timeline contains no clips to process.")

# -------------------------------------------------------
# Duration Probing Helper
# -------------------------------------------------------
def get_real_duration(file_path):
    try:
        result = subprocess.check_output([
            str(FFPROBE),
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ])
        return float(result.strip())
    except Exception as e:
        print(f"⚠️ Warning: Could not probe duration for {file_path.name}. Falling back to metadata estimation. Error: {e}")
        return None

# -------------------------------------------------------
# Track Real Asset Ingress & Precise Dynamic Durations
# -------------------------------------------------------
inputs = []
actual_durations = []

print("\n🔍 Validating and probing normalized clips...")
for i in range(len(clips)):
    clip_file = DOWNLOADS / f"norm_trimmed{i+1}.mp4"

    if not clip_file.exists():
        raise FileNotFoundError(f"Required asset segment missing from disk: {clip_file}")

    # Query the physical file directly to prevent timing drift
    real_len = get_real_duration(clip_file)
    if real_len is None:
        real_len = float(clips[i]["duration"]) # Safe fallback to JSON estimation

    actual_durations.append(real_len)
    inputs.extend(["-i", str(clip_file)])
    print(f"📹 Scene {i+1}: {clip_file.name} | Verified Real Runtime: {real_len:.2f}s")

# -------------------------------------------------------
# Build Single Concat Single-Pass xfade Filter Chain
# -------------------------------------------------------
filters = []

# Single clip edge-case handler
if len(clips) == 1:
    filters.append("[0:v]copy[v0]")
    map_target = "[v0]"
else:
    # First transition offset points precisely to real asset length minus transition boundary
    offset = actual_durations[0] - TRANSITION

    for i in range(len(clips) - 1):
        left = "[0:v]" if i == 0 else f"[v{i}]"
        right = f"[{i+1}:v]"
        out = f"[v{i+1}]"

        filters.append(
            f"{left}{right}"
            f"xfade=transition=fade:"
            f"duration={TRANSITION}:"
            f"offset={round(offset, 3)}"
            f"{out}"
        )
        
        # Sequentially advance cross-point markers using precise frame length counts
        offset += actual_durations[i + 1] - TRANSITION

    map_target = f"[v{len(clips)-1}]"
    print(f"\n📊 Total Estimated Canvas Runtime (with overlapping transitions): {offset + TRANSITION:.2f}s")

# -------------------------------------------------------
# Memory-safe command builders and retry
# -------------------------------------------------------
def run_ffmpeg(cmd):
    """Runs ffmpeg, capturing combined stdout+stderr so we can inspect the
    actual error text afterward instead of guessing from a numeric return
    code (ffmpeg/x264 reports these inconsistently depending on *where* in
    the pipeline a failure occurs — encoder-open, mid-encode, or filter
    graph). Output is printed either way so nothing is lost from the
    console."""
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
        or "get_buffer() failed" in text
    )


# xfade decodes every input stream *simultaneously* to blend them, unlike
# the earlier trim/normalize steps which handle one clip at a time — so
# this step is the most memory-hungry point in the whole pipeline. Two
# separate thread pools need capping:
#   1. The filter graph itself (-filter_complex_threads / -filter_threads),
#      which otherwise spawns its own decode/filter threads per input and
#      was the source of the decoder-side "get_buffer() failed" / "no
#      frame!" errors seen here.
#   2. libx264's own encoder thread pool, which -threads before -i does
#      NOT reach (it auto-detects the CPU core count regardless) — that
#      needs -x264-params instead.
FILTER_THREAD_ARGS = ["-filter_threads", "1", "-filter_complex_threads", "1"]
X264_PARAMS_NORMAL = "threads=2:lookahead_threads=1:rc-lookahead=10"
X264_PARAMS_LOW_MEMORY = "threads=1:lookahead_threads=0:rc-lookahead=0:bframes=0"


def build_cmd(x264_params):
    return [
        str(FFMPEG),
        "-y",
        "-threads", "2",
        *FILTER_THREAD_ARGS,
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", map_target,
        "-c:v", "libx264",
        "-preset", "faster",
        "-pix_fmt", "yuv420p",
        "-x264-params", x264_params,
        "-an",
        str(OUTPUT),
    ]


def build_cmd_plain():
    # Last-resort fallback: no -x264-params override, single thread
    # everywhere, fastest preset — in case the flags themselves (rather
    # than genuine memory pressure) are what this ffmpeg/x264 build
    # doesn't like.
    return [
        str(FFMPEG),
        "-y",
        "-threads", "1",
        "-filter_threads", "1",
        "-filter_complex_threads", "1",
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", map_target,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-an",
        str(OUTPUT),
    ]


print("\n========== RUNNING TRANSITION COMPOSITION ==========\n")

attempts = [
    ("normal", build_cmd(X264_PARAMS_NORMAL)),
    ("low-memory", build_cmd(X264_PARAMS_LOW_MEMORY)),
    ("plain fallback (no x264-params, single-threaded)", build_cmd_plain()),
]

returncode, ffmpeg_log = None, ""
for attempt_index, (label, attempt_cmd) in enumerate(attempts):
    if attempt_index > 0:
        print(f"⚠️ Retrying transition composition with the '{label}' encode profile...")
    print(" ".join(map(str, attempt_cmd)))
    print()

    returncode, ffmpeg_log = run_ffmpeg(attempt_cmd)

    if returncode == 0:
        break

    if not looks_like_memory_error(ffmpeg_log):
        raise subprocess.CalledProcessError(returncode, attempt_cmd, output=ffmpeg_log)

if returncode != 0:
    raise subprocess.CalledProcessError(returncode, attempts[-1][1], output=ffmpeg_log)

print(f"\n✅ Blended transition video created successfully at: {OUTPUT}")
