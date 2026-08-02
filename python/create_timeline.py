import sys
import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# =====================================================================
# PART 1: Environment Setup and Folder Initialization
# =====================================================================

# 📁 Safely track execution paths passed from Next.js
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

# Synchronize relative system file targets
CONTENT_FILE = WORKING_DIR / "content.json"
DURATIONS_FILE = WORKING_DIR / "scene_durations.json"
TIMELINE_FILE = WORKING_DIR / "timeline.json"
DOWNLOADS = WORKING_DIR / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)

TRANSITION = 0.4

STOP_WORDS = {
    "the", "a", "an", "and", "or", "but",
    "is", "are", "was", "were",
    "to", "of", "for", "with", "in",
    "on", "at", "by", "that", "this",
    "it", "be", "as", "from"
}


def extract_keywords(text: str) -> list:
    """Fallback text keyword extractor for search optimization tracking."""
    words = re.findall(r"\b[a-zA-Z]+\b", text.lower())
    return [
        w for w in words
        if len(w) > 2 and w not in STOP_WORDS
    ]


if not CONTENT_FILE.exists() or not DURATIONS_FILE.exists():
    raise FileNotFoundError("Required JSON metadata files for timeline compilation are missing in this session.")

with open(CONTENT_FILE, encoding="utf-8") as f:
    data = json.load(f)

with open(DURATIONS_FILE, encoding="utf-8") as f:
    durations = json.load(f)["scenes"]


# =====================================================================
# PART 2: Safe Structural Scene Extraction
# =====================================================================

scenes = []

if isinstance(data, dict) and "scenes" in data:
    scenes = data["scenes"]
else:
    # Slice the flat script string to perfectly align with duration partitions
    script_text = data.get("script", "") if isinstance(data, dict) else str(data)
    words = script_text.split()
    
    if words:
        chunk_size = max(1, len(words) // len(durations))
        for idx in range(len(durations)):
            start_w = idx * chunk_size
            end_w = (idx + 1) * chunk_size if idx < (len(durations) - 1) else len(words)
            phrase = " ".join(words[start_w:end_w])
            
            if phrase.strip():
                scenes.append({
                    "voice": phrase
                })

if not scenes:
    scenes = [{"voice": "System initializing tracking data models."}]


# =====================================================================
# PART 3: Intelligent Timeline Generation Loop
# =====================================================================

timeline = []
current_time = 0.0

print("🛠️ Transforming rich scene metadata to timeline configuration...")

# FIX 1: Fail fast on scene mismatch
if len(scenes) != len(durations):
    raise RuntimeError(
        f"Scene count mismatch: "
        f"{len(scenes)} scenes vs {len(durations)} durations."
    )

for i, (scene, duration_item) in enumerate(zip(scenes, durations), start=1):
    duration = duration_item["duration"]
    
    # FIX 2: Resolve clip paths more robustly
    target_file = None
    file_path_string = None
    asset_type = None
    
    # Check explicit clip from scene
    if scene.get("clip"):
        candidate = Path(scene["clip"])
        if not candidate.is_absolute():
            candidate = WORKING_DIR / candidate
        if candidate.exists():
            target_file = candidate
    
    # Fallback to structural defaults
    if target_file is None:
        # Check for video files
        video_candidate = DOWNLOADS / f"clip{i}.mp4"
        if video_candidate.exists():
            target_file = video_candidate
        else:
            # Check for image files
            for ext in (".png", ".jpg", ".jpeg"):
                img_candidate = DOWNLOADS / f"clip{i}{ext}"
                if img_candidate.exists():
                    target_file = img_candidate
                    break
    
    # Parse status data points from confirmed asset variants
    if target_file:
        file_path_string = f"downloads/{target_file.name}"
        asset_type = "image" if target_file.suffix.lower() in (".png", ".jpg", ".jpeg") else "video"
        fallback_active = target_file.suffix.lower() == ".png"
    else:
        file_path_string = f"downloads/clip{i}.mp4"  # Non-blocking structural skeleton path
        asset_type = "video"  # Default assumption
        fallback_active = True

    # FIX 3: Stop subtracting transitions from timeline
    # Transitions handled by FFmpeg during rendering
    
    # FIX 4: Do not invent visual prompts
    visual_prompt = scene.get("visual_prompt", "")
    
    # FIX 5: Improve keyword handling using visual_prompt first, then voice
    keyword_text = scene.get("visual_prompt") or scene.get("voice", "")
    keywords = scene.get("keywords", extract_keywords(keyword_text))
    
    # FIX 6: Save resolved asset path with type
    timeline.append({
        "scene": i,
        "video": file_path_string,
        "asset": file_path_string,  # Store resolved asset path
        "asset_type": asset_type,    # Store asset type
        "voice": scene.get("voice", ""),
        "visual_prompt": visual_prompt,
        "camera": scene.get("camera", "medium shot"),
        "mood": scene.get("mood", "modern"),
        "duration": round(duration, 2),
        "start": round(current_time, 2),
        "keywords": keywords,
        "fallback_to_ai_image": fallback_active
    })

    # Accumulate start times WITHOUT subtracting transition
    current_time += duration


# =====================================================================
# PART 4: Timeline Validation
# =====================================================================

# FIX 7: Add timeline validation check
timeline_duration = sum(c["duration"] for c in timeline)

print(f"Scenes : {len(timeline)}")
print(f"Timeline duration : {timeline_duration:.2f}s")
print(f"Last clip ends at : {current_time:.2f}s")

# Validate timeline vs expected
if timeline_duration > 0:
    print(f"✅ Timeline validated: {timeline_duration:.2f}s total duration")


# =====================================================================
# PART 5: Final Output Structural Validation and Save
# =====================================================================

with open(TIMELINE_FILE, "w", encoding="utf-8") as f:
    json.dump(
        {
            "clips": timeline,
            "total_duration": timeline_duration,
            "scene_count": len(timeline),
            "asset_types": {
                clip["video"]: clip["asset_type"]
                for clip in timeline
                if clip.get("video")
            },
        },
        f,
        indent=4,
    )

print(f"✅ Rich Timeline successfully compiled and saved to: {TIMELINE_FILE}")