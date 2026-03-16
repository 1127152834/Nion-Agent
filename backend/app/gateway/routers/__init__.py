from __future__ import annotations

from importlib import import_module

_ROUTER_MODULES = {
    "agents",
    "artifact_groups",
    "artifacts",
    "channels",
    "cli",
    "cli_interactive",
    "config",
    "embedding_models",
    "evolution",
    "heartbeat",
    "langgraph_proxy",
    "mcp",
    "openviking",
    "processlog",
    "models",
    "retrieval_models",
    "runtime_profile",
    "runtime_info",
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
