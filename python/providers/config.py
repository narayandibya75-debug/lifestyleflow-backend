# python/providers/config.py
#
# Single place that reads every env var this architecture uses. Nothing
# else in providers/ should call os.getenv directly — that keeps
# "changing the provider only requires changing configuration" literally
# true, since every knob lives here.

import os
from dataclasses import dataclass


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class ProviderConfig:
    # Which AI provider to try first. Must match a name registered in
    # providers/manager.py's PROVIDER_REGISTRY (see each provider's `name`).
    visual_provider: str

    # Master switch — if False, the manager skips AI generation entirely
    # and goes straight to Pexels (useful for cost control / local dev).
    ai_video_enabled: bool

    # If AI generation fails (all retries exhausted or invalid clip),
    # fall back to Pexels stock search instead of failing the scene.
    pexels_fallback: bool

    max_ai_retries: int

    # "scene" = match each scene's own duration; a fixed number of seconds
    # is also accepted (e.g. "6") for providers that only support fixed
    # clip lengths.
    video_duration_mode: str

    video_width: int
    video_height: int
    video_fps: int

    @property
    def video_resolution(self) -> str:
        return f"{self.video_width}x{self.video_height}"


def _parse_resolution(raw: str, default_w: int, default_h: int):
    if not raw:
        return default_w, default_h
    try:
        w, h = raw.lower().split("x")
        return int(w), int(h)
    except (ValueError, AttributeError):
        return default_w, default_h


def load_config() -> ProviderConfig:
    width, height = _parse_resolution(
        os.getenv("VIDEO_RESOLUTION", ""), 1280, 720
    )

    return ProviderConfig(
        visual_provider=os.getenv("VISUAL_PROVIDER", "pexels").strip().lower(),
        ai_video_enabled=_bool_env("AI_VIDEO_ENABLED", False),
        pexels_fallback=_bool_env("PEXELS_FALLBACK", True),
        max_ai_retries=_int_env("MAX_AI_RETRIES", 2),
        video_duration_mode=os.getenv("VIDEO_DURATION_MODE", "scene").strip().lower(),
        video_width=width,
        video_height=height,
        video_fps=_int_env("VIDEO_FPS", 30),
    )
