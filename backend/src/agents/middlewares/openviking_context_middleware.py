"""Inject lightweight OpenViking retrieval context before model calls."""

from __future__ import annotations

import hashlib
from typing import Any, Generic, NotRequired, TypeVar, override

from langchain_core.messages import SystemMessage
from langgraph.runtime import Runtime

from src.agents.memory.core import MemoryReadRequest
from src.agents.memory.registry import get_default_memory_provider
from src.config.memory_config import get_memory_config

try:
    from langchain.agents import AgentState
except Exception:  # noqa: BLE001
    class AgentState(dict):  # type: ignore[no-redef]
        pass

_StateT = TypeVar("_StateT")
try:
    from langchain.agents.middleware import AgentMiddleware
except Exception:  # noqa: BLE001
    class AgentMiddleware(Generic[_StateT]):  # type: ignore[no-redef]
        state_schema = dict

        def __init__(self, *args, **kwargs):
            _ = args, kwargs

_OV_CONTEXT_MARKER_PREFIX = "<openviking_context "


class OpenVikingContextState(AgentState):
    """Thread state subset required by context loader middleware."""

    session_mode: NotRequired[str | None]
    memory_read: NotRequired[bool | None]
    memory_write: NotRequired[bool | None]


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            text = _extract_text(item)
            if text:
                parts.append(text)
        return "\n".join(parts).strip()

    if isinstance(content, dict):
        for key in ("text", "content", "value", "output_text"):
            if key in content:
                text = _extract_text(content.get(key))
                if text:
                    return text
        return ""

    return ""


def _latest_user_query(messages: list[Any]) -> str:
    for msg in reversed(messages):
        msg_type = getattr(msg, "type", None) or getattr(msg, "role", None)
        if str(msg_type).strip().lower() not in {"human", "user"}:
            continue
        text = _extract_text(getattr(msg, "content", ""))
        if text:
            return text
    return ""


def _query_hash(query: str) -> str:
    return hashlib.sha1(query.encode("utf-8")).hexdigest()[:12]


def _already_injected(messages: list[Any], query_hash: str) -> bool:
    marker = f'{_OV_CONTEXT_MARKER_PREFIX}query_hash="{query_hash}"'
    for msg in reversed(messages):
        msg_type = getattr(msg, "type", None) or getattr(msg, "role", None)
        if str(msg_type).strip().lower() not in {"system"}:
            continue
        content = str(getattr(msg, "content", "") or "")
        if marker in content:
            return True
    return False


class OpenVikingContextMiddleware(AgentMiddleware[OpenVikingContextState]):
    """Inject OpenViking retrieval context based on latest user query."""

    state_schema = OpenVikingContextState

    def __init__(self, agent_name: str | None = None):
        super().__init__()
        self._agent_name = agent_name

    @override
    def before_model(self, state: OpenVikingContextState, runtime: Runtime) -> dict[str, Any] | None:
        config = get_memory_config()
        if not config.enabled or not config.openviking_context_enabled:
            return None

        provider = get_default_memory_provider()
        if not hasattr(provider, "build_context_from_query"):
            return None

        policy = provider.resolve_policy(
            MemoryReadRequest(
                agent_name=self._agent_name,
                state=state,
                runtime_context=runtime.context,
            )
        )
        if not policy.allow_read:
            return None

        messages = list(state.get("messages") or [])
        if not messages:
            return None

        query = _latest_user_query(messages)
        if not query:
            return None
        query_hash = _query_hash(query)
        if _already_injected(messages, query_hash):
            return None

        context_text = provider.build_context_from_query(  # type: ignore[attr-defined]
            query=query,
            agent_name=self._agent_name,
        )
        if not context_text.strip():
            return None

        marker = (
            f'{_OV_CONTEXT_MARKER_PREFIX}query_hash="{query_hash}" '
            f'agent="{self._agent_name or "global"}">'
        )
        payload = f"{marker}\n{context_text.strip()}\n</openviking_context>"
        return {"messages": [SystemMessage(content=payload)]}

    @override
    async def abefore_model(self, state: OpenVikingContextState, runtime: Runtime) -> dict[str, Any] | None:
        return self.before_model(state, runtime)
