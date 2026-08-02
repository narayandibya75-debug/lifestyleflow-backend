import sys
import json
import subprocess
from pathlib import Path

from utils import FFPROBE

BASE_DIR = Path(__file__).resolve().parent.parent

# -----------------------------------------------------------
# Paths
# -----------------------------------------------------------
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1])
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

CONTENT_FILE = WORKING_DIR / "content.json"
OUTPUT_FILE = WORKING_DIR / "scene_durations.json"
TIMELINE_FILE = WORKING_DIR / "timeline.json"

# Prefer the narration file produced by generate_audio.py
AUDIO_FILE = WORKING_DIR / "final_audio.mp3"
if not AUDIO_FILE.exists():
    AUDIO_FILE = WORKING_DIR / "voice.mp3"

TRANSITION = 0.4
MIN_SCENE_DURATION = 2.0


def get_audio_duration(audio_path: Path):
    """Return exact narration duration from the generated audio file."""
    if not audio_path.exists():
        return None

    cmd = [
        str(FFPROBE),
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(audio_path),
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=True,
    )

    duration = json.loads(result.stdout)
    return float(duration["format"]["duration"])


if not CONTENT_FILE.exists():
    raise FileNotFoundError(f"Content file missing in folder session: {CONTENT_FILE}")

with open(CONTENT_FILE, encoding="utf-8") as f:
    data = json.load(f)

# -----------------------------------------------------------
# Load scenes
# -----------------------------------------------------------
scenes = []

if isinstance(data, dict) and "scenes" in data:
    scenes = data["scenes"]
else:
    # Fallback: split a flat script into scene_count chunks
    script_text = data.get("script", "") if isinstance(data, dict) else str(data)
    words = script_text.split()

    if words:
        scene_count = 6
        chunk_size = max(1, len(words) // scene_count)

        for idx in range(scene_count):
            start_w = idx * chunk_size
            # Every scene except the last gets its own chunk;
            # the last scene absorbs the remainder.
            end_w = (idx + 1) * chunk_size if idx < scene_count - 1 else len(words)
            phrase = " ".join(words[start_w:end_w])

            if phrase.strip():
                scenes.append({
                    "voice": phrase
                })

if not scenes:
    scenes = [{"voice": "System initializing tracking data models."}]

audio_duration = get_audio_duration(AUDIO_FILE)


# -----------------------------------------------------------
# Calculate proportional durations
# -----------------------------------------------------------
word_counts = []
total_words = 0

for scene in scenes:
    count = len(scene.get("voice", "").split())
    word_counts.append(count)
    total_words += count

# Protect against division by zero
if total_words == 0:
    total_words = 1

if audio_duration is not None:
    audio_duration = max(audio_duration, 3.0)
else:
    # Fallback estimate if narration file is missing
    audio_duration = total_words / 2.6


def allocate_durations(word_counts, total_words, audio_duration, min_duration=MIN_SCENE_DURATION):
    """Allocate scene durations proportionally to each scene's word count.

    Short scenes are floored at min_duration. If the floor causes the
    total to exceed the real narration duration, the excess is pulled
    proportionally from scenes that have slack above the floor.
    """
    raw = [(w / total_words) * audio_duration for w in word_counts]
    durations = [max(d, min_duration) for d in raw]

    overflow = sum(durations) - audio_duration
    if overflow > 0:
        adjustable = [i for i, d in enumerate(raw) if d > min_duration]
        adjustable_total = sum(durations[i] for i in adjustable)

        if adjustable_total > 0:
            for i in adjustable:
                share = durations[i] / adjustable_total
                durations[i] = max(min_duration, durations[i] - overflow * share)
        else:
            print(
                f"⚠️ Narration too short to fit {len(word_counts)} scenes at the "
                f"{min_duration}s floor; timeline will run {overflow:.2f}s longer "
                f"than the narration."
            )

    return [round(d, 2) for d in durations]


durations = allocate_durations(word_counts, total_words, audio_duration)

scene_durations = []
timeline = []
current = 0.0

for i, duration in enumerate(durations):
    scene_durations.append({
        "duration": duration
    })

    timeline.append({
        "file": f"trimmed{i+1}.mp4",
        "duration": duration,
        "start": round(current, 2)
    })

    current += duration - TRANSITION


# -----------------------------------------------------------
# Save files
# -----------------------------------------------------------
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump({
        "scenes": scene_durations
    }, f, indent=4)

with open(TIMELINE_FILE, "w", encoding="utf-8") as f:
    json.dump({
        "clips": timeline
    }, f, indent=4)

print("✓ Scene durations created.")
print("✓ Timeline created.")