from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from src.agents.memory import legacy_cleanup
from src.config.paths import Paths

LEGACY_MEMORY_FILENAME = "memory" + ".json"


def _write(path: Path, content: str = "{}") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_remove_legacy_memory_files_removes_legacy_files_and_dirs(tmp_path: Path):
    paths = Paths(base_dir=tmp_path)
    global_memory = tmp_path / LEGACY_MEMORY_FILENAME
    agent_memory = paths.agent_dir("planner") / LEGACY_MEMORY_FILENAME
    structured_root = tmp_path / "memory"

    _write(global_memory)
    _write(agent_memory)
    _write(structured_root / "index" / "manifest.json", content="{}")

    with patch("src.agents.memory.legacy_cleanup.get_paths", return_value=paths):
        result = legacy_cleanup.remove_legacy_memory_files()

    removed = set(result["removed"])
    assert str(global_memory) in removed
    assert str(agent_memory) in removed
    assert str(structured_root) in removed
    assert not global_memory.exists()
    assert not agent_memory.exists()
    assert not structured_root.exists()


def test_ensure_legacy_memory_removed_is_idempotent(tmp_path: Path):
    paths = Paths(base_dir=tmp_path)
    global_memory = tmp_path / LEGACY_MEMORY_FILENAME
    _write(global_memory)

    with patch("src.agents.memory.legacy_cleanup.get_paths", return_value=paths):
        # Reset module-level flag for deterministic test behavior.
        legacy_cleanup._cleanup_done = False
        first = legacy_cleanup.ensure_legacy_memory_removed()
        second = legacy_cleanup.ensure_legacy_memory_removed()

    assert first["already_done"] is False
    assert second["already_done"] is True
    assert not global_memory.exists()
