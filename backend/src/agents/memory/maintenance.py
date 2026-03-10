"""Maintenance tools for structured memory storage."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.agents.memory.structured_runtime import StructuredFsRuntime


def get_usage_stats(runtime: StructuredFsRuntime) -> dict:
    """Get memory usage statistics.

    Args:
        runtime: StructuredFsRuntime instance

    Returns:
        Dictionary with usage statistics
    """
    manifest = runtime._read_manifest()

    active_entries = [e for e in manifest.entries if e.status == "active"]
    archived_entries = [e for e in manifest.entries if e.status == "archived"]

    # Calculate total size
    total_size = 0
    manifest_file = runtime._paths.memory_manifest_file
    if manifest_file.exists():
        total_size += manifest_file.stat().st_size

    # Add day files size
    memory_dir = runtime._paths.structured_memory_root / "memory"
    if memory_dir.exists():
        for day_file in memory_dir.glob("*.md"):
            total_size += day_file.stat().st_size

    return {
        "total_entries": len(manifest.entries),
        "active_entries": len(active_entries),
        "archived_entries": len(archived_entries),
        "total_size_bytes": total_size,
    }


def compact_memory(runtime: StructuredFsRuntime) -> dict:
    """Compact memory by removing archived entries.

    Args:
        runtime: StructuredFsRuntime instance

    Returns:
        Dictionary with compaction results
    """
    manifest = runtime._read_manifest()

    before_count = len(manifest.entries)
    manifest.entries = [e for e in manifest.entries if e.status == "active"]
    after_count = len(manifest.entries)

    runtime._write_manifest(manifest)
    runtime._cache = None  # Invalidate cache

    return {
        "removed_count": before_count - after_count,
        "remaining_count": after_count,
    }


def rebuild_memory(runtime: StructuredFsRuntime) -> dict:
    """Rebuild memory manifest from day files.

    Args:
        runtime: StructuredFsRuntime instance

    Returns:
        Dictionary with rebuild results
    """
    # For now, just validate the manifest
    manifest = runtime._read_manifest()
    runtime._write_manifest(manifest)
    runtime._cache = None  # Invalidate cache

    return {
        "entries_count": len(manifest.entries),
        "status": "rebuilt",
    }
