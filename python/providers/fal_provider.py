# python/providers/fal_provider.py
#
# A REAL, WORKING provider (unlike openai/veo/runway/pika/kling_provider.py,
# which are placeholders — see their docstrings for why). fal.ai fronts
# Kling, Runway, Luma Ray, and dozens of other video models behind one
# consistent queue-based API, so this one file gives you access to all of
# them — just change FAL_MODEL, no new provider needed.
#
# API shape used here (fal's documented queue pattern, stable across their
# whole catalog):
#   1. POST https://queue.fal.run/{FAL_MODEL}  ->  {request_id, status_url, response_url}
#   2. Poll status_url until status == "COMPLETED"
#   3. GET response_url  ->  the model's output (a video URL, in a couple of
#      possible shapes depending on the model)
#   4. Download that URL to output_path
#
# WHAT TO VERIFY BEFORE YOUR FIRST REAL RUN:
#   - FAL_MODEL: the exact slug for the model you picked (Kling, Luma Ray 2,
#     etc.) — copy this straight from that model's page on fal.ai, the
#     default below is a best-effort guess and may be stale.
#   - The input field name(s): almost every fal text-to-video model accepts
#     `prompt` as a plain string, which is what's sent below. If your chosen
#     model's page shows different required fields (e.g. an `image_url` for
#     image-to-video variants), add them via FAL_EXTRA_PARAMS (JSON) rather
#     than editing this file.
#   - The output field name: fal video models typically return the clip
#     under `video.url` — this code also checks a couple of common
#     alternates, but if your model uses something else, check the response
#     shape in the logs (printed on validation failure) and adjust
#     _extract_video_url() below.

import json
import os
import time
from pathlib import Path
from typing import Optional

import requests

from .base_provider import BaseVideoProvider
from .registry import register_provider

FAL_QUEUE_BASE = "https://queue.fal.run"

# Best-effort default — VERIFY against fal.ai's current model page for
# whichever model you're actually paying for before relying on this.
DEFAULT_MODEL = "fal-ai/kling-video/v2.1/standard/text-to-video"

POLL_INTERVAL_SECONDS = 4
DEFAULT_TIMEOUT_SECONDS = 300


@register_provider
class FalProvider(BaseVideoProvider):
    name = "fal"

    def __init__(self, config):
        super().__init__(config)
        self.api_key = os.getenv("FAL_API_KEY")
        self.model = os.getenv("FAL_MODEL", DEFAULT_MODEL).strip()
        self.timeout = int(os.getenv("FAL_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))

        # Optional extra input fields for whichever model you picked, as raw
        # JSON — e.g. FAL_EXTRA_PARAMS={"duration":"5","aspect_ratio":"9:16"}
        # Merged into the request body alongside `prompt`. Left empty by
        # default so we never send a field a given model doesn't recognize.
        raw_extra = os.getenv("FAL_EXTRA_PARAMS", "").strip()
        self.extra_params = {}
        if raw_extra:
            try:
                self.extra_params = json.loads(raw_extra)
            except json.JSONDecodeError:
                print(f"⚠️ [fal] FAL_EXTRA_PARAMS is not valid JSON, ignoring: {raw_extra!r}")

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json",
        }

    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        if not self.api_key:
            print("⚠️ [fal] FAL_API_KEY not set — skipping.")
            return False

        try:
            submission = self._submit(prompt)
            if submission is None:
                return False

            result = self._poll(submission)
            if result is None:
                return False

            video_url = self._extract_video_url(result)
            if not video_url:
                print(f"⚠️ [fal] Could not find a video URL in the response. "
                      f"Raw response (first 500 chars): {json.dumps(result)[:500]}")
                return False

            return self._download(video_url, output_path)

        except Exception as e:
            print(f"⚠️ [fal] Generation failed: {e}")
            return False

    def _submit(self, prompt: str) -> Optional[dict]:
        body = {"prompt": prompt, **self.extra_params}

        print(f"🎬 [fal] Submitting to model: {self.model}")
        response = requests.post(
            f"{FAL_QUEUE_BASE}/{self.model}",
            headers=self._headers(),
            json=body,
            timeout=30,
        )

        if response.status_code not in (200, 201, 202):
            print(f"⚠️ [fal] Submit failed ({response.status_code}): {response.text[:300]}")
            return None

        data = response.json()
        if "status_url" not in data or "response_url" not in data:
            print(f"⚠️ [fal] Unexpected submit response shape: {json.dumps(data)[:300]}")
            return None

        print(f"✅ [fal] Job submitted (request_id={data.get('request_id', '?')})")
        return data

    def _poll(self, submission: dict) -> Optional[dict]:
        status_url = submission["status_url"]
        response_url = submission["response_url"]
        headers = self._headers()

        elapsed = 0
        while elapsed < self.timeout:
            try:
                status_response = requests.get(status_url, headers=headers, timeout=30)
            except Exception as e:
                print(f"⚠️ [fal] Status check failed: {e}")
                return None

            if status_response.status_code != 200:
                print(f"⚠️ [fal] Status check returned {status_response.status_code}")
                return None

            status = status_response.json().get("status")

            if status == "COMPLETED":
                print("✅ [fal] Generation complete, fetching result...")
                result_response = requests.get(response_url, headers=headers, timeout=30)
                if result_response.status_code != 200:
                    print(f"⚠️ [fal] Fetching result failed ({result_response.status_code})")
                    return None
                return result_response.json()

            if status in ("IN_QUEUE", "IN_PROGRESS"):
                print(f"⏳ [fal] Status: {status} ({elapsed}s elapsed)")
                time.sleep(POLL_INTERVAL_SECONDS)
                elapsed += POLL_INTERVAL_SECONDS
                continue

            # Anything else (FAILED, CANCELLED, etc.)
            print(f"⚠️ [fal] Job ended with unexpected status: {status}")
            return None

        print(f"⚠️ [fal] Timed out after {self.timeout}s waiting for generation.")
        return None

    def _extract_video_url(self, result: dict) -> str:
        """fal video models mostly return {"video": {"url": "..."}}, but
        a few use flatter shapes — check the common alternates before
        giving up."""
        candidates = [
            result.get("video", {}).get("url") if isinstance(result.get("video"), dict) else None,
            result.get("video_url"),
            result.get("output", {}).get("video", {}).get("url")
                if isinstance(result.get("output"), dict) else None,
            result.get("url"),
        ]
        for candidate in candidates:
            if candidate:
                return candidate
        return ""

    def _download(self, url: str, output_path: Path) -> bool:
        try:
            response = requests.get(url, stream=True, timeout=120)
        except Exception as e:
            print(f"⚠️ [fal] Download failed: {e}")
            return False

        if response.status_code != 200:
            print(f"⚠️ [fal] Download returned {response.status_code}")
            return False

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(65536):
                if chunk:
                    f.write(chunk)

        if not output_path.exists() or output_path.stat().st_size < 50_000:
            output_path.unlink(missing_ok=True)
            return False

        print(f"✅ [fal] Saved {output_path.name}")
        return True
