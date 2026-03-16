"""Gateway package exports."""

from __future__ import annotations

from typing import Any

from .config import GatewayConfig, get_gateway_config

__all__ = ["app", "create_app", "GatewayConfig", "get_gateway_config"]


def create_app(*args: Any, **kwargs: Any):
    from .app import create_app as _create_app

    return _create_app(*args, **kwargs)


def __getattr__(name: str):
    if name != "app":
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    from .app import app as _app

    globals()["app"] = _app
    return _app
