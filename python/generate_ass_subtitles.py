import sys
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# -------------------------------------------------------
# Working Directory
# -------------------------------------------------------

if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    language = sys.argv[2] if len(sys.argv) > 2 else "en"

    print(f"📁 Isolated Execution Mode active. Target directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR
    language = "en"

    print(f"📁 Global Execution Mode active. Target directory: {WORKING_DIR}")

FONT_MAP = {
    "en": "Montserrat ExtraBold",

    "hi": "Noto Sans Devanagari",
    "mr": "Noto Sans Devanagari",

    "bn": "Noto Sans Bengali",

    "ta": "Noto Sans Tamil",

    "te": "Noto Sans Telugu",

    "kn": "Noto Sans Kannada",

    "ml": "Noto Sans Malayalam",

    "gu": "Noto Sans Gujarati",

    "pa": "Noto Sans Gurmukhi",

    "fr": "Montserrat ExtraBold",
    "de": "Montserrat ExtraBold",
    "es": "Montserrat ExtraBold",

    "ja": "Noto Sans JP",

    "ko": "Noto Sans KR",

    "zh": "Noto Sans SC",
}

FONT = FONT_MAP.get(language, "Montserrat ExtraBold")


WORD_TIMINGS = WORKING_DIR / "word_timings.json"
OUTPUT_ASS = WORKING_DIR / "captions.ass"

if not WORD_TIMINGS.exists():
    raise FileNotFoundError(WORD_TIMINGS)

with open(WORD_TIMINGS, encoding="utf-8") as f:
    phrases = json.load(f)["phrases"]


# -------------------------------------------------------
# ASS Time Formatter
# -------------------------------------------------------

def ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    return f"{h}:{m:02}:{s:02}.{cs:02}"


# -------------------------------------------------------
# ASS Header
# -------------------------------------------------------

header = f"""[Script Info]
Title: LifestyleFlow AI
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding

Style: Default,{FONT},44,&H00FFFFFF,&H0000FFFF,&H000000,&H64000000,1,0,0,0,100,100,0,0,1,3,0,2,60,60,220,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""

lines = [header]

# -------------------------------------------------------
# Generate Karaoke Captions
# -------------------------------------------------------

for phrase in phrases:

    words = phrase.get("words", [])

    if not words:
        continue

    start = words[0]["start"]
    end = words[-1]["end"]

    karaoke = ""

    for word in words:

        duration = max(
            1,
            int(round((word["end"] - word["start"]) * 100))
        )

        karaoke += f"{{\\k{duration}}}{word['word']} "

    lines.append(
        "Dialogue: 0,"
        f"{ass_time(start)},"
        f"{ass_time(end)},"
        "Default,,0,0,0,,"
        f"{karaoke.strip()}"
    )

# -------------------------------------------------------
# Save
# -------------------------------------------------------

with open(OUTPUT_ASS, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"✅ Generated {OUTPUT_ASS}")