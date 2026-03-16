from __future__ import annotations

from nion.agents.memory.core import MemoryProvider


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
        # OpenViking is the only online provider in hard-cut mode.
        return self.get("openviking")


def _build_default_registry() -> MemoryRegistry:
    from nion.agents.memory.legacy_cleanup import ensure_legacy_memory_removed
    from nion.agents.memory.openviking_provider import OpenVikingMemoryProvider
    from nion.agents.memory.openviking_runtime import OpenVikingRuntime

    # Hard-cut safety: always remove legacy/structured artifacts on runtime init.
    ensure_legacy_memory_removed()

    registry = MemoryRegistry()
    registry.register(OpenVikingMemoryProvider(runtime=OpenVikingRuntime()))
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
