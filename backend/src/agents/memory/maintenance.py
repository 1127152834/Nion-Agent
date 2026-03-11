"""Maintenance tools for structured memory storage."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.agents.memory.structured_runtime import StructuredFsRuntime


def get_usage_stats(runtime: StructuredFsRuntime, *, scope: str = "global", agent_name: str | None = None) -> dict:
    """Get memory usage statistics.

    Args:
        runtime: StructuredFsRuntime instance

    Returns:
        Dictionary with usage statistics
    """
    resolved_scope = runtime._resolve_scope_arg(scope=scope, agent_name=agent_name)
    manifest = runtime._read_manifest(resolved_scope)

    active_entries = [e for e in manifest.entries if e.status == "active"]
    archived_entries = [e for e in manifest.entries if e.status == "archived"]

    # Calculate total size
    total_size = 0
    manifest_file = runtime._scope_manifest_file(resolved_scope)
    if manifest_file.exists():
        total_size += manifest_file.stat().st_size

    # Add day files size
    memory_dir = runtime._scope_root(resolved_scope) / "memory"
    if memory_dir.exists():
        for day_file in memory_dir.glob("*.md"):
            total_size += day_file.stat().st_size

    return {
        "total_entries": len(manifest.entries),
        "active_entries": len(active_entries),
        "archived_entries": len(archived_entries),
        "total_size_bytes": total_size,
        "scope": resolved_scope,
    }


def compact_memory(runtime: StructuredFsRuntime, *, scope: str = "global", agent_name: str | None = None) -> dict:
    """Compact memory by removing archived entries.

    Args:
        runtime: StructuredFsRuntime instance

    Returns:
        Dictionary with compaction results
    """
    resolved_scope = runtime._resolve_scope_arg(scope=scope, agent_name=agent_name)
    manifest = runtime._read_manifest(resolved_scope)

    before_count = len(manifest.entries)
    manifest.entries = [e for e in manifest.entries if e.status == "active"]
    after_count = len(manifest.entries)

    runtime._write_manifest(manifest, resolved_scope)
    runtime._write_overview(resolved_scope, manifest)
    runtime._write_graph_index(resolved_scope, manifest)
    runtime._cache.pop(resolved_scope, None)

    return {
        "removed_count": before_count - after_count,
        "remaining_count": after_count,
        "scope": resolved_scope,
    }


def rebuild_memory(runtime: StructuredFsRuntime, *, scope: str = "global", agent_name: str | None = None) -> dict:
    """Rebuild memory manifest from day files.

    Args:
        runtime: StructuredFsRuntime instance

    Returns:
        Dictionary with rebuild results
    """
    # For now, just validate the manifest
    resolved_scope = runtime._resolve_scope_arg(scope=scope, agent_name=agent_name)
    manifest = runtime._read_manifest(resolved_scope)
    runtime._write_manifest(manifest, resolved_scope)
    runtime._write_overview(resolved_scope, manifest)
    runtime._write_graph_index(resolved_scope, manifest)
    runtime._cache.pop(resolved_scope, None)

    return {
        "entries_count": len(manifest.entries),
        "status": "rebuilt",
        "scope": resolved_scope,
    }
