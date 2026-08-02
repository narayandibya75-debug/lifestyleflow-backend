# python/providers/stability_image_provider.py
#
# Not part of the doc's core provider list, but included to preserve
# backward compatibility: the original download_stock.py already had a
# working Stability AI still-image fallback for when stock search came up
# completely empty. This wraps that same logic behind the standard
# provider interface as the manager's final tier, so that existing
# behavior isn't lost by this refactor — see manager.py's fallback chain.
#
# This is a genuinely live, working integration (unlike the AI *video*
# provider placeholders in this package) — it was already functioning in
# the pre-refactor code.

import os
from pathlib import Path

import requests

from .base_provider import BaseVideoProvider
from .registry import register_provider

STABILITY_URL = "https://api.stability.ai/v2beta/stable-image/generate/core"


@register_provider
class StabilityImageProvider(BaseVideoProvider):
    name = "stability_image"

    def __init__(self, config):
        super().__init__(config)
        self.api_key = os.getenv("STABILITY_API_KEY")

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        if not self.api_key:
            print("⚠️ [stability_image] STABILITY_API_KEY not set — skipping.")
            return False

        image_prompt = scene.get("visual_prompt") or scene.get("voice") or prompt

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "image/*",
        }
        files = {
            "prompt": (None, image_prompt),
            "aspect_ratio": (None, "9:16"),
            "output_format": (None, "png"),
        }

        try:
            response = requests.post(STABILITY_URL, headers=headers, files=files, timeout=120)
        except Exception as e:
            print(f"⚠️ [stability_image] Request failed: {e}")
            return False

        if response.status_code != 200:
            print(f"⚠️ [stability_image] API error {response.status_code}: {response.text[:200]}")
            return False

        with open(output_path, "wb") as f:
            f.write(response.content)

        if not output_path.exists() or output_path.stat().st_size < 10_000:
            output_path.unlink(missing_ok=True)
            return False

        print(f"✅ [stability_image] Saved {output_path.name}")
        return True
