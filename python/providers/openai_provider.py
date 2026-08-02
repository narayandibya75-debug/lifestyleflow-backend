# python/providers/openai_provider.py
#
# PLACEHOLDER PROVIDER.
#
# OpenAI's video-generation API (Sora) is evolving quickly and access is
# gated — rather than hardcode a specific endpoint/payload shape that could
# be stale or simply wrong by the time this runs (silently wasting API
# calls or failing in a confusing way), this provider is a real, wired-in
# extension point: it's registered, respects config, and falls back
# cleanly. Fill in `_call_api()` once you have your account's actual API
# docs in front of you — everything else (retry, validation, fallback,
# logging) already works with zero other changes needed.
#
# To activate: implement _call_api() below, set OPENAI_API_KEY, and set
# VISUAL_PROVIDER=openai (or AI_VIDEO_ENABLED=true with this as a
# non-primary tier — see manager.py).

import os
from pathlib import Path

from .base_provider import BaseVideoProvider
from .registry import register_provider


@register_provider
class OpenAIVideoProvider(BaseVideoProvider):
    name = "openai"

    def __init__(self, config):
        super().__init__(config)
        self.api_key = os.getenv("OPENAI_API_KEY")

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        if not self.api_key:
            print("⚠️ [openai] OPENAI_API_KEY not set — skipping.")
            return False

        try:
            return self._call_api(prompt, scene, output_path)
        except Exception as e:
            print(f"⚠️ [openai] Generation failed: {e}")
            return False

    def _call_api(self, prompt: str, scene: dict, output_path: Path) -> bool:
        """
        TODO: implement the real OpenAI video-generation call here.

        Expected shape (adjust to match current OpenAI API docs):
          1. Submit a generation job with `prompt`, target duration
             (scene.get("duration")), and aspect ratio
             (self.config.video_width / self.config.video_height).
          2. Poll the job until it completes or times out.
          3. Download the resulting video to `output_path`.
          4. Return True only once `output_path` exists and is non-empty.

        Until this is implemented, always return False so the manager
        falls back to the next configured tier (Pexels, by default).
        """
        print("⚠️ [openai] _call_api() is not implemented yet — see this file's docstring.")
        return False
