"""Legacy memory cleanup helpers for OpenViking hard cut."""

from __future__ import annotations

import logging
import shutil
import threading
from pathlib import Path

from src.config.paths import get_paths

logger = logging.getLogger(__name__)

_cleanup_lock = threading.Lock()
_cleanup_done = False
_LEGACY_MEMORY_FILENAME = "memory" + ".json"


def _collect_legacy_targets() -> list[Path]:
    paths = get_paths()
    targets: list[Path] = []

    # Legacy single-file memory store (global + per-agent)
    targets.append(paths.base_dir / _LEGACY_MEMORY_FILENAME)

    # Structured-fs roots used by previous memory implementation.
    targets.append(paths.base_dir / "memory")

    # Historical snapshots created by migration scripts.
    targets.append(paths.base_dir / "snapshots" / "memory")

    agents_dir = paths.agents_dir
    if agents_dir.exists():
        for agent_dir in agents_dir.iterdir():
            if not agent_dir.is_dir():
                continue
            targets.append(agent_dir / _LEGACY_MEMORY_FILENAME)
            targets.append(agent_dir / "memory")

    # De-duplicate while preserving order.
    seen: set[str] = set()
    unique: list[Path] = []
    for target in targets:
        key = str(target.resolve()) if target.exists() else str(target)
        if key in seen:
            continue
        seen.add(key)
        unique.append(target)
    return unique


def remove_legacy_memory_files() -> dict[str, object]:
    """Delete legacy single-file memory artifacts and old structured directories."""
    removed: list[str] = []
    skipped: list[str] = []

    for target in _collect_legacy_targets():
        if not target.exists():
            skipped.append(str(target))
            continue
        try:
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
            removed.append(str(target))
        except OSError as exc:
            logger.warning("Failed to delete legacy memory artifact %s: %s", target, exc)
            skipped.append(str(target))

    return {"removed": removed, "skipped": skipped}


def ensure_legacy_memory_removed() -> dict[str, object]:
    """Run cleanup once per process, idempotently."""
    global _cleanup_done
    with _cleanup_lock:
        if _cleanup_done:
            return {"removed": [], "skipped": [], "already_done": True}
        result = remove_legacy_memory_files()
        _cleanup_done = True
        logger.info(
            "Legacy memory cleanup completed: removed=%d skipped=%d",
            len(result.get("removed", [])),
            len(result.get("skipped", [])),
        )
        result["already_done"] = False
        return result
