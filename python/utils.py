import shutil
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

# Optional: a bundled ffmpeg-8.1.2-essentials_build/bin/ next to the project
# (Windows "essentials" zip layout). If it's not there, we fall back to
# whatever ffmpeg/ffprobe is on the system PATH, so this works on
# Windows/macOS/Linux without any manual setup.
_BUNDLED_DIR = PROJECT / "ffmpeg-8.1.2-essentials_build" / "bin"


def _resolve_binary(name: str) -> Path:
    # 1. Bundled build (Windows-style, with or without .exe)
    for candidate in (_BUNDLED_DIR / f"{name}.exe", _BUNDLED_DIR / name):
        if candidate.exists():
            return candidate

    # 2. Whatever's on the system PATH (macOS/Linux via brew/apt, or a
    #    Windows ffmpeg.exe that's already on PATH)
    found = shutil.which(name) or shutil.which(f"{name}.exe")
    if found:
        return Path(found)

    raise FileNotFoundError(
        f"{name} not found. Either drop an 'ffmpeg-8.1.2-essentials_build/bin/' "
        f"folder next to the project, or install ffmpeg so it's on your PATH "
        f"(e.g. `brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux, "
        f"or download the Windows build and add its bin/ folder to PATH)."
    )


FFMPEG = _resolve_binary("ffmpeg")
FFPROBE = _resolve_binary("ffprobe")