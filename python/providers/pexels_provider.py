# python/providers/pexels_provider.py
#
# The only provider that's a real, fully-working implementation today (the
# others are placeholders awaiting real API access — see each file's
# docstring). This is the same search -> rank -> download logic that used
# to live directly in download_stock.py, now wrapped behind the standard
# BaseVideoProvider interface so the manager can call it identically to any
# AI provider, and so it also has stable behavior for other pipelines to
# reuse if needed.

import os
import re
import time
from pathlib import Path

import requests

from .base_provider import BaseVideoProvider
from .registry import register_provider

PEXELS_SEARCH_URL = "https://api.pexels.com/videos/search"

MIN_DURATION = 4
MAX_DURATION = 15
SEARCH_RESULTS = 20
TIMEOUT = 30

STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were",
    "to", "of", "for", "and", "or", "with",
    "that", "this", "these", "those", "in",
    "on", "at", "from", "by", "it", "as",
}


def _clean_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    words = [w for w in text.split() if w not in STOP_WORDS and len(w) >= 3]
    return " ".join(words)


def _build_queries(scene: dict) -> list[str]:
    queries = []

    if scene.get("search"):
        queries.append(_clean_text(scene["search"]))

    if scene.get("visual_prompt"):
        prompt = _clean_text(scene["visual_prompt"])
        if prompt not in queries:
            queries.append(prompt)

    if isinstance(scene.get("keywords"), list):
        for keyword in scene["keywords"]:
            cleaned = _clean_text(keyword)
            if cleaned:
                queries.append(cleaned)

    if scene.get("camera"):
        camera = _clean_text(scene["camera"])
        if camera:
            queries.append(camera)

    if scene.get("mood"):
        mood = _clean_text(scene["mood"])
        if mood:
            queries.append(mood)

    if not queries:
        queries.append("abstract background")

    seen = set()
    final = []
    for q in queries:
        if q in seen:
            continue
        seen.add(q)
        final.append(q)
    return final


@register_provider
class PexelsProvider(BaseVideoProvider):
    name = "pexels"

    def __init__(self, config):
        super().__init__(config)
        self.api_key = os.getenv("PEXELS_API_KEY")

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        if not self.api_key:
            print("⚠️ [pexels] PEXELS_API_KEY not set — cannot search stock footage.")
            return False

        queries = _build_queries(scene)
        candidates = self._search(queries)

        if not candidates:
            print("⚠️ [pexels] No viable stock assets found across keyword variants.")
            return False

        ranked = self._rank(candidates)

        for candidate in ranked:
            print(
                f"💡 [pexels] Candidate (score={candidate['score']}) "
                f"duration={candidate['video'].get('duration', 0)}s"
            )
            if self._download(candidate["stream"], output_path):
                return True
            print("⚠️ [pexels] Selected stream download failed. Trying next candidate...")

        return False

    def _search(self, queries: list[str]) -> list[dict]:
        headers = {"Authorization": self.api_key}
        all_candidates: dict[int, dict] = {}

        for query in queries:
            print(f"🔍 [pexels] Searching: {query}")
            try:
                response = requests.get(
                    PEXELS_SEARCH_URL,
                    headers=headers,
                    params={
                        "query": query,
                        "orientation": "portrait",
                        "per_page": SEARCH_RESULTS,
                    },
                    timeout=TIMEOUT,
                )
            except Exception as e:
                print(f"⚠️ [pexels] Search request failed: {e}")
                continue

            if response.status_code != 200:
                print(f"⚠️ [pexels] API error {response.status_code}")
                continue

            for video in response.json().get("videos", []):
                video_id = video["id"]
                if video_id not in all_candidates:
                    all_candidates[video_id] = video

            if len(all_candidates) >= 40:
                break

            time.sleep(0.3)

        return list(all_candidates.values())

    def _rank(self, videos: list[dict]) -> list[dict]:
        ranked = []

        for video in videos:
            files = video.get("video_files", [])
            if not files:
                continue

            best_stream, best_score = None, -1
            for stream in files:
                width = stream.get("width", 0)
                height = stream.get("height", 0)
                score = 0

                score += 40 if height > width else -40

                if width >= 1080 or height >= 1920:
                    score += 35
                elif width >= 720:
                    score += 20
                else:
                    score -= 20

                if stream.get("quality") == "hd":
                    score += 20
                if stream.get("file_type") == "video/mp4":
                    score += 10

                if score > best_score:
                    best_score, best_stream = score, stream

            if best_stream is None:
                continue

            duration = video.get("duration", 0)
            final_score = best_score
            if MIN_DURATION <= duration <= MAX_DURATION + 5:
                final_score += 30
            elif duration < 3:
                final_score -= 25
            elif duration > 30:
                final_score -= 10

            ranked.append({"video": video, "stream": best_stream, "score": final_score})

        ranked.sort(key=lambda x: x["score"], reverse=True)
        return ranked

    def _download(self, stream: dict, output_path: Path) -> bool:
        try:
            response = requests.get(stream["link"], stream=True, timeout=120)
        except Exception as e:
            print(f"⚠️ [pexels] Download failed: {e}")
            return False

        if response.status_code != 200:
            return False

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(65536):
                if chunk:
                    f.write(chunk)

        if not output_path.exists() or output_path.stat().st_size < 100_000:
            output_path.unlink(missing_ok=True)
            return False

        print(f"✅ [pexels] Saved {output_path.name}")
        return True
