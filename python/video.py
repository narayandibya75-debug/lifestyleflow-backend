import sys
import json
import subprocess
from utils import FFMPEG, FFPROBE
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# -------------------------------------------------------
# Working Directory
# -------------------------------------------------------
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

VIDEO = WORKING_DIR / "downloads" / "merged_transition.mp4"
AUDIO = WORKING_DIR / "mixed_audio.mp3"
SUBTITLE = WORKING_DIR / "captions.ass"
TIMELINE = WORKING_DIR / "timeline.json"
OUTPUT = WORKING_DIR / "final_video.mp4"

# -------------------------------------------------------
# Verify files
# -------------------------------------------------------
for file in [VIDEO, AUDIO, SUBTITLE]:
    if not file.exists():
        raise FileNotFoundError(f"Missing required file: {file}")

# -------------------------------------------------------
# Helper functions
# -------------------------------------------------------
def duration(file):
    try:
        result = subprocess.check_output([
            str(FFPROBE),
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file),
        ])
        return float(result.strip())
    except Exception as e:
        print(f"⚠️ Error probing duration for {file}: {e}")
        return 0.0

video_len = duration(VIDEO)
audio_len = duration(AUDIO)

print("Merged video duration:", video_len)
print("Audio duration:", audio_len)

# -------------------------------------------------------
# Windows-Safe Subtitle Path Escape Fix
# -------------------------------------------------------
# FFmpeg's subtitle filter struggles with Windows backslashes.
# Converting to a forward-slash string representation avoids crash errors.
subtitle_path_safe = str(SUBTITLE.relative_to(WORKING_DIR)).replace("\\", "/")

# -------------------------------------------------------
# AI-driven editing profile
# -------------------------------------------------------
# Reads timeline.json (written by create_timeline.py) and derives simple,
# global editing decisions from each scene's camera / mood / scene_type.
# NOTE: by this point in the pipeline all scenes have already been merged
# into a single VIDEO file, so these are applied as one pass over the whole
# video rather than per-scene. Anything that needs per-scene timing
# (e.g. cut pacing) has to be handled upstream, before the merge.

def load_scenes():
    if not TIMELINE.exists():
        print(f"⚠️ No timeline.json found at {TIMELINE}, using default editing profile.")
        return []
    try:
        with open(TIMELINE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"⚠️ Failed to read timeline.json: {e}")
        return []

    scenes = data.get("scenes", data) if isinstance(data, dict) else data
    return scenes if isinstance(scenes, list) else []


def most_common(values):
    values = [v for v in values if v]
    if not values:
        return None
    return max(set(values), key=values.count)


scenes = load_scenes()

cameras = [s.get("camera") for s in scenes]
moods = [s.get("mood") for s in scenes]
scene_types = [s.get("scene_type") for s in scenes]

dominant_camera = most_common(cameras)
dominant_mood = most_common(moods)
has_broll = "broll" in scene_types

print("🎥 Dominant camera:", dominant_camera or "unknown")
print("🎭 Dominant mood:", dominant_mood or "unknown")
print("🖼️ Contains broll scenes:", has_broll)

video_filters = []

# --- camera = close_up / drone -> zoom behaviour ---
if dominant_camera == "close_up":
    print("→ camera=close_up: applying slight zoom")
    video_filters.append("scale=iw*1.06:ih*1.06,crop=iw/1.06:ih/1.06")
elif dominant_camera == "drone":
    print("→ camera=drone: skipping zoom, keeping wide framing")
else:
    print("→ no dominant camera cue: neutral framing, no zoom")

# --- mood = dramatic / energetic -> grading behaviour ---
if dominant_mood == "dramatic":
    print("→ mood=dramatic: applying dark color grading")
    video_filters.append("eq=contrast=1.15:brightness=-0.06:saturation=0.85")
elif dominant_mood == "energetic":
    print(
        "→ mood=energetic: applying punchier grading "
        "(cut pacing itself is controlled upstream in ffmpeg_xfade.py)"
    )
    video_filters.append("eq=contrast=1.08:saturation=1.2")
else:
    print("→ no dominant mood cue: neutral grading")

# --- scene_type = broll -> subtitle overlay behaviour ---
if has_broll or not scene_types:
    print("→ overlaying subtitles")
    video_filters.append(f"subtitles={subtitle_path_safe}")
else:
    print("→ no broll scenes detected: skipping subtitle overlay")

vf_chain = ",".join(video_filters) if video_filters else f"subtitles={subtitle_path_safe}"

# -------------------------------------------------------
# FFmpeg command
# -------------------------------------------------------
cmd = [
    str(FFMPEG),
    "-y",
    "-threads", "2",              # <--- Limit threads to protect system RAM from running out

    "-t", str(video_len),         # <--- Placed early to drop unnecessary processing streams
    "-i", str(VIDEO),
    "-i", str(AUDIO),

    "-vf", vf_chain,

    "-c:v", "libx264",
    "-preset", "faster",          # <--- Speeds up lookahead rendering and drops memory payload
    "-crf", "18",

    "-pix_fmt", "yuv420p",

    "-c:a", "aac",
    "-b:a", "192k",

    "-movflags", "+faststart",    # Standard web-optimization flag

    str(OUTPUT),
]

print("\n========== FINAL RENDER ==========\n")
print(" ".join(map(str, cmd)))
print()

print("Working directory:")
print(WORKING_DIR)

subprocess.run(
    cmd,
    cwd=WORKING_DIR,
    check=True
)

print("\n✅ Final video created")
print(OUTPUT)

print("Final video duration:", duration(OUTPUT))