# python/providers/manager.py
#
# VideoProviderManager is the ONLY thing the rest of the pipeline should
# call — never a provider class directly. It owns: reading config,
# choosing the active provider, building the prompt, attempting AI
# generation (with retries), validating the result, and falling back
# through Pexels and finally a still-image generator if everything else
# fails. One scene failing never stops the pipeline — it's marked and the
# loop continues (see download_stock.py, which calls this per scene).

from pathlib import Path
from typing import Optional

from .config import ProviderConfig, load_config
from .prompt_engine import build_cinematic_prompt
from .registry import PROVIDER_REGISTRY
from .validation import validate_video_clip, validate_image

# Providers, in the order they're tried after the configured primary
# provider fails (or is disabled). Order matters: video-shaped fallbacks
# before the still-image last resort.
FALLBACK_CHAIN = ["pexels", "stability_image"]


class GenerationResult:
    """What the manager hands back to the caller for one scene."""

    def __init__(self, success: bool, path: Optional[Path], asset_type: str,
                 provider: str, prompt: str, attempts: int):
        self.success = success
        self.path = path
        self.asset_type = asset_type  # "video" | "image" | None
        self.provider = provider
        self.prompt = prompt
        self.attempts = attempts


class VideoProviderManager:
    def __init__(self, config: Optional[ProviderConfig] = None):
        self.config = config or load_config()

    def _get_provider(self, name: str):
        provider_cls = PROVIDER_REGISTRY.get(name)
        if provider_cls is None:
            print(f"⚠️ Unknown provider '{name}' (not registered). Skipping.")
            return None
        return provider_cls(self.config)

    def _attempt(self, provider, scene: dict, prompt: str, output_path: Path) -> bool:
        if not provider.is_configured():
            print(f"⚠️ [{provider.name}] Not configured — skipping.")
            return False

        try:
            ok = provider.generate(scene, prompt, output_path)
        except Exception as e:
            # A provider is only supposed to return False on expected
            # failure — but if one raises unexpectedly, don't let that
            # take down the whole scene loop either.
            print(f"⚠️ [{provider.name}] Raised an unexpected error: {e}")
            return False

        if not ok:
            return False

        is_image = output_path.suffix.lower() in (".png", ".jpg", ".jpeg")
        result = (
            validate_image(output_path)
            if is_image
            else validate_video_clip(output_path, expected_duration=scene.get("duration"))
        )

        if not result.valid:
            print(f"⚠️ [{provider.name}] Generated clip failed validation: {result.reason}")
            output_path.unlink(missing_ok=True)
            return False

        print(f"✅ [{provider.name}] Clip validated.")
        return True

    def generate(self, scene: dict, scene_index: int, downloads_dir: Path) -> GenerationResult:
        """Generates (or downloads) the best available visual for one
        scene, trying the configured primary provider first, then falling
        back through FALLBACK_CHAIN. Returns a GenerationResult describing
        what happened — never raises for expected failure modes."""
        downloads_dir.mkdir(parents=True, exist_ok=True)
        prompt = build_cinematic_prompt(scene, self.config)

        video_output = downloads_dir / f"scene_{scene_index:03d}.mp4"
        image_output = downloads_dir / f"scene_{scene_index:03d}.png"

        attempts_made = 0
        primary_name = self.config.visual_provider

        # 1. Primary AI provider (skipped entirely if AI_VIDEO_ENABLED is
        #    False, or the primary provider IS pexels/stability_image —
        #    those aren't "AI video" tiers, they're already in the
        #    fallback chain below).
        if self.config.ai_video_enabled and primary_name not in FALLBACK_CHAIN:
            provider = self._get_provider(primary_name)
            if provider is not None:
                for attempt in range(1, self.config.max_ai_retries + 1):
                    attempts_made += 1
                    print(f"🎬 Generating scene {scene_index} — Provider: {provider.name} "
                          f"(attempt {attempt}/{self.config.max_ai_retries})")
                    print(f"   Prompt: {prompt}")

                    if self._attempt(provider, scene, prompt, video_output):
                        print(f"Saved:\ndownloads/{video_output.name}")
                        return GenerationResult(
                            True, video_output, "video", provider.name, prompt, attempts_made
                        )

                print(f"❌ [{provider.name}] AI generation failed after "
                      f"{self.config.max_ai_retries} attempt(s).")
                print("Reason:\nProvider returned no valid clip.")

        # 2. Fallback chain (Pexels, then a still image as a last resort),
        #    unless fallback has been explicitly disabled.
        if not self.config.pexels_fallback and not self.config.ai_video_enabled:
            # Neither AI nor fallback enabled — nothing left to try.
            return GenerationResult(False, None, None, "", prompt, attempts_made)

        for fallback_name in FALLBACK_CHAIN:
            if fallback_name == "pexels" and not self.config.pexels_fallback:
                continue

            provider = self._get_provider(fallback_name)
            if provider is None:
                continue

            output_path = image_output if fallback_name == "stability_image" else video_output
            asset_type = "image" if fallback_name == "stability_image" else "video"

            attempts_made += 1
            if attempts_made > 1:
                print("Switching to Pexels..." if fallback_name == "pexels"
                      else "Switching to AI image fallback...")

            if self._attempt(provider, scene, prompt, output_path):
                if fallback_name == "pexels":
                    print("Downloaded replacement clip.")
                return GenerationResult(
                    True, output_path, asset_type, provider.name, prompt, attempts_made
                )

        print(f"❌ Scene {scene_index}: every provider (primary + fallback chain) failed.")
        return GenerationResult(False, None, None, "", prompt, attempts_made)
