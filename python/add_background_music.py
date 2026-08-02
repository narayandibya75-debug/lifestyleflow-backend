import sys
from pathlib import Path
import subprocess
import shutil
from utils import FFMPEG, FFPROBE
import json
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# Fix: Dynamically read from the generation folder if provided by Next.js
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1])
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

# Paths updated to use WORKING_DIR instead of hardcoded BASE_DIR
VOICE_FILE = WORKING_DIR / "final_audio.mp3"
WORKING_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_AUDIO = WORKING_DIR / "mixed_audio.mp3"

# Music locations
# Music selected by select_music.py
GENERATED_MUSIC = WORKING_DIR / "music" / "background.mp3"
CONTENT_FILE = WORKING_DIR / "content.json"

print("\n===== BACKGROUND MUSIC DEBUG =====")
print("WORKING_DIR:", WORKING_DIR)
print("GENERATED_MUSIC:", GENERATED_MUSIC)
print("Exists:", GENERATED_MUSIC.exists())
print("VOICE_FILE:", VOICE_FILE)
print("==================================\n")

if not FFMPEG.exists():
    raise FileNotFoundError(f"FFmpeg not found: {FFMPEG}")

if not FFPROBE.exists():
    raise FileNotFoundError(f"FFprobe not found: {FFPROBE}")

def get_duration(file_path):
    cmd = [
        str(FFPROBE),
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(file_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def apply_background_music():
    if not VOICE_FILE.exists():
        raise FileNotFoundError(f"Voice narration not found:\n{VOICE_FILE}")

    # Get the best available music file
    # select_music.py skips (without error) instead of creating this file
    # when there's no music library/assets available yet — fall back to
    # narration-only audio so the rest of the pipeline (video.py reads
    # mixed_audio.mp3) keeps working.
    if not GENERATED_MUSIC.exists():
        print(f"⚠️ No background music found at:\n{GENERATED_MUSIC}")
        print("⚠️ Proceeding with narration-only audio (no background music).")
        shutil.copy2(VOICE_FILE, OUTPUT_AUDIO)
        print("\n✅ Final audio created (narration only):")
        print(OUTPUT_AUDIO)
        return

    music_file = GENERATED_MUSIC
    print(f"Selected music: {music_file.name}")
    print(f"🎵 Using selected music:\n{music_file}")

    voice_duration = get_duration(VOICE_FILE)
    
    # Read energy level from content.json for volume adjustment
    volume = 0.08
    if CONTENT_FILE.exists():
        try:
            with open(CONTENT_FILE, "r", encoding="utf8") as f:
                content = json.load(f)
            
            bg_music = content.get("background_music")
            if isinstance(bg_music, dict):
                energy = bg_music.get("energy", "medium")
            else:
                energy = "medium"
            
            volume = {
                "low": 0.05,
                "medium": 0.08,
                "high": 0.12
            }.get(energy.lower(), 0.08)
        except Exception as e:
            print(f"⚠️ Could not read energy level: {e}")
    
    # Build FFmpeg filter with fade in/out
    FADE_IN = 2
    FADE_OUT = 3
    fade_start = max(voice_duration - FADE_OUT, 0)
    
    # FIX: Loop the background track BEFORE applying volumes and final fade-out
    filter_complex = (
        f"[0:a]volume=1.25[voice];"
        f"[1:a]aloop=loop=-1:size=2e+09,"
        f"volume={volume},"
        f"afade=t=in:st=0:d={FADE_IN},"
        f"afade=t=out:st={fade_start}:d={FADE_OUT}[bg];"
        "[voice][bg]amix=inputs=2:duration=first:dropout_transition=2[out]"
    )

    # FIX: Removed the conflicting "-stream_loop -1" input flag
    cmd = [
        str(FFMPEG),
        "-y",
        "-i", str(VOICE_FILE),
        "-i", str(music_file),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-t", str(voice_duration),
        "-c:a", "libmp3lame",
        "-q:a", "2",
        str(OUTPUT_AUDIO),
    ]

    print("\n🎬 Mixing narration with background music...\n")
    print(" ".join(map(str, cmd)))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            check=True
        )
        print("Return code:", result.returncode)
        print("Looking for:", GENERATED_MUSIC)
        print("Exists:", GENERATED_MUSIC.exists())
    except subprocess.CalledProcessError as e:
        print("❌ FFmpeg failed.")
        print(e.stderr)
        raise

    # Verify output was created
    if not OUTPUT_AUDIO.exists():
        raise RuntimeError("Audio mixing failed: output file not created.")

    print("\n✅ Final audio created:")
    print(OUTPUT_AUDIO)

if __name__ == "__main__":
    apply_background_music()
