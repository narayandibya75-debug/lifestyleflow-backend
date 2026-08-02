import sys
import json
import random
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------
# Working directory
# ---------------------------------------------------

if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
    print(f"📁 Working directory: {WORKING_DIR}")
else:
    WORKING_DIR = BASE_DIR

CONTENT_FILE = WORKING_DIR / "content.json"

LIBRARY_FILE = BASE_DIR / "assets" / "music" / "music_library.json"

MUSIC_ROOT = BASE_DIR / "assets" / "music"

OUTPUT_DIR = WORKING_DIR / "music"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT = OUTPUT_DIR / "background.mp3"

# ---------------------------------------------------
# Load files
# ---------------------------------------------------

if not CONTENT_FILE.exists():
    raise FileNotFoundError(CONTENT_FILE)

# No music library yet (assets/music/music_library.json + the actual mp3s
# under assets/music/<genre>/ haven't been added to this deployment). Skip
# background music entirely rather than failing the whole generation —
# add_background_music.py falls back to narration-only audio when it finds
# no music/background.mp3 here.
if not LIBRARY_FILE.exists():
    print(f"⚠️ No music library found at {LIBRARY_FILE}.")
    print("⚠️ Skipping background music selection — video will use narration only.")
    print("   To enable background music, add mp3s under assets/music/<genre>/")
    print("   and run: python python/build_music_library.py")
    sys.exit(0)

with open(CONTENT_FILE, encoding="utf8") as f:
    content = json.load(f)

with open(LIBRARY_FILE, encoding="utf8") as f:
    library = json.load(f)

if len(library) == 0:
    print("⚠️ Music library is empty. Skipping background music selection.")
    sys.exit(0)

# ---------------------------------------------------
# AI metadata
# ---------------------------------------------------

music = content.get("background_music", {})

genre = str(music.get("genre", "")).lower()

mood = str(music.get("mood", "")).lower()

energy = str(music.get("energy", "")).lower()

bpm = int(music.get("bpm", 100))
# --------------------------------------------
# Genre aliases
# --------------------------------------------

GENRE_ALIASES = {

    "technology": "tech",
    "electronic": "tech",

    "business": "corporate",
    "startup": "corporate",

    "motivation": "inspirational",
    "motivational": "inspirational",

    "cinema": "cinematic",

    "education": "educational",

    "holiday": "travel",

    "wealth": "finance",

    "cars": "luxury",

    "history": "documentary"
}

genre = GENRE_ALIASES.get(genre, genre)

print()
print("Requested Music")
print("----------------")
print("Genre :", genre)
print("Mood  :", mood)
print("Energy:", energy)
print("BPM   :", bpm)
print()

# ---------------------------------------------------
# Score every song
# ---------------------------------------------------
ENERGY_LEVEL = {
    "low": 1,
    "medium": 2,
    "high": 3
}
best_score = -1

best = None
for song in library:

    score = 0

    song_genre = song["genre"].lower()

    song_mood = song["mood"].lower()

    song_energy = song["energy"].lower()

    song_bpm = song["bpm"]

    # -------------------------
    # Genre
    # -------------------------

    if song_genre == genre:

        score += 50

    elif genre in song_genre:

        score += 35

    # -------------------------
    # Mood
    # -------------------------

    if song_mood == mood:

        score += 25

    elif mood in song_mood:

        score += 15

    # -------------------------
    # Energy
    # -------------------------

    desired = ENERGY_LEVEL.get(energy, 2)

    current = ENERGY_LEVEL.get(song_energy, 2)

    diff = abs(desired-current)

    if diff == 0:

        score += 20

    elif diff == 1:

        score += 10

    # -------------------------
    # BPM
    # -------------------------

    bpm_difference = abs(song_bpm-bpm)

    score += max(0,20-bpm_difference/4)

    # -------------------------
    # Keep highest
    # -------------------------

    if score > best_score:

        best_score = score

        best = song
# ---------------------------------------------------
# Fallback
# ---------------------------------------------------

if best is None:
    print("No close match found.")
    best = random.choice(library)
    print("Using random fallback.")

print("Selected Song")
print("----------------")
print(f"Score : {best_score:.1f}")
print(f"File  : {best['file']}")
print(f"Genre : {best['genre']}")
print(f"Mood  : {best['mood']}")
print(f"Energy: {best['energy']}")
print(f"BPM   : {best['bpm']}")
print()
# ---------------------------------------------------
# Copy
# ---------------------------------------------------

source = MUSIC_ROOT / best["file"]

if not source.exists():
    print(f"⚠️ Selected song file is missing on disk: {source}")
    print("⚠️ Skipping background music — video will use narration only.")
    sys.exit(0)

shutil.copy2(source, OUTPUT)

print("✅ Background music copied")
print(OUTPUT)