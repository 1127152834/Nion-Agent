from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.gateway.routers.workspace as workspace


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(workspace.router)
    return TestClient(app)


def test_workspace_tree_lists_directories_and_files(tmp_path: Path):
    workspace_root = tmp_path / "workspace"
    app_dir = workspace_root / "app"
    app_dir.mkdir(parents=True)
    (workspace_root / "README.md").write_text("# demo", encoding="utf-8")
    (app_dir / "index.ts").write_text("console.log('ok')", encoding="utf-8")

    with (
        _make_client() as client,
        patch.object(workspace, "resolve_thread_virtual_path", return_value=workspace_root),
    ):
        response = client.get(
            "/api/threads/thread-1/workspace/tree",
            params={"root": "/mnt/user-data/workspace", "depth": 6},
        )

    assert response.status_code == 200
    payload = response.json()
    directory_paths = {item["path"] for item in payload["directories"]}
    file_paths = {item["path"] for item in payload["files"]}
    assert "/mnt/user-data/workspace/app" in directory_paths
    assert "/mnt/user-data/workspace/README.md" in file_paths
    assert "/mnt/user-data/workspace/app/index.ts" in file_paths


def test_workspace_tree_returns_404_when_root_missing(tmp_path: Path):
    missing_root = tmp_path / "missing"

    with (
        _make_client() as client,
        patch.object(workspace, "resolve_thread_virtual_path", return_value=missing_root),
    ):
        response = client.get(
            "/api/threads/thread-1/workspace/tree",
            params={"root": "/mnt/user-data/workspace"},
        )

    assert response.status_code == 404
    assert "Workspace path not found" in response.json()["detail"]


def test_workspace_tree_creates_empty_sandbox_dirs_for_new_thread(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("NION_HOME", str(tmp_path))

    from nion.config import paths as paths_module

    paths_module._paths = None

    with _make_client() as client:
        response = client.get(
            "/api/threads/thread_new/workspace/tree",
            params={"root": "/mnt/user-data/workspace", "depth": 2},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["root"] == "/mnt/user-data/workspace"
    assert payload["directories"] == []
    assert payload["files"] == []
    assert (tmp_path / "threads" / "thread_new" / "user-data" / "workspace").exists()


def test_workspace_meta_returns_actual_root_and_mode(tmp_path: Path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir(parents=True)

    profile = {
        "execution_mode": "host",
        "host_workdir": str(workspace_root),
        "locked": True,
        "updated_at": "2026-03-09T00:00:00Z",
    }

    repository = workspace.RuntimeProfileRepository()

    with (
        _make_client() as client,
        patch.object(workspace, "resolve_thread_virtual_path", return_value=workspace_root),
        patch.object(repository, "read", return_value=profile),
        patch.object(workspace, "RuntimeProfileRepository", return_value=repository),
    ):
        response = client.get(
            "/api/threads/thread-1/workspace/meta",
            params={"root": "/mnt/user-data/workspace"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["thread_id"] == "thread-1"
    assert payload["root"] == "/mnt/user-data/workspace"
    assert payload["actual_root"] == str(workspace_root)
    assert payload["execution_mode"] == "host"
    assert payload["host_workdir"] == str(workspace_root)


def test_workspace_tree_can_list_sandbox_backed_paths(monkeypatch, tmp_path: Path):
    """Provisioner-backed AIO sandboxes keep /mnt/user-data inside the sandbox.

    The workspace tree endpoint should still return entries by querying the sandbox
    filesystem when the host mirror is empty.
    """
    monkeypatch.setenv("NION_HOME", str(tmp_path))

    from nion.config import paths as paths_module

    paths_module._paths = None

    class StubSandbox:
        def execute_command(self, command: str) -> str:
            if command.startswith("test -d"):
                return "OK"
            if "-type d" in command:
                return "/mnt/user-data/workspace/xiaomi-auto"
            if "-type f" in command:
                return "/mnt/user-data/workspace/xiaomi-auto/index.html"
            return "(no output)"

    class StubProvider:
        def acquire(self, thread_id: str | None = None) -> str:
            return "stub"

        def get(self, sandbox_id: str):
            return StubSandbox()

    with (
        _make_client() as client,
        patch.object(workspace, "_workspace_tree_is_sandbox_backed", return_value=True),
        patch.object(workspace, "get_sandbox_provider", return_value=StubProvider()),
        patch.object(workspace, "resolve_thread_virtual_path", return_value=tmp_path),
    ):
        response = client.get(
            "/api/threads/thread-1/workspace/tree",
            params={"root": "/mnt/user-data/workspace", "depth": 6},
        )

    assert response.status_code == 200
    payload = response.json()
    directory_paths = {item["path"] for item in payload["directories"]}
    file_paths = {item["path"] for item in payload["files"]}
    assert "/mnt/user-data/workspace/xiaomi-auto" in directory_paths
    assert "/mnt/user-data/workspace/xiaomi-auto/index.html" in file_paths
