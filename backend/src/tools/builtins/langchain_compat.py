"""LangChain import compatibility for builtin tools.

The project currently runs against a LangChain stack where:
- ``langchain.tools.tool`` is still available.
- ``ToolRuntime`` may not exist in ``langchain.tools`` (moved to community packages).
- ``InjectedToolCallId`` exists in ``langchain_core.tools``.

Builtin tools should import these symbols from here to avoid ImportError at import time.
"""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from langchain.tools import tool

try:
    # Newer stacks expose this in langchain_core.
    from langchain_core.tools import InjectedToolCallId  # type: ignore
except Exception:  # noqa: BLE001
    try:
        from langchain.tools import InjectedToolCallId  # type: ignore
    except Exception:  # noqa: BLE001
        InjectedToolCallId = str  # type: ignore[assignment]

try:
    from langchain.tools import ToolRuntime  # type: ignore
except Exception:  # noqa: BLE001
    ContextT = TypeVar("ContextT")
    StateT = TypeVar("StateT")

    class ToolRuntime(Generic[ContextT, StateT]):  # type: ignore[no-redef]
        """Minimal runtime shape used only for typing and safe imports in tests."""

        context: Any
        state: Any
        config: Any


__all__ = ["InjectedToolCallId", "ToolRuntime", "tool"]

