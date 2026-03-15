from __future__ import annotations

from typing import Any, Literal

from src.agents.memory.policy import resolve_memory_policy
from src.agents.memory.scope import resolve_agent_for_memory_scope
from src.agents.memory.registry import get_default_memory_provider

MemoryScope = Literal["global", "agent", "auto"]


def resolve_agent_for_scope(
    *,
    scope: MemoryScope,
    requested_agent_name: str | None = None,
    runtime_agent_name: str | None = None,
) -> str | None:
    candidate = (requested_agent_name or "").strip() or (runtime_agent_name or "").strip() or None
    return resolve_agent_for_memory_scope(scope=scope, agent_name=candidate)


def query_memory_action(
    *,
    query: str,
    limit: int = 8,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
    runtime_agent_name: str | None = None,
    policy_state: dict[str, Any] | None = None,
    policy_runtime_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = resolve_memory_policy(state=policy_state, runtime_context=policy_runtime_context)
    if not policy.allow_read:
        raise PermissionError("Memory read is disabled for this session (memory_read=false).")

    provider = get_default_memory_provider()
    resolved_agent = resolve_agent_for_scope(
        scope=scope,
        requested_agent_name=agent_name,
        runtime_agent_name=runtime_agent_name,
    )

    if hasattr(provider, "query_memory"):
        rows = provider.query_memory(query=query, limit=limit, agent_name=resolved_agent)  # type: ignore[attr-defined]
    else:
        rows = []

    return {
        "scope": f"agent:{resolved_agent}" if resolved_agent else "global",
        "query": query,
        "total": len(rows),
        "results": rows,
    }


def store_memory_action(
    *,
    content: str,
    confidence: float = 0.9,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
    runtime_agent_name: str | None = None,
    source: str | None = None,
    thread_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    policy_state: dict[str, Any] | None = None,
    policy_runtime_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = resolve_memory_policy(state=policy_state, runtime_context=policy_runtime_context)
    if not policy.allow_write:
        raise PermissionError(
            "Memory write is disabled for this session (temporary_chat or memory_write=false)."
        )

    provider = get_default_memory_provider()
    if not hasattr(provider, "store_memory"):
        raise RuntimeError("Current memory provider does not support active store.")

    resolved_agent = resolve_agent_for_scope(
        scope=scope,
        requested_agent_name=agent_name,
        runtime_agent_name=runtime_agent_name,
    )
    return provider.store_memory(  # type: ignore[attr-defined]
        content=content,
        confidence=confidence,
        source=source,
        agent_name=resolved_agent,
        thread_id=thread_id,
        metadata=metadata,
    )


def compact_memory_action(
    *,
    ratio: float = 0.8,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
    runtime_agent_name: str | None = None,
    policy_state: dict[str, Any] | None = None,
    policy_runtime_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = resolve_memory_policy(state=policy_state, runtime_context=policy_runtime_context)
    if not policy.allow_write:
        raise PermissionError(
            "Memory write is disabled for this session (temporary_chat or memory_write=false)."
        )

    provider = get_default_memory_provider()
    if not hasattr(provider, "compact_memory"):
        raise RuntimeError("Current memory provider does not support compact.")

    resolved_agent = resolve_agent_for_scope(
        scope=scope,
        requested_agent_name=agent_name,
        runtime_agent_name=runtime_agent_name,
    )
    normalized_scope = "global" if resolved_agent is None else "agent"
    return provider.compact_memory(  # type: ignore[attr-defined]
        ratio=ratio,
        scope=normalized_scope,
        agent_name=resolved_agent,
    )


def forget_memory_action(
    *,
    memory_id: str,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
    runtime_agent_name: str | None = None,
    policy_state: dict[str, Any] | None = None,
    policy_runtime_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = resolve_memory_policy(state=policy_state, runtime_context=policy_runtime_context)
    if not policy.allow_write:
        raise PermissionError(
            "Memory write is disabled for this session (temporary_chat or memory_write=false)."
        )

    provider = get_default_memory_provider()
    if not hasattr(provider, "forget_memory"):
        raise RuntimeError("Current memory provider does not support forget.")

    resolved_agent = resolve_agent_for_scope(
        scope=scope,
        requested_agent_name=agent_name,
        runtime_agent_name=runtime_agent_name,
    )
    normalized_scope = "global" if resolved_agent is None else "agent"
    return provider.forget_memory(  # type: ignore[attr-defined]
        memory_id=memory_id,
        scope=normalized_scope,
        agent_name=resolved_agent,
    )
