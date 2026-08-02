import json
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent.parent

if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
else:
    WORKING_DIR = BASE_DIR

scene_file = WORKING_DIR / "scenes.json"
subtitle_file = WORKING_DIR / "subtitles.srt"
with open(scene_file, "r", encoding="utf-8") as f:
    scenes = json.load(f)["scenes"]


def fmt(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)

    return f"{h:02}:{m:02}:{s:02},{ms:03}"


# Average narration speed
WORDS_PER_SECOND = 2.6

current_time = 0.0
subs = []

for i, scene in enumerate(scenes, start=1):

    text = scene["voice"].strip()

    word_count = len(text.split())

    # Estimate duration from speech length
    duration = max(1.5, round(word_count / WORDS_PER_SECOND, 2))

    start = current_time
    end = start + duration

    subs.append(
f"""{i}
{fmt(start)} --> {fmt(end)}
{text}

"""
    )

    current_time = end


with open(subtitle_file, "w", encoding="utf-8") as f:
    f.writelines(subs)

print("Subtitles created:", subtitle_file)