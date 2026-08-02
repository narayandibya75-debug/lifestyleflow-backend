import sys
import json
import subprocess
from utils import FFMPEG, FFPROBE
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Correctly targets the dynamic Next.js generation workspace folder
if len(sys.argv) > 1:
    OUTPUT_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {OUTPUT_DIR}")
else:
    OUTPUT_DIR = BASE_DIR / "public" / "generated"
    print(f"📁 Global Execution Mode active. Target directory: {OUTPUT_DIR}")

video = OUTPUT_DIR / "final_video.mp4"
thumbnail = OUTPUT_DIR / "thumbnail.jpg"
CONTENT_FILE = OUTPUT_DIR / "content.json"
TIMELINE_FILE = OUTPUT_DIR / "timeline.json"

print("Input Video Source Path:", video)
print("Output Thumbnail Target Path:", thumbnail)

if not video.exists():
    raise FileNotFoundError(f"Cannot generate thumbnail. Rendered video source not found: {video}")

DEFAULT_TIMESTAMP = 0.5  # original fixed fallback: 0.5s in, avoids out-of-bounds on ultra-short clips

# Words that tend to signal "this is the hook" in a script, worth a bit of
# weight alongside the structured camera/mood fields.
HOOK_WORDS = (
    "secret", "best", "worst", "never", "always", "shocking", "amazing",
    "why", "how", "warning", "mistake", "truth", "biggest", "you",
)


def get_video_duration(path):
    try:
        result = subprocess.run(
            [
                str(FFPROBE), "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True, text=True, check=True,
        )
        return float(result.stdout.strip())
    except Exception as e:
        print(f"⚠️ Could not probe video duration: {e}")
        return None


def load_scenes():
    """Structured per-scene metadata (voice, visual_prompt, keywords,
    camera, mood) as produced by the script-generation step. Returns []
    if content.json is missing or doesn't have that structure — e.g. it
    fell back to a flat, unscened script."""
    if not CONTENT_FILE.exists():
        return []
    try:
        data = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ Could not read content.json: {e}")
        return []

    if isinstance(data, dict) and isinstance(data.get("scenes"), list):
        return data["scenes"]
    return []


def load_timeline_clips():
    """Where each scene actually lands in final_video.mp4 (start/duration),
    since scenes are trimmed, normalized and crossfaded before this step."""
    if not TIMELINE_FILE.exists():
        return []
    try:
        data = json.loads(TIMELINE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"⚠️ Could not read timeline.json: {e}")
        return []
    return data.get("clips", [])


def score_scene(scene):
    """Higher score = more likely to make a strong thumbnail. This is a
    heuristic proxy for 'scene priority', not a learned CTR model: close-up
    framing and high-energy moods read better as a still frame than a wide
    drone shot, and scenes whose narration uses hook-y language are more
    often the point of the video."""
    score = 0.0

    camera = (scene.get("camera") or "").strip().lower()
    mood = (scene.get("mood") or "").strip().lower()
    keywords = scene.get("keywords") or []
    text = " ".join([str(scene.get("voice", "")), str(scene.get("visual_prompt", ""))]).lower()

    if camera == "close_up":
        score += 3
    elif camera in ("medium", "medium_shot"):
        score += 1
    # drone / wide shots get no bonus — usually too busy/small-subject for a thumbnail crop

    if mood in ("dramatic", "energetic", "shocking", "intense"):
        score += 2

    score += sum(1 for w in HOOK_WORDS if w in text)
    score += 0.5 * len(keywords)

    return score


def pick_priority_timestamp():
    scenes = load_scenes()
    clips = load_timeline_clips()

    if not scenes or not clips:
        print("↳ No scene metadata / timeline available, using default frame.")
        return DEFAULT_TIMESTAMP

    count = min(len(scenes), len(clips))
    scored = [(score_scene(scenes[i]), i) for i in range(count)]
    best_score, best_index = max(scored, key=lambda pair: pair[0])

    if best_score <= 0:
        # No scene stood out on camera/mood/keywords — fall back to the
        # longest scene as a proxy for "the main point", rather than an
        # arbitrary first frame.
        best_index = max(range(count), key=lambda i: clips[i].get("duration", 0))
        print(f"↳ No scene scored above zero, using longest scene (index {best_index}) instead.")
    else:
        print(f"↳ Highest-priority scene: index {best_index} (score {best_score:.1f})")

    clip = clips[best_index]
    start = float(clip.get("start", 0))
    duration = float(clip.get("duration", 0))
    timestamp = start + (duration / 2)

    video_duration = get_video_duration(video)
    if video_duration is not None:
        timestamp = max(0.0, min(timestamp, max(0.0, video_duration - 0.1)))

    print(f"↳ Extracting thumbnail frame at {timestamp:.2f}s (scene start {start:.2f}s, duration {duration:.2f}s)")
    return timestamp


timestamp = pick_priority_timestamp()
timestamp_str = f"{timestamp:.3f}"

# FIXED: Added "-pix_fmt", "yuvj420p" to handle strict MJPEG color range checks in newer FFmpeg versions
subprocess.run([
    str(FFMPEG),
    "-y",
    "-i", str(video),
    "-ss", timestamp_str,
    "-frames:v", "1",
    "-pix_fmt", "yuvj420p",
    str(thumbnail)
], check=True)

print("✓ Thumbnail created:", thumbnail)
