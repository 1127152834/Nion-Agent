"""Builtin tools for active memory operations."""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

from langchain.tools import tool

try:  # Backward compatibility for older langchain versions used in tests.
    from langchain.tools import ToolRuntime
except Exception:  # noqa: BLE001

    class ToolRuntime:  # type: ignore[no-redef]
        context: dict[str, Any]
        state: dict[str, Any]


from src.agents.memory.actions import (
    compact_memory_action,
    forget_memory_action,
    query_memory_action,
    store_memory_action,
)
from src.agents.memory.policy import resolve_memory_policy
from src.agents.memory.registry import get_default_memory_provider


def _json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


def _runtime_context(runtime: ToolRuntime | None) -> dict[str, Any]:
    if runtime is None or not isinstance(runtime.context, dict):
        return {}
    return runtime.context


def _runtime_state(runtime: ToolRuntime | None) -> dict[str, Any]:
    if runtime is None or not isinstance(runtime.state, dict):
        return {}
    return runtime.state


def _runtime_agent_name(runtime: ToolRuntime | None) -> str | None:
    context = _runtime_context(runtime)
    value = context.get("agent_name")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _runtime_thread_id(runtime: ToolRuntime | None) -> str | None:
    context = _runtime_context(runtime)
    value = context.get("thread_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _policy_state(runtime: ToolRuntime | None) -> dict[str, Any]:
    state = _runtime_state(runtime)
    return {
        "session_mode": state.get("session_mode"),
        "memory_read": state.get("memory_read"),
        "memory_write": state.get("memory_write"),
    }


def _policy_runtime_context(runtime: ToolRuntime | None) -> dict[str, Any]:
    context = _runtime_context(runtime)
    return {
        "session_mode": context.get("session_mode"),
        "memory_read": context.get("memory_read"),
        "memory_write": context.get("memory_write"),
    }


def _parse_metadata(metadata_json: str | None) -> dict[str, Any] | None:
    if metadata_json is None or metadata_json.strip() == "":
        return None
    parsed = json.loads(metadata_json)
    if not isinstance(parsed, dict):
        raise ValueError("metadata_json must be a JSON object")
    return parsed


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            part = _extract_text(item)
            if part:
                parts.append(part)
        return "\n".join(parts).strip()
    if isinstance(content, dict):
        for key in ("text", "content", "value", "output_text"):
            if key in content:
                value = _extract_text(content.get(key))
                if value:
                    return value
    return ""


def _message_role(raw: Any) -> str:
    role = str(raw or "").strip().lower()
    if role in {"human", "user"}:
        return "user"
    if role in {"ai", "assistant"}:
        return "assistant"
    if role == "system":
        return "system"
    return role or "assistant"


def _history_from_state(runtime: ToolRuntime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for msg in _runtime_state(runtime).get("messages") or []:
        role = _message_role(getattr(msg, "type", None) or getattr(msg, "role", None))
        content = _extract_text(getattr(msg, "content", ""))
        if not content:
            continue
        rows.append(
            {
                "role": role,
                "content": content,
            }
        )
    return rows


def _memory_query_impl(
    runtime: ToolRuntime,
    *,
    query: str,
    limit: int,
    scope: Literal["global", "agent", "auto"],
    agent_name: str | None,
) -> str:
    try:
        result = query_memory_action(
            query=query,
            limit=limit,
            scope=scope,
            agent_name=agent_name,
            runtime_agent_name=_runtime_agent_name(runtime),
            policy_state=_policy_state(runtime),
            policy_runtime_context=_policy_runtime_context(runtime),
        )
        return _json({"ok": True, **result})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("memory_query", parse_docstring=True)
def memory_query_tool(
    runtime: ToolRuntime,
    query: str,
    limit: int = 8,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> str:
    """Query long-term memory with OpenViking semantics.

    Args:
        query: Search query text.
        limit: Maximum number of results (1-50).
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent-scoped lookup.
    """
    return _memory_query_impl(
        runtime,
        query=query,
        limit=limit,
        scope=scope,
        agent_name=agent_name,
    )


@tool("search_memory", parse_docstring=True)
def search_memory_tool(
    runtime: ToolRuntime,
    query: str,
    limit: int = 8,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> str:
    """Search memory (compat alias of memory_query).

    Args:
        query: Search query text.
        limit: Maximum number of results (1-50).
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent-scoped lookup.
    """
    return _memory_query_impl(
        runtime,
        query=query,
        limit=limit,
        scope=scope,
        agent_name=agent_name,
    )


@tool("query_history", parse_docstring=True)
def query_history_tool(
    runtime: ToolRuntime,
    limit: int = 50,
    role: Literal["", "user", "assistant", "system"] = "",
    keyword: str = "",
) -> str:
    """Query conversation history from current thread state.

    Args:
        limit: Maximum messages to return (1-200).
        role: Optional role filter (`user`, `assistant`, `system`).
        keyword: Optional keyword filter (case-insensitive).
    """
    bounded_limit = min(200, max(1, int(limit)))
    normalized_role = role.strip().lower()
    normalized_keyword = keyword.strip().lower()

    rows = _history_from_state(runtime)
    if normalized_role:
        rows = [item for item in rows if item["role"] == normalized_role]
    if normalized_keyword:
        rows = [item for item in rows if normalized_keyword in item["content"].lower()]
    rows = rows[-bounded_limit:]

    return _json(
        {
            "ok": True,
            "count": len(rows),
            "messages": rows,
            "source": "current_thread_state",
        }
    )


@tool("memory_store", parse_docstring=True)
def memory_store_tool(
    runtime: ToolRuntime,
    content: str,
    confidence: float = 0.9,
    source: str | None = None,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
    metadata_json: str | None = None,
) -> str:
    """Store a high-value memory immediately.

    Args:
        content: Memory content text to store.
        confidence: Confidence score in [0, 1].
        source: Optional source label.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent-scoped write.
        metadata_json: Optional JSON object string for extra metadata.
    """
    try:
        result = store_memory_action(
            content=content,
            confidence=confidence,
            source=source or "memory_store_tool",
            scope=scope,
            agent_name=agent_name,
            runtime_agent_name=_runtime_agent_name(runtime),
            thread_id=_runtime_thread_id(runtime),
            metadata=_parse_metadata(metadata_json),
            policy_state=_policy_state(runtime),
            policy_runtime_context=_policy_runtime_context(runtime),
        )
        return _json({"ok": True, **result})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("memory_compact", parse_docstring=True)
def memory_compact_tool(
    runtime: ToolRuntime,
    ratio: float = 0.8,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> str:
    """Compact long-term memory storage.

    Args:
        ratio: Keep ratio in (0, 1].
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent-scoped compact.
    """
    try:
        result = compact_memory_action(
            ratio=ratio,
            scope=scope,
            agent_name=agent_name,
            runtime_agent_name=_runtime_agent_name(runtime),
            policy_state=_policy_state(runtime),
            policy_runtime_context=_policy_runtime_context(runtime),
        )
        return _json({"ok": True, **result})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("memory_forget", parse_docstring=True)
def memory_forget_tool(
    runtime: ToolRuntime,
    memory_id: str,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> str:
    """Forget one memory entry by id.

    Args:
        memory_id: Memory identifier to forget.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent-scoped forget.
    """
    try:
        result = forget_memory_action(
            memory_id=memory_id,
            scope=scope,
            agent_name=agent_name,
            runtime_agent_name=_runtime_agent_name(runtime),
            policy_state=_policy_state(runtime),
            policy_runtime_context=_policy_runtime_context(runtime),
        )
        return _json({"ok": True, **result})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ov_find", parse_docstring=True)
def ov_find_tool(
    runtime: ToolRuntime,
    query: str,
    limit: int = 10,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> str:
    """OpenViking find (semantic search over viking memory).

    Args:
        query: Search query text.
        limit: Maximum number of results.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent scope.
    """
    return _memory_query_impl(
        runtime,
        query=query,
        limit=limit,
        scope=scope,
        agent_name=agent_name,
    )


@tool("ov_search", parse_docstring=True)
def ov_search_tool(
    runtime: ToolRuntime,
    query: str,
    limit: int = 10,
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> str:
    """OpenViking search (advanced retrieval alias).

    Args:
        query: Search query text.
        limit: Maximum number of results.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name for agent scope.
    """
    return _memory_query_impl(
        runtime,
        query=query,
        limit=limit,
        scope=scope,
        agent_name=agent_name,
    )


@tool("ov_session_commit", parse_docstring=True)
def ov_session_commit_tool(
    runtime: ToolRuntime,
    messages_json: str,
    session_id: str | None = None,
    agent_name: str | None = None,
) -> str:
    """Legacy alias for structured memory write graph.

    Args:
        messages_json: JSON array of `{role, content}` items.
        session_id: Optional session id. Defaults to thread_id/UUID.
        agent_name: Optional agent scope override.
    """
    try:
        policy = resolve_memory_policy(
            state=_policy_state(runtime),
            runtime_context=_policy_runtime_context(runtime),
        )
        if not policy.allow_write:
            raise PermissionError("Memory write is disabled for this session (temporary_chat or memory_write=false).")

        payload = json.loads(messages_json)
        if not isinstance(payload, list):
            raise ValueError("messages_json must be a JSON array")
        normalized_messages: list[dict[str, str]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            role = _message_role(item.get("role"))
            content = _extract_text(item.get("content"))
            if not content:
                continue
            normalized_messages.append({"role": role, "content": content})
        if not normalized_messages:
            raise ValueError("messages_json has no valid messages")

        provider = get_default_memory_provider()
        if not hasattr(provider, "write_conversation_update"):
            raise RuntimeError("Current memory provider does not support structured memory write")

        resolved_session_id = (session_id or _runtime_thread_id(runtime) or str(uuid.uuid4())).strip()
        result = provider.write_conversation_update(  # type: ignore[attr-defined]
            thread_id=resolved_session_id,
            messages=normalized_messages,
            agent_name=agent_name or _runtime_agent_name(runtime),
            write_source="tool",
            explicit_write=True,
            chat_id=resolved_session_id,
        )
        return _json({"ok": True, "session_id": resolved_session_id, "result": result})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})
