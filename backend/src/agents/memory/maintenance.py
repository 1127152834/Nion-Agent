"""Maintenance helpers for OpenViking memory runtime."""

from __future__ import annotations

from typing import Any


def _resolve_scope_agent(scope: str, agent_name: str | None) -> str | None:
    normalized = (scope or "global").strip().lower()
    if normalized == "global":
        return None
    if normalized == "agent":
        if not agent_name:
            raise ValueError("agent_name is required when scope=agent")
        return agent_name
    raise ValueError(f"Unsupported scope: {scope}")


def get_usage_stats(runtime: Any, *, scope: str = "global", agent_name: str | None = None) -> dict:
    """Get usage statistics from OpenViking local ledger."""
    resolved_agent = _resolve_scope_agent(scope, agent_name)
    items = runtime.get_memory_items(scope=scope, agent_name=resolved_agent)
    active_items = [item for item in items if str(item.get("status") or "active") == "active"]
    archived_items = [item for item in items if str(item.get("status") or "") == "archived"]

    total_chars = sum(len(str(item.get("summary") or "")) for item in items)

    return {
        "total_entries": len(items),
        "active_entries": len(active_items),
        "archived_entries": len(archived_items),
        "estimated_size_chars": total_chars,
        "scope": f"agent:{resolved_agent}" if resolved_agent else "global",
    }


def compact_memory(runtime: Any, *, scope: str = "global", agent_name: str | None = None) -> dict:
    """Compact memory via OpenViking hard-delete path."""
    resolved_agent = _resolve_scope_agent(scope, agent_name)
    return runtime.compact_memory(ratio=0.8, scope=scope, agent_name=resolved_agent)


def rebuild_memory(runtime: Any, *, scope: str = "global", agent_name: str | None = None) -> dict:
    """Rebuild vector/graph index from OpenViking ledger."""
    resolved_agent = _resolve_scope_agent(scope, agent_name)
    if resolved_agent is None:
        return runtime.reindex_vectors(include_agents=True)
    # Agent-only rebuild keeps behavior deterministic for heartbeat agent jobs.
    return runtime.reindex_vectors(include_agents=False)
