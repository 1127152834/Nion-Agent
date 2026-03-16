from __future__ import annotations

from typing import Any

__all__ = ["DingTalkInboundPlugin"]


def __getattr__(name: str) -> Any:
    if name == "DingTalkInboundPlugin":
        from .plugin import DingTalkInboundPlugin

        return DingTalkInboundPlugin
    raise AttributeError(name)
