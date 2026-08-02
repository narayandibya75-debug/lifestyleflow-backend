from pathlib import Path
import subprocess
from utils import FFMPEG, FFPROBE
import random
import json

BASE_DIR = Path(__file__).resolve().parent.parent
downloads = BASE_DIR / "downloads"

# -----------------------
# Transition Settings
# -----------------------

TRANSITION_DURATION = 0.35

TRANSITIONS = [
    "fade",
    "fadeblack",
    "smoothleft",
    "smoothright",
    "wipeleft",
    "wiperight",
]

# -----------------------
# Load Scene Durations
# -----------------------

with open(BASE_DIR / "scene_durations.json", encoding="utf-8") as f:
    scene_data = json.load(f)["scenes"]

durations = [scene["duration"] for scene in scene_data]

# -----------------------
# Find Trimmed Clips
# -----------------------

clips = sorted(downloads.glob("trimmed*.mp4"))

if len(clips) < 2:
    raise Exception("Need at least 2 trimmed clips.")

print(f"Found {len(clips)} clips.")

cmd = [str(FFMPEG), "-y"]

for clip in clips:
    cmd.extend(["-i", str(clip)])



#Calculate Transition Offsets
offset = durations[0] - TRANSITION_DURATION

filter_parts = []

for i in range(1, len(clips)):

    transition = random.choice(TRANSITIONS)

    input1 = f"[{i-1}:v]" if i == 1 else f"[v{i-1}]"
    input2 = f"[{i}:v]"

    output = f"[v{i}]"

    filter_parts.append(
        f"{input1}{input2}"
        f"xfade=transition={transition}:"
        f"duration={TRANSITION_DURATION}:"
        f"offset={offset}"
        f"{output}"
    )

    offset += durations[i] - TRANSITION_DURATION


#Join filter parts and build final command
filter_complex = ";".join(filter_parts)

cmd.extend([
    "-filter_complex",
    filter_complex,
    "-map",
    f"[v{len(clips)-1}]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
])

#output file
output = downloads / "transitioned.mp4"

cmd.append(str(output))

print("Running FFmpeg...")
print(" ".join(map(str, cmd)))

subprocess.run(cmd, check=True)

print(f"Created: {output}")