# python/download_stock.py
#
# Visual acquisition stage of the pipeline. This used to contain the
# Pexels search/rank/download logic directly; that logic now lives in
# python/providers/pexels_provider.py, and this script just orchestrates
# VideoProviderManager per scene — see python/providers/manager.py for the
# actual provider-selection/retry/fallback logic.
#
# Nothing downstream of this script changed: it still writes clips under
# downloads/, still sets scene["clip"] / scene["asset_type"] in
# content.json, and still exits non-zero only if every scene completely
# failed to produce a clip — trim_clips.py, create_timeline.py, etc. don't
# need any changes.

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from providers import VideoProviderManager, load_config

BASE_DIR = Path(__file__).resolve().parent.parent

if len(sys.argv) > 1:
    WORKING_DIR = Path(sys.argv[1]).resolve()
else:
    WORKING_DIR = BASE_DIR

print(f"📁 Working Directory: {WORKING_DIR}")

DOWNLOAD_DIR = WORKING_DIR / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

CONTENT_FILE = WORKING_DIR / "content.json"

load_dotenv(BASE_DIR / ".env.local")
load_dotenv(BASE_DIR / ".env")


def clean_download_folder():
    print("🧹 Cleaning download folder...")
    for file in DOWNLOAD_DIR.glob("*"):
        if file.suffix.lower() in [".mp4", ".png", ".jpg", ".jpeg"]:
            try:
                file.unlink()
            except Exception as e:
                print(e)


def load_scenes():
    if not CONTENT_FILE.exists():
        raise FileNotFoundError(CONTENT_FILE)

    with open(CONTENT_FILE, encoding="utf8") as f:
        content = json.load(f)

    if "scenes" not in content:
        raise Exception("content.json has no scenes")

    scenes = content["scenes"]

    if len(scenes) == 0:
        raise Exception("No scenes")

    print(f"Loaded {len(scenes)} scenes")
    return content, scenes


def update_scene_metadata(scene: dict, result) -> None:
    scene["clip"] = str(result.path.relative_to(WORKING_DIR))
    scene["asset_type"] = result.asset_type
    scene["provider"] = result.provider
    scene["visual_prompt_used"] = result.prompt
    scene["generation_attempts"] = result.attempts
    scene["status"] = "downloaded" if result.asset_type == "video" else "generated"


def process_pipeline(scenes: list, manager: VideoProviderManager):
    print(f"🎬 Initiating acquisition pipeline for {len(scenes)} narrative beats.")
    print(f"⚙️ Primary provider: {manager.config.visual_provider} "
          f"(AI_VIDEO_ENABLED={manager.config.ai_video_enabled}, "
          f"PEXELS_FALLBACK={manager.config.pexels_fallback})")

    for i, scene in enumerate(scenes, start=1):
        print(f"\n{'='*60}")
        print(f"Generating scene {i}/{len(scenes)}")
        print(f"{'='*60}")
        print(f"Context Text: \"{scene.get('voice', '')}\"")

        result = manager.generate(scene, i, DOWNLOAD_DIR)

        if result.success:
            update_scene_metadata(scene, result)
            print(f"✅ Scene {i} secured via {result.provider}: {scene['clip']}")
        else:
            print(f"❌ Scene {i} completely failed — no provider produced a usable clip.")
            scene["status"] = "failed"
            scene["clip"] = None
            scene["asset_type"] = None


def save_content(data, scenes):
    with open(CONTENT_FILE, "w", encoding="utf8") as f:
        if isinstance(data, dict):
            data["scenes"] = scenes
        json.dump(data, f, indent=4, ensure_ascii=False)
    print("💾 content.json updated.")


def print_summary(scenes: list):
    video_count = sum(1 for s in scenes if s.get("asset_type") == "video")
    image_count = sum(1 for s in scenes if s.get("asset_type") == "image")
    failed_count = sum(1 for s in scenes if s.get("status") == "failed")

    print("\n==============================")
    print("DOWNLOAD SUMMARY")
    print("==============================")
    print(f"Videos : {video_count}")
    print(f"Images : {image_count}")
    print(f"Failed : {failed_count}")
    print(f"Scenes : {len(scenes)}")
    print("==============================")


if __name__ == "__main__":
    data, scenes = load_scenes()
    clean_download_folder()

    config = load_config()
    manager = VideoProviderManager(config)

    process_pipeline(scenes, manager)
    save_content(data, scenes)
    print_summary(scenes)

    if all(s.get("status") == "failed" for s in scenes):
        print("❌ Every scene failed to acquire a visual asset.")
        sys.exit(1)
