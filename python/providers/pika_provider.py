# python/providers/pika_provider.py
#
# PLACEHOLDER PROVIDER — see openai_provider.py's docstring for the
# rationale. Same pattern here: fully wired into the registry/manager/
# fallback chain, `_call_api()` just needs implementing against Pika's
# current API docs.
#
# To activate: implement _call_api(), set PIKA_API_KEY, and set
# VISUAL_PROVIDER=pika.

import os
from pathlib import Path

from .base_provider import BaseVideoProvider
from .registry import register_provider


@register_provider
class PikaProvider(BaseVideoProvider):
    name = "pika"

    def __init__(self, config):
        super().__init__(config)
        self.api_key = os.getenv("PIKA_API_KEY")

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        if not self.api_key:
            print("⚠️ [pika] PIKA_API_KEY not set — skipping.")
            return False

        try:
            return self._call_api(prompt, scene, output_path)
        except Exception as e:
            print(f"⚠️ [pika] Generation failed: {e}")
            return False

    def _call_api(self, prompt: str, scene: dict, output_path: Path) -> bool:
        """
        TODO: implement the real Pika call here (submit prompt + duration,
        poll until complete, download to output_path, return True only on
        confirmed success). See openai_provider.py's docstring for the
        shared pattern every provider in this package follows.
        """
        print("⚠️ [pika] _call_api() is not implemented yet — see this file's docstring.")
        return False
