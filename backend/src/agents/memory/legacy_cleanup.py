"""Legacy memory.json cleanup helpers for structured-fs hard cut."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from src.config.memory_config import get_memory_config
from src.config.paths import get_paths

logger = logging.getLogger(__name__)

_cleanup_lock = threading.Lock()
_cleanup_done = False


def _resolve_storage_path_candidate(raw_path: str) -> Path | None:
    if not raw_path:
        return None
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = get_paths().base_dir / candidate
    return candidate.resolve()


def remove_legacy_memory_files() -> dict[str, object]:
    """Delete legacy memory.json files for global and agent scopes."""
    paths = get_paths()
    removed: list[str] = []
    skipped: list[str] = []

    targets: list[Path] = [paths.memory_file]

    # Include explicitly configured legacy path if provided.
    config = get_memory_config()
    candidate = _resolve_storage_path_candidate(config.storage_path)
    if candidate is not None:
        targets.append(candidate)

    # Include all per-agent legacy memory.json files.
    agents_dir = paths.agents_dir
    if agents_dir.exists():
        for agent_dir in agents_dir.iterdir():
            if agent_dir.is_dir():
                targets.append(agent_dir / "memory.json")

    unique_targets: list[Path] = []
    seen: set[str] = set()
    for target in targets:
        key = str(target)
        if key in seen:
            continue
        seen.add(key)
        unique_targets.append(target)

    for target in unique_targets:
        if not target.exists():
            skipped.append(str(target))
            continue
        if target.is_dir():
            skipped.append(str(target))
            continue
        try:
            target.unlink()
            removed.append(str(target))
        except OSError as exc:
            logger.warning("Failed to delete legacy memory file %s: %s", target, exc)
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

