# python/providers/__init__.py
#
# Importing this package triggers every provider module's import below,
# which runs their @register_provider decorator and populates
# registry.PROVIDER_REGISTRY. This is the ONE place that needs a new line
# added when a new provider file is created — nothing in manager.py itself
# changes.

from . import openai_provider  # noqa: F401
from . import veo_provider  # noqa: F401
from . import runway_provider  # noqa: F401
from . import pika_provider  # noqa: F401
from . import kling_provider  # noqa: F401
from . import fal_provider  # noqa: F401
from . import pexels_provider  # noqa: F401
from . import stability_image_provider  # noqa: F401

from .manager import VideoProviderManager  # noqa: F401
from .config import load_config, ProviderConfig  # noqa: F401
