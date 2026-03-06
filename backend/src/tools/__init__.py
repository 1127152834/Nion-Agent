"""Tools package exports."""

from __future__ import annotations

from typing import Any

__all__ = ["get_available_tools"]


def get_available_tools(*args: Any, **kwargs: Any) -> Any:
    """Lazily import tools registry to avoid eager side-effect imports."""
    from .tools import get_available_tools as _get_available_tools

    return _get_available_tools(*args, **kwargs)
