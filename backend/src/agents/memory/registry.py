from __future__ import annotations

from src.agents.memory.core import MemoryProvider
from src.agents.memory.provider import V2CompatibleMemoryProvider
from src.agents.memory.runtime import V2CompatibleMemoryRuntime


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
        return self.get("v2-compatible")


def _build_default_registry() -> MemoryRegistry:
    registry = MemoryRegistry()
    registry.register(V2CompatibleMemoryProvider(runtime=V2CompatibleMemoryRuntime()))
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
