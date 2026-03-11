from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from src.agents.memory import legacy_cleanup
from src.config.paths import Paths


def _write(path: Path, content: str = "{}") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_remove_legacy_memory_files_removes_global_and_agent_files(tmp_path: Path):
    paths = Paths(base_dir=tmp_path)
    global_memory = paths.memory_file
    agent_memory = paths.agent_memory_file("planner")
    custom_legacy = tmp_path / "legacy-memory.json"

    _write(global_memory)
    _write(agent_memory)
    _write(custom_legacy)

    cfg = type("Cfg", (), {"storage_path": str(custom_legacy)})()
    with (
        patch("src.agents.memory.legacy_cleanup.get_paths", return_value=paths),
        patch("src.agents.memory.legacy_cleanup.get_memory_config", return_value=cfg),
    ):
        result = legacy_cleanup.remove_legacy_memory_files()

    removed = set(result["removed"])
    assert str(global_memory) in removed
    assert str(agent_memory) in removed
    assert str(custom_legacy) in removed
    assert not global_memory.exists()
    assert not agent_memory.exists()
    assert not custom_legacy.exists()


def test_ensure_legacy_memory_removed_is_idempotent(tmp_path: Path):
    paths = Paths(base_dir=tmp_path)
    global_memory = paths.memory_file
    _write(global_memory)

    cfg = type("Cfg", (), {"storage_path": ""})()
    with (
        patch("src.agents.memory.legacy_cleanup.get_paths", return_value=paths),
        patch("src.agents.memory.legacy_cleanup.get_memory_config", return_value=cfg),
    ):
        # Reset module-level flag for deterministic test behavior.
        legacy_cleanup._cleanup_done = False
        first = legacy_cleanup.ensure_legacy_memory_removed()
        second = legacy_cleanup.ensure_legacy_memory_removed()

    assert first["already_done"] is False
    assert second["already_done"] is True
    assert not global_memory.exists()
