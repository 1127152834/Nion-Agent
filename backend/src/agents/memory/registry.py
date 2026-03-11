from __future__ import annotations

from src.agents.memory.core import MemoryProvider


class MemoryRegistry:
    def __init__(self):
        self._providers: dict[str, MemoryProvider] = {}

    def register(self, provider: MemoryProvider) -> None:
        self._providers[provider.name] = provider

    def get(self, name: str) -> MemoryProvider:
        try:
            return self._providers[name]
        except KeyError as exc:
            raise KeyError(f"Unknown memory provider: {name}") from exc

    def get_default(self) -> MemoryProvider:
        from src.config.memory_config import get_memory_config

        config = get_memory_config()
        provider_name = config.provider
        if provider_name not in self._providers:
            provider_name = "structured-fs"
        return self.get(provider_name)


def _build_default_registry() -> MemoryRegistry:
    from src.agents.memory.legacy_cleanup import ensure_legacy_memory_removed
    from src.agents.memory.structured_provider import StructuredFsProvider
    from src.agents.memory.structured_runtime import StructuredFsRuntime

    # Hard-cut safety: always remove legacy memory.json files on runtime init.
    ensure_legacy_memory_removed()

    registry = MemoryRegistry()

    registry.register(StructuredFsProvider(runtime=StructuredFsRuntime()))

    return registry


_memory_registry: MemoryRegistry | None = None


def get_memory_registry() -> MemoryRegistry:
    global _memory_registry
    if _memory_registry is None:
        _memory_registry = _build_default_registry()
    return _memory_registry


def get_default_memory_provider() -> MemoryProvider:
    return get_memory_registry().get_default()


def reset_memory_registry() -> None:
    global _memory_registry
    _memory_registry = None
