from __future__ import annotations

from importlib import import_module

_ROUTER_MODULES = {
    "artifact_groups",
    "artifacts",
    "channels",
    "langgraph_proxy",
    "mcp",
    "openviking",
    "models",
    "retrieval_models",
    "rss",
    "runtime_profile",
    "runtime_topology",
    "scheduler",
    "skills",
    "suggestions",
    "tools",
    "uploads",
    "workbench",
    "workspace",
}

__all__ = sorted(_ROUTER_MODULES)


def __getattr__(name: str):
    if name not in _ROUTER_MODULES:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(f".{name}", package=__name__)
    globals()[name] = module
    return module
