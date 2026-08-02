import sys
import json
import math
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------
# Working Directory Isolation Fix
# ---------------------------------------------------
if len(sys.argv) > 1:
    # Explicitly pull the index 1 string argument to prevent object conversion crashes
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

content_file = WORKING_DIR / "content.json"
output_file = WORKING_DIR / "scenes.json"

if not content_file.exists():
    raise FileNotFoundError(f"❌ Missing source file: {content_file}")

with open(content_file, "r", encoding="utf-8") as f:
    content = json.load(f)

# Extract voiceover script structure safely
script = content.get("script", {})

if isinstance(script, dict):
    voiceover = script.get("voiceover", "")
    visuals = script.get("visual_cues", [])
else:
    voiceover = script
    visuals = []

title = content.get("title") or content.get("topic") or "Untitled"

# Clean split punctuation blocks safely
sentences = [
    s.strip()
    for s in voiceover.replace("\n", " ").split(".")
    if s.strip()
]

scenes = []

print(f"📄 Processing {len(sentences)} script segments...")

# ---------------------------------------------------
# Process Timeline and Estimate Durations
# ---------------------------------------------------
for i, sentence in enumerate(sentences):
    visual = visuals[i] if i < len(visuals) else sentence
    
    # Calculate word count to accurately estimate audio duration
    words_count = len(sentence.split())
    
    # 150 words per minute rule = 2.5 words per second. 
    # Clamp to a minimum of 2.5 seconds per scene so it is never too brief.
    estimated_duration = max(2.5, round(words_count / 2.5, 2))

    scenes.append({
        "scene": i + 1,
        "voice": sentence + ".",
        "search": visual,
        "duration": estimated_duration  # <--- Crucial structural connection for downstream merge steps
    })

output = {
    "title": title,
    "scenes": scenes
}

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(output, f, indent=4, ensure_ascii=False)

print(f"✅ Scenes file successfully created at: {output_file}")
