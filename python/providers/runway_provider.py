# python/providers/runway_provider.py
#
# PLACEHOLDER PROVIDER — see openai_provider.py's docstring for the
# rationale. Runway does publish a developer API (api.dev.runwayml.com as
# of recent docs, typically an async task-submit + poll pattern), but
# exact model names/params/pricing change often enough that hardcoding
# them here risks shipping something subtly wrong. Wire up `_call_api()`
# against your current Runway API dashboard/docs.
#
# To activate: implement _call_api(), set RUNWAY_API_KEY, and set
# VISUAL_PROVIDER=runway.

import os
from pathlib import Path

from .base_provider import BaseVideoProvider
from .registry import register_provider


@register_provider
class RunwayProvider(BaseVideoProvider):
    name = "runway"

    def __init__(self, config):
        super().__init__(config)
        self.api_key = os.getenv("RUNWAY_API_KEY")

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        if not self.api_key:
            print("⚠️ [runway] RUNWAY_API_KEY not set — skipping.")
            return False

        try:
            return self._call_api(prompt, scene, output_path)
        except Exception as e:
            print(f"⚠️ [runway] Generation failed: {e}")
            return False

    def _call_api(self, prompt: str, scene: dict, output_path: Path) -> bool:
        """
        TODO: implement the real Runway call here — typically:
          1. POST a generation task with `prompt`, duration, and
             resolution/aspect ratio.
          2. Poll GET .../tasks/{id} until status is SUCCEEDED/FAILED.
          3. Download the resulting asset URL to `output_path`.
          4. Return True only once the file is confirmed written.
        See openai_provider.py's docstring for the shared pattern.
        """
        print("⚠️ [runway] _call_api() is not implemented yet — see this file's docstring.")
        return False
