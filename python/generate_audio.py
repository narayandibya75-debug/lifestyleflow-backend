import asyncio
import edge_tts
import json
import os
import sys
import subprocess
from utils import FFMPEG, FFPROBE
import shutil

FEMALE_VOICE_MAP = {
    "en": "en-US-JennyNeural",
    "hi": "hi-IN-SwaraNeural",
    "bn": "bn-IN-TanishaaNeural",
    "ta": "ta-IN-PallaviNeural",
    "te": "te-IN-ShrutiNeural",
    "mr": "mr-IN-AarohiNeural",
    "gu": "gu-IN-DhwaniNeural",
    "kn": "kn-IN-SapnaNeural",
    "ml": "ml-IN-SobhanaNeural",
    "pa": "pa-IN-GurleenNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "es": "es-ES-ElviraNeural",
    "ja": "ja-JP-NanamiNeural",
    "ko": "ko-KR-SunHiNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
}
MALE_VOICE_MAP = {
    "en": "en-US-GuyNeural",
    "hi": "hi-IN-MadhurNeural",
    "bn": "bn-IN-BashkarNeural",
    "ta": "ta-IN-ValluvarNeural",
    "te": "te-IN-MohanNeural",
    "mr": "mr-IN-ManoharNeural",
    "gu": "gu-IN-NiranjanNeural",
    "kn": "kn-IN-GaganNeural",
    "ml": "ml-IN-MidhunNeural",
    "pa": "pa-IN-OjasNeural",
    "fr": "fr-FR-HenriNeural",
    "de": "de-DE-ConradNeural",
    "es": "es-ES-AlvaroNeural",
    "ja": "ja-JP-KeitaNeural",
    "ko": "ko-KR-InJoonNeural",
    "zh": "zh-CN-YunxiNeural",
}
# A couple of alternate neural voices per language, tried in order if the
# primary voice in VOICE_MAP fails (rate-limited, temporarily unavailable,
# etc.). Previously this fallback list only existed for English, so any
# non-English voice failure went straight to a silent placeholder track
# with no retry across a different voice for that language.
FALLBACK_VOICE_MAP: dict[str, list[str]] = {
    "en": ["en-US-GuyNeural", "en-US-RyanNeural", "en-US-AriaNeural"],
    "hi": ["hi-IN-MadhurNeural"],
    "bn": ["bn-IN-TanishaaNeural"],
    "ta": ["ta-IN-ValluvarNeural"],
    "te": ["te-IN-MohanNeural"],
    "mr": ["mr-IN-ManoharNeural"],
    "gu": ["gu-IN-NiranjanNeural"],
    "kn": ["kn-IN-GaganNeural"],
    "ml": ["ml-IN-MidhunNeural"],
    "pa": ["pa-IN-OjasNeural"],
    "fr": ["fr-FR-HenriNeural"],
    "de": ["de-DE-ConradNeural"],
    "es": ["es-ES-AlvaroNeural"],
    "ja": ["ja-JP-KeitaNeural"],
    "ko": ["ko-KR-InJoonNeural"],
    "zh": ["zh-CN-YunxiNeural"],
}

FFMPEG = shutil.which(str(FFMPEG)) or FFMPEG

if not FFMPEG:
    raise RuntimeError("FFmpeg not found in PATH.")

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(BASE)

# Fix: Dynamically determine working directory based on CLI arguments from Next.js
if len(sys.argv) > 1:
    WORKING_DIR = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "en"
    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = PROJECT
    language = "en"
    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

content_path = os.path.join(WORKING_DIR, "content.json")
os.makedirs(WORKING_DIR, exist_ok=True)
OUTPUT = os.path.join(WORKING_DIR, "final_audio.mp3")

# Ensure text data is extracted correctly with universal fallbacks
try:
    with open(content_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # New semantic scene format
    if (
    isinstance(data, dict)
    and "scenes" in data
    and isinstance(data["scenes"], list)
):
        voices = []
        for scene in data["scenes"]:
            voice = scene.get("voice", "").strip()
            if voice:
                voices.append(voice)
        TEXT = " ".join(voices)

    # Old format compatibility
    elif isinstance(data, dict):
        TEXT = data.get("script", "").strip()
    else:
        TEXT = ""

except Exception as e:
    print(f"⚠️ Warning: Could not read content.json: {e}")
    TEXT = ""

async def run_synthesis(text, voice_name, output_path):
    """Executes the voice synthesis request."""
    communicate = edge_tts.Communicate(text, voice=voice_name, rate="-4%")
    await communicate.save(output_path)

    if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
        return True

    print("⚠️ Empty audio produced.")
    return False

def get_audio_duration(path):
    """Return the audio duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [
                str(FFPROBE),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip() or -1)
    except Exception:
        return -1.0

async def main():
    if not TEXT or TEXT.strip() == "":
        print("❌ Error: Script text is empty. Cannot compile blank media timeline frames.")
        sys.exit(1)
        
    print(f"🎙️ Synthesizing humanized narrative text string ({len(TEXT.split())} words)...")
    print("\n------------------ NARRATION ------------------\n")
    print(TEXT)
    print("\n-----------------------------------------------\n")
    voice_gender = sys.argv[3] if len(sys.argv) > 3 else "female"

    voice_map = MALE_VOICE_MAP if voice_gender == "male" else FEMALE_VOICE_MAP
    selected_voice = voice_map.get(
    language,
    "en-US-GuyNeural" if voice_gender == "male" else "en-US-JennyNeural",
)
    candidate_voices = [selected_voice]
    for alt_voice in FALLBACK_VOICE_MAP.get(language, []):
        if alt_voice not in candidate_voices:
            candidate_voices.append(alt_voice)

    success = False
    
    print("=" * 50)
    print(f"Selected Language : {language}")
    print(f"Selected Voice    : {selected_voice}")
    print("=" * 50)
    
    for voice in candidate_voices:
        try:
            print(f"🔊 Attempting synth with voice: {voice}")

            await run_synthesis(TEXT, voice, OUTPUT)

            if not os.path.exists(OUTPUT):
                raise RuntimeError("Audio file wasn't created")

            if os.path.getsize(OUTPUT) < 1000:
                raise RuntimeError("Audio file is empty")

            duration = get_audio_duration(OUTPUT)

            if duration < 0.5:
                raise RuntimeError("Audio duration too short")

            print(f"✅ Voice synthesis succeeded ({voice})")
            success = True
            break

        except Exception as e:
            print(f"⚠️ {voice} failed: {e}")

    if not success:
        print("❌ Critical: All neural speech endpoints rejected parameters or returned no audio packet frames.")
        print("   This is almost always Microsoft's edge-tts token validation (Sec-MS-GEC) rejecting the")
        print("   request — a known, recurring issue with this free/unofficial TTS backend. The fix is")
        print("   usually upgrading the edge-tts package to its latest release (see requirements.txt).")
        # Previously this silently generated 5s of dead silence and reported
        # success — meaning the pipeline would go on to produce a complete,
        # "successful" video with zero spoken narration. Unlike background
        # music (a genuinely optional nice-to-have), narration IS the
        # content — a silent voiceover isn't a usable fallback, it's a
        # broken final video that looks like it worked. Fail the pipeline
        # here instead, so PipelineRunner reports a real, visible error
        # rather than shipping something unusable.
        raise RuntimeError(
            "Narration generation failed for every candidate voice "
            f"({', '.join(candidate_voices)}). No usable audio was produced. "
            "See the edge-tts errors above — this is typically an outdated "
            "edge-tts package version; try upgrading it in requirements.txt."
        )

if __name__ == "__main__":
    asyncio.run(main())