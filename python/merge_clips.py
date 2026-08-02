import sys
import json
from pathlib import Path
import subprocess
from utils import FFMPEG, FFPROBE

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------
# Working Directory Execution Support
# ---------------------------------------------------
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

DOWNLOADS_DIR = WORKING_DIR / "downloads"
LIST_FILE = DOWNLOADS_DIR / "list.txt"
MERGED_OUTPUT = DOWNLOADS_DIR / "merged.mp4"

def process_and_merge():
    # 1. Load scene durations to know exactly how long our AI fallback clips need to be
    durations_file = WORKING_DIR / "scene_durations.json"
    if not durations_file.exists():
        # Fallback tracking verification check
        durations_file = WORKING_DIR / "timeline.json"
        
    if not durations_file.exists():
        raise FileNotFoundError(f"⚠️ Could not find scene structure file in {WORKING_DIR}. Check pipeline steps.")

    with open(durations_file, "r", encoding="utf-8") as f:
        raw_data = json.load(f)
        # Parse dynamically whether checking from raw scene_durations or timeline schemas
        durations_data = raw_data.get("scenes", raw_data.get("clips", []))

    # 2. Dynamic Orientation Check (Widescreen Long-form vs. Vertical Shorts)
    total_duration = sum(float(scene.get("duration", 0)) for scene in durations_data)
    
    FPS = 30
    if total_duration > 60.0:
        WIDTH = 1920
        HEIGHT = 1080
        layout_mode = "LONG-FORM VIDEO (16:9 Widescreen)"
    else:
        WIDTH = 1080
        HEIGHT = 1920
        layout_mode = "YOUTUBE SHORTS (9:16 Vertical)"
        
    print(f"📊 Total Video Duration: {total_duration:.2f}s -> Fallback Layout Profile: {layout_mode}")
    print("🎬 Analysing download assets and normalizing fallback components...")

    # 3. Reconstruct the ordered sequence of expected clips
    final_clips_to_merge = []
    
    for i, scene in enumerate(durations_data, start=1):
        target_duration = float(scene["duration"])
        
        # Check standard clip generation pipelines
        trimmed_mp4 = DOWNLOADS_DIR / f"trimmed_clip{i}.mp4"
        if not trimmed_mp4.exists():
            trimmed_mp4 = DOWNLOADS_DIR / f"trimmed{i}.mp4"
        if not trimmed_mp4.exists():
            trimmed_mp4 = DOWNLOADS_DIR / f"norm_trimmed{i}.mp4" # Support clean norm schema paths

        fallback_png = DOWNLOADS_DIR / f"clip{i}.png"
        temp_video_clip = DOWNLOADS_DIR / f"converted_fallback_{i}.mp4"

        # Case A: Valid normalized stock clip found
        if trimmed_mp4.exists():
            final_clips_to_merge.append(trimmed_mp4)
            print(f"📦 Found prepared clip: {trimmed_mp4.name}")

        # Case B: Convert fallback image assets using matched design frame size profiles
        elif fallback_png.exists():
            print(f"🖼️ Found AI Image fallback: {fallback_png.name}. Compiling into a {target_duration:.2f}s video ({WIDTH}x{HEIGHT})...")
            
            cmd_convert = [
                str(FFMPEG),
                "-y",
                "-threads", "2",          # Prevents memory allocation crashes during layout conversions
                "-loop", "1",
                "-t", str(target_duration),
                "-i", str(fallback_png),
                "-vf", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps={FPS}",
                "-pix_fmt", "yuv420p",
                "-c:v", "libx264",
                "-preset", "faster",      # Faster frame allocations means lower short-term buffer loads
                "-an",
                str(temp_video_clip)
            ]
            subprocess.run(cmd_convert, check=True)
            final_clips_to_merge.append(temp_video_clip)
        
        else:
            raw_mp4 = DOWNLOADS_DIR / f"clip{i}.mp4"
            if raw_mp4.exists():
                print(f"⚠️ Trimmed clip missing but raw asset found for index {i}. Passing straight through...")
                final_clips_to_merge.append(raw_mp4)
            else:
                print(f"❌ Critical Error: Asset index {i} could not be resolved.")

    if not final_clips_to_merge:
        raise Exception("No usable clips or fallbacks resolved for stitching timeline.")

    # 4. Write out structural concat tracking manifest 
    with open(LIST_FILE, "w", encoding="utf-8") as f:
        for clip in final_clips_to_merge:
            path = clip.resolve().as_posix()
            f.write(f"file '{path}'\n")

    print(f"🔗 Merging {len(final_clips_to_merge)} clips using fast concat layout...")

    cmd_merge = [
        str(FFMPEG),
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(LIST_FILE),
        "-c", "copy",  # Keeps fast streaming frame stream duplication intact
        str(MERGED_OUTPUT),
    ]

    subprocess.run(cmd_merge, check=True)
    print(f"🎉 Merged video successfully updated at: {MERGED_OUTPUT}")

    # Clean up temporary converted image assets to keep workspace tidy
    LIST_FILE.unlink(missing_ok=True)
    for clip in final_clips_to_merge:
        if "converted_fallback_" in clip.name:
            clip.unlink(missing_ok=True)

if __name__ == "__main__":
    process_and_merge()
