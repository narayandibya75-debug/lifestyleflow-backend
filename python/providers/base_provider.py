# python/providers/base_provider.py
#
# Every provider (AI or stock) implements this exact interface. The manager
# (manager.py) only ever calls `provider.generate(...)` — no
# provider-specific logic exists anywhere outside that provider's own file.

from abc import ABC, abstractmethod
from pathlib import Path

from .config import ProviderConfig


class BaseVideoProvider(ABC):
    """Common contract for every visual-acquisition provider.

    Subclasses must set `name` to a short, unique, lowercase identifier
    (used for VISUAL_PROVIDER config, logging, and registry lookup) and
    implement `generate()`.
    """

    name: str = "base"

    def __init__(self, config: ProviderConfig):
        self.config = config

    @abstractmethod
    def generate(self, scene: dict, prompt: str, output_path: Path) -> bool:
        """Attempt to produce a clip for `scene` and write it to
        `output_path`.

        Args:
            scene: the scene dict from content.json (voice text, search
                query, camera, mood, duration, etc.)
            prompt: the cinematic prompt built by prompt_engine.py for AI
                providers. Stock providers (Pexels) are free to ignore this
                and build their own search query from `scene` instead.
            output_path: exact file path this provider must write the clip
                (or image, for a still-frame fallback provider) to.

        Returns:
            True if `output_path` now contains a usable asset. False for
            any failure (missing API key, timeout, rejected prompt, no
            search results, etc.) — providers should catch their own
            exceptions and return False rather than raising, so the
            manager can move on to the next fallback tier cleanly.
            Raising is reserved for genuine programming errors, not
            expected runtime failure modes.
        """
        raise NotImplementedError

    def is_configured(self) -> bool:
        """Cheap pre-check the manager can call before spending a retry
        attempt on a provider that isn't even set up yet (e.g. missing API
        key). Default: assume configured; providers that need an API key
        should override this."""
        return True
