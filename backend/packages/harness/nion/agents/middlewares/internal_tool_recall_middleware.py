"""Inject internal tool recommendations before model calls."""

from __future__ import annotations

import hashlib
from typing import Any, NotRequired, override

from langchain_core.messages import SystemMessage
from langgraph.runtime import Runtime

from nion.config.app_config import get_app_config
from nion.tools.internal_tool_recall import recommend_internal_tools

try:
    from langchain.agents import AgentState
except Exception:  # noqa: BLE001

    class AgentState(dict):  # type: ignore[no-redef]
        pass


try:
    from langchain.agents.middleware import AgentMiddleware
except Exception:  # noqa: BLE001

    class AgentMiddleware[StateT]:  # type: ignore[no-redef]
        state_schema = dict

        def __init__(self, *args, **kwargs):
            _ = args, kwargs


_TOOL_RECALL_MARKER_PREFIX = "<internal_tool_recall "


class InternalToolRecallState(AgentState):
    """Thread state subset required by tool recall middleware."""

    messages: NotRequired[list[Any]]


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
    marker = f'{_TOOL_RECALL_MARKER_PREFIX}query_hash="{query_hash}"'
    for msg in reversed(messages):
        msg_type = getattr(msg, "type", None) or getattr(msg, "role", None)
        if str(msg_type).strip().lower() not in {"system"}:
            continue
        content = str(getattr(msg, "content", "") or "")
        if marker in content:
            return True
    return False


class InternalToolRecallMiddleware(AgentMiddleware[InternalToolRecallState]):
    """Inject a short list of recommended internal tools based on the latest user query."""

    state_schema = InternalToolRecallState

    def __init__(self, *, limit: int = 5):
        super().__init__()
        self._limit = max(0, int(limit))

    @staticmethod
    def _is_anthropic_compatible_model(runtime: Runtime) -> bool:
        """
        Anthropic-compatible chat models may reject non-consecutive system messages.
        If so, skip injection to avoid request failures.
        """
        app_config = get_app_config()
        model_name = str(runtime.context.get("model_name") or runtime.context.get("model") or "").strip()
        if not model_name:
            if getattr(app_config, "models", None):
                model_name = str(app_config.models[0].name or "").strip()
        if not model_name:
            return False

        model_cfg = app_config.get_model_config(model_name)
        if model_cfg is None:
            return False

        provider_protocol = str(getattr(model_cfg, "provider_protocol", "") or "").strip().lower()
        if provider_protocol in {"anthropic", "anthropic-compatible"}:
            return True

        model_use = str(getattr(model_cfg, "use", "") or "").strip().lower()
        return "langchain_anthropic" in model_use

    @override
    def before_model(self, state: InternalToolRecallState, runtime: Runtime) -> dict[str, Any] | None:
        if self._limit <= 0:
            return None

        # Avoid multiple non-consecutive system messages for Anthropic-compatible providers.
        if self._is_anthropic_compatible_model(runtime):
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

        hits = recommend_internal_tools(query, limit=self._limit)
        if not hits:
            return None

        marker = f'{_TOOL_RECALL_MARKER_PREFIX}query_hash="{query_hash}" limit="{self._limit}">'
        lines: list[str] = [marker]
        for hit in hits:
            lines.append(f"- type={hit.tool_type} id={hit.tool_id}")
            lines.append(f"  why: {hit.why}")
            lines.append(f"  example: {hit.example_call}")
        lines.append("</internal_tool_recall>")

        return {"messages": [SystemMessage(content="\n".join(lines))]}

    @override
    async def abefore_model(self, state: InternalToolRecallState, runtime: Runtime) -> dict[str, Any] | None:
        return self.before_model(state, runtime)
