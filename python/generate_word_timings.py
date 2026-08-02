import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel

BASE_DIR = Path(__file__).resolve().parent.parent

# -------------------------------------------------------
# Working Directory
# -------------------------------------------------------
if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    language = sys.argv[2] if len(sys.argv) > 2 else "en"
else:
    WORKING_DIR = BASE_DIR
    language = "en"

AUDIO_FILE = WORKING_DIR / "final_audio.mp3"
OUTPUT_FILE = WORKING_DIR / "word_timings.json"

if not AUDIO_FILE.exists():
    raise FileNotFoundError(AUDIO_FILE)

print("Loading Whisper model...")
ENGLISH_MODEL = "base"
MULTILINGUAL_MODEL = "small"
MODEL_NAME = ENGLISH_MODEL if language == "en" else MULTILINGUAL_MODEL

print(f"Loading Whisper model: {MODEL_NAME}")
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

print("Transcribing narration...")
segments, info = model.transcribe(
    str(AUDIO_FILE),
    language=language,
    word_timestamps=True,
    vad_filter=True,
    beam_size=5,
    condition_on_previous_text=False
)

phrases = []
current_phrase = {"text": "", "words": []}
MAX_WORDS = 6
MAX_DURATION = 2.2

for segment in segments:
    if not segment.words:
        continue
    
    for word in segment.words:
        token = word.word.strip()
        if not token:
            continue
        
        # Add word
        current_phrase["words"].append({
            "word": token,
            "start": round(word.start, 2),
            "end": round(word.end, 2)
        })
        
        if current_phrase["text"]:
            current_phrase["text"] += " "
        current_phrase["text"] += token
        
        # Check if phrase should end
        end_phrase = False
        
        # Check word count
        if len(current_phrase["words"]) >= MAX_WORDS:
            end_phrase = True
        
        # Check duration (only if we have words)
        if not end_phrase and len(current_phrase["words"]) >= 2:
            duration = current_phrase["words"][-1]["end"] - current_phrase["words"][0]["start"]
            if duration >= MAX_DURATION:
                end_phrase = True
        
        # Check punctuation
        if not end_phrase and token.endswith((".", ",", "!", "?", ";", ":")):
            end_phrase = True
        
        if end_phrase:
            phrases.append(current_phrase)
            current_phrase = {"text": "", "words": []}

# Don't forget the last phrase
if current_phrase["words"]:
    phrases.append(current_phrase)

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump({"phrases": phrases}, f, indent=4, ensure_ascii=False)

print(f"Generated {len(phrases)} caption phrases.")
print(f"Saved to {OUTPUT_FILE}")