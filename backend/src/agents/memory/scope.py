from __future__ import annotations

from typing import Literal

from src.config.default_agent import DEFAULT_AGENT_NAME

MemoryScope = Literal["global", "agent", "auto"]


def normalize_agent_name_for_memory(agent_name: str | None) -> str | None:
    """Normalize agent_name for memory scoping.

    Contract:
    - None/empty -> None
    - Reserved default agent name ("_default") -> None (global)
    - Otherwise keep original trimmed name
    """
    if agent_name is None:
        return None
    normalized = agent_name.strip()
    if not normalized:
        return None
    if normalized.lower() == DEFAULT_AGENT_NAME:
        return None
    return normalized


def resolve_agent_for_memory_scope(*, scope: MemoryScope, agent_name: str | None) -> str | None:
    """Resolve memory scope to runtime agent_name.

    Semantics:
    - global -> None
    - auto -> normalized agent_name (default agent becomes None)
    - agent -> requires explicit agent_name, but "_default" is treated as global for backward compatibility
    """
    normalized_scope = (scope or "auto").strip().lower()
    raw = (agent_name or "").strip()
    raw_is_default = bool(raw) and raw.lower() == DEFAULT_AGENT_NAME
    resolved_agent = normalize_agent_name_for_memory(agent_name)

    if normalized_scope == "global":
        return None
    if normalized_scope == "auto":
        return resolved_agent
    if normalized_scope == "agent":
        if raw_is_default:
            return None
        if resolved_agent is None:
            raise ValueError("agent_name is required when scope=agent")
        return resolved_agent
    raise ValueError(f"Unsupported scope: {scope}")

