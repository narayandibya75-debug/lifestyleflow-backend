# python/providers/registry.py
#
# Standalone registry, deliberately with no other dependencies inside this
# package, so both manager.py and every individual provider file can import
# from it without any circular-import ordering headaches.
#
# Adding a brand new provider (Luma, Haiper, Stability AI video, whatever
# comes next) requires exactly one new file: subclass BaseVideoProvider,
# decorate the class with @register_provider, and import that module once
# from providers/__init__.py. Nothing in manager.py or anywhere else needs
# to change.

PROVIDER_REGISTRY: dict[str, type] = {}


def register_provider(cls):
    """Class decorator — registers a BaseVideoProvider subclass under its
    `name` attribute so VideoProviderManager can look it up by the
    VISUAL_PROVIDER config string."""
    if not getattr(cls, "name", None):
        raise ValueError(f"{cls.__name__} must define a non-empty `name` attribute")
    PROVIDER_REGISTRY[cls.name] = cls
    return cls
