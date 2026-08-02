import subprocess
from utils import FFPROBE

def get_duration(file):
    result = subprocess.check_output([
        str(FFPROBE),
        "-v","error",
        "-show_entries","format=duration",
        "-of","default=noprint_wrappers=1:nokey=1",
        str(file)
    ])

    return float(result)