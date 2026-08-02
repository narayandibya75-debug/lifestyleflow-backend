import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent

MUSIC = BASE / "assets" / "music"

library = []

for folder in MUSIC.iterdir():

    if not folder.is_dir():
        continue

    genre = folder.name

    for file in folder.glob("*.mp3"):

        library.append({

            "file": str(file.relative_to(MUSIC)).replace("\\","/"),

            "genre": genre.capitalize(),

            "energy": "Medium",

            "mood": genre.capitalize(),

            "bpm": 100

        })

output = MUSIC / "music_library.json"

with open(output,"w",encoding="utf8") as f:
    json.dump(library,f,indent=4)
    
print()
print("Music library created")
print(output)

print(f"{len(library)} songs indexed.")