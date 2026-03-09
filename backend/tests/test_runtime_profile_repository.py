from __future__ import annotations

from pathlib import Path

import pytest

from src.runtime_profile import RuntimeProfileLockedError, RuntimeProfileRepository, RuntimeProfileValidationError


def _prepare_runtime_profile_repo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> RuntimeProfileRepository:
    monkeypatch.setenv("NION_HOME", str(tmp_path))

    from src.config import paths as paths_module

    paths_module._paths = None
    return RuntimeProfileRepository()


def test_host_workdir_must_be_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo = _prepare_runtime_profile_repo(monkeypatch, tmp_path)

    host_dir = tmp_path / "host"
    host_dir.mkdir(parents=True)

    normalized = repo.validate_host_workdir(str(host_dir))
    assert normalized == str(host_dir.resolve())

    (host_dir / "exists.txt").write_text("x", encoding="utf-8")
    with pytest.raises(RuntimeProfileValidationError, match="empty directory"):
        repo.validate_host_workdir(str(host_dir))


def test_host_workdir_allows_ignorable_hidden_files(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo = _prepare_runtime_profile_repo(monkeypatch, tmp_path)

    host_dir = tmp_path / "host-hidden-files"
    host_dir.mkdir(parents=True)
    (host_dir / ".DS_Store").write_text("", encoding="utf-8")
    (host_dir / ".gitkeep").write_text("", encoding="utf-8")

    normalized = repo.validate_host_workdir(str(host_dir))
    assert normalized == str(host_dir.resolve())


def test_host_workdir_binding_cannot_change(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo = _prepare_runtime_profile_repo(monkeypatch, tmp_path)
    thread_id = "thread_host_bind"
    first = tmp_path / "host-first"
    second = tmp_path / "host-second"
    first.mkdir(parents=True)
    second.mkdir(parents=True)

    updated = repo.update(thread_id, execution_mode="host", host_workdir=str(first))
    assert updated["host_workdir"] == str(first.resolve())

    switched = repo.update(thread_id, execution_mode="sandbox", host_workdir=None)
    assert switched["execution_mode"] == "sandbox"
    assert switched["host_workdir"] == str(first.resolve())

    with pytest.raises(RuntimeProfileValidationError, match="already bound"):
        repo.update(thread_id, execution_mode="host", host_workdir=str(second))


def test_profile_locks_after_first_run(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo = _prepare_runtime_profile_repo(monkeypatch, tmp_path)
    host_dir = tmp_path / "session-host"
    host_dir.mkdir(parents=True)

    thread_id = "thread_1"
    updated = repo.update(thread_id, execution_mode="host", host_workdir=str(host_dir))
    assert updated["execution_mode"] == "host"
    assert updated["host_workdir"] == str(host_dir.resolve())

    locked = repo.lock(thread_id)
    assert locked["locked"] is True

    with pytest.raises(RuntimeProfileLockedError):
        repo.update(thread_id, execution_mode="sandbox", host_workdir=None)


def test_resolve_host_virtual_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    repo = _prepare_runtime_profile_repo(monkeypatch, tmp_path)
    host_dir = tmp_path / "resolve-host"
    host_dir.mkdir(parents=True)

    workspace_path = repo.resolve_host_virtual_path("/mnt/user-data/workspace/report.md", str(host_dir))
    uploads_path = repo.resolve_host_virtual_path("/mnt/user-data/uploads/photo.png", str(host_dir))
    outputs_path = repo.resolve_host_virtual_path("/mnt/user-data/outputs/build/log.txt", str(host_dir))

    assert workspace_path == host_dir / "report.md"
    assert uploads_path == host_dir / "photo.png"
    assert outputs_path == host_dir / "build" / "log.txt"

    with pytest.raises(RuntimeProfileValidationError, match="traversal"):
        repo.resolve_host_virtual_path("/mnt/user-data/workspace/../../etc/passwd", str(host_dir))
