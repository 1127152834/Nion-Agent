"""Read-only OpenViking Context Filesystem tools (tool-first entrypoints).

These tools intentionally expose ONLY read operations. Any write/sync to the
managed OpenViking resources must be performed by backend code paths (e.g.
setup_agent sync), not by LLM tool calls.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from langchain.tools import tool

try:  # Backward compatibility for older langchain versions used in tests.
    from langchain.tools import ToolRuntime
except Exception:  # noqa: BLE001

    class ToolRuntime:  # type: ignore[no-redef]
        context: dict[str, Any]
        state: dict[str, Any]


from src.agents.memory.scope import resolve_agent_for_memory_scope
from src.agents.memory.registry import get_default_memory_provider

MemoryScope = Literal["global", "agent", "auto"]


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _runtime_agent_name(runtime: ToolRuntime | None) -> str | None:
    if runtime is None or not isinstance(getattr(runtime, "context", None), dict):
        return None
    raw = runtime.context.get("agent_name")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _resolve_scope(scope: MemoryScope, agent_name: str | None, runtime: ToolRuntime | None) -> tuple[str, str | None]:
    effective_agent = agent_name if agent_name is not None else _runtime_agent_name(runtime)
    resolved_agent = resolve_agent_for_memory_scope(scope=scope, agent_name=effective_agent)
    resolved_scope = "global" if resolved_agent is None else "agent"
    return resolved_scope, resolved_agent


def _require_openviking_provider():
    provider = get_default_memory_provider()
    if getattr(provider, "name", None) != "openviking":
        raise RuntimeError(f"OpenViking provider is not active (current={getattr(provider, 'name', None)!r})")
    return provider


def _parse_filter(filter_json: str | None) -> dict[str, Any] | None:
    if filter_json is None:
        return None
    raw = filter_json.strip()
    if not raw:
        return None
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("filter_json must be a JSON object")
    return parsed


@tool("ovfs_find", parse_docstring=True)
def ovfs_find_tool(
    runtime: ToolRuntime,
    query: str,
    limit: int = 10,
    target_uri: str = "",
    score_threshold: float | None = None,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Find resources from OpenViking Context Filesystem.

    Args:
        query: Search query text.
        limit: Maximum number of results (1-50).
        target_uri: Optional base URI to limit the search (empty means default).
        score_threshold: Optional minimum score threshold.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_find(  # type: ignore[attr-defined]
            query=query,
            limit=limit,
            target_uri=target_uri,
            score_threshold=score_threshold,
            agent_name=resolved_agent,
        )
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_search", parse_docstring=True)
def ovfs_search_tool(
    runtime: ToolRuntime,
    query: str,
    limit: int = 10,
    target_uri: str = "",
    score_threshold: float | None = None,
    filter_json: str | None = None,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Search resources from OpenViking Context Filesystem with advanced filter.

    Notes:
    - `filter_json` is passed to OpenViking SDK as the `filter` object.

    Args:
        query: Search query text.
        limit: Maximum number of results (1-50).
        target_uri: Optional base URI to limit the search (empty means default).
        score_threshold: Optional minimum score threshold.
        filter_json: Optional JSON object string used as OpenViking search filter.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        filter_obj = _parse_filter(filter_json)
        data = provider.fs_search(  # type: ignore[attr-defined]
            query=query,
            limit=limit,
            target_uri=target_uri,
            score_threshold=score_threshold,
            filter_json=filter_obj,
            agent_name=resolved_agent,
        )
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_overview", parse_docstring=True)
def ovfs_overview_tool(
    runtime: ToolRuntime,
    uri: str,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Get a best-effort overview for a OpenViking FS uri.

    Args:
        uri: Target OpenViking FS uri.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_overview(uri=uri, agent_name=resolved_agent)  # type: ignore[attr-defined]
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_read", parse_docstring=True)
def ovfs_read_tool(
    runtime: ToolRuntime,
    uri: str,
    offset: int = 0,
    limit: int = -1,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Read content from a OpenViking FS uri.

    Args:
        uri: Target OpenViking FS uri.
        offset: Start offset (bytes/characters, depending on backend) for partial read.
        limit: Read length. Use -1 for full content.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_read(uri=uri, offset=offset, limit=limit, agent_name=resolved_agent)  # type: ignore[attr-defined]
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_ls", parse_docstring=True)
def ovfs_ls_tool(
    runtime: ToolRuntime,
    uri: str,
    simple: bool = True,
    recursive: bool = False,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """List children under a OpenViking FS uri.

    Args:
        uri: Target OpenViking FS uri.
        simple: Return simplified entries when supported by backend.
        recursive: Whether to list recursively.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_ls(  # type: ignore[attr-defined]
            uri=uri,
            simple=simple,
            recursive=recursive,
            agent_name=resolved_agent,
        )
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_tree", parse_docstring=True)
def ovfs_tree_tool(
    runtime: ToolRuntime,
    uri: str,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Return a directory tree snapshot for a OpenViking FS uri.

    Args:
        uri: Target OpenViking FS uri.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_tree(uri=uri, agent_name=resolved_agent)  # type: ignore[attr-defined]
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_grep", parse_docstring=True)
def ovfs_grep_tool(
    runtime: ToolRuntime,
    uri: str,
    pattern: str,
    case_insensitive: bool = False,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Grep within OpenViking FS resources.

    Args:
        uri: Target OpenViking FS uri (directory/resource).
        pattern: Grep pattern to search.
        case_insensitive: Whether to match case-insensitively.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_grep(  # type: ignore[attr-defined]
            uri=uri,
            pattern=pattern,
            case_insensitive=case_insensitive,
            agent_name=resolved_agent,
        )
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_glob", parse_docstring=True)
def ovfs_glob_tool(
    runtime: ToolRuntime,
    pattern: str,
    uri: str = "viking://resources",
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Glob resources under an OpenViking FS base uri.

    Args:
        pattern: Glob pattern.
        uri: Base uri to apply the glob under.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_glob(pattern=pattern, uri=uri, agent_name=resolved_agent)  # type: ignore[attr-defined]
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})


@tool("ovfs_stat", parse_docstring=True)
def ovfs_stat_tool(
    runtime: ToolRuntime,
    uri: str,
    scope: MemoryScope = "auto",
    agent_name: str | None = None,
) -> str:
    """Stat a OpenViking FS uri.

    Args:
        uri: Target OpenViking FS uri.
        scope: Scope selector (`global`, `agent`, `auto`).
        agent_name: Optional agent name when scope resolves to agent.
    """
    try:
        provider = _require_openviking_provider()
        resolved_scope, resolved_agent = _resolve_scope(scope, agent_name, runtime)
        data = provider.fs_stat(uri=uri, agent_name=resolved_agent)  # type: ignore[attr-defined]
        return _json({"ok": True, "scope": resolved_scope, "agent_name": resolved_agent, "data": data})
    except Exception as exc:  # noqa: BLE001
        return _json({"ok": False, "error": str(exc)})
