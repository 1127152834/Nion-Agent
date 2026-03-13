from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

_ROUTER_MODULE_PATH = Path(__file__).resolve().parents[1] / "src" / "gateway" / "routers" / "runtime_profile.py"
_ROUTER_SPEC = importlib.util.spec_from_file_location("runtime_profile_router_test_module", _ROUTER_MODULE_PATH)
if _ROUTER_SPEC is None or _ROUTER_SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("Failed to load runtime_profile router module")
_ROUTER_MODULE = importlib.util.module_from_spec(_ROUTER_SPEC)
sys.modules[_ROUTER_SPEC.name] = _ROUTER_MODULE
_ROUTER_SPEC.loader.exec_module(_ROUTER_MODULE)
_ROUTER_MODULE.RuntimeProfileResponse.model_rebuild()
_ROUTER_MODULE.RuntimeProfileUpdateRequest.model_rebuild()
router = _ROUTER_MODULE.router

from src.runtime_profile import RuntimeProfileRepository


def _make_client(monkeypatch, tmp_path: Path, *, desktop: bool) -> TestClient:
    monkeypatch.setenv("NION_HOME", str(tmp_path))
    monkeypatch.setenv("NION_DESKTOP_RUNTIME", "1" if desktop else "0")

    from src.config import paths as paths_module

    paths_module._paths = None
    from src.config import app_config as app_config_module

    app_config_module.reset_app_config()

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_get_runtime_profile_default(monkeypatch, tmp_path: Path) -> None:
    client = _make_client(monkeypatch, tmp_path, desktop=True)

    response = client.get("/api/threads/thread_1/runtime-profile")
    assert response.status_code == 200
    payload = response.json()
    assert payload["execution_mode"] == "sandbox"
    assert payload["host_workdir"] is None
    assert payload["locked"] is False


def test_put_host_mode_requires_empty_dir(monkeypatch, tmp_path: Path) -> None:
    client = _make_client(monkeypatch, tmp_path, desktop=True)
    host_dir = tmp_path / "host-dir"
    host_dir.mkdir(parents=True)
    (host_dir / "exists.txt").write_text("x", encoding="utf-8")

    response = client.put(
        "/api/threads/thread_2/runtime-profile",
        json={
            "execution_mode": "host",
            "host_workdir": str(host_dir),
        },
    )
    assert response.status_code == 422
    assert "empty directory" in response.json()["detail"]


def test_put_host_mode_accepts_ignorable_hidden_files(monkeypatch, tmp_path: Path) -> None:
    client = _make_client(monkeypatch, tmp_path, desktop=True)
    host_dir = tmp_path / "host-dir-hidden"
    host_dir.mkdir(parents=True)
    (host_dir / ".DS_Store").write_text("", encoding="utf-8")

    response = client.put(
        "/api/threads/thread_2b/runtime-profile",
        json={
            "execution_mode": "host",
            "host_workdir": str(host_dir),
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["execution_mode"] == "host"
    assert payload["host_workdir"] == str(host_dir.resolve())


def test_put_host_mode_desktop_only(monkeypatch, tmp_path: Path) -> None:
    client = _make_client(monkeypatch, tmp_path, desktop=False)
    host_dir = tmp_path / "host-dir"
    host_dir.mkdir(parents=True)

    response = client.put(
        "/api/threads/thread_3/runtime-profile",
        json={
            "execution_mode": "host",
            "host_workdir": str(host_dir),
        },
    )
    assert response.status_code == 503


def test_put_runtime_profile_rejects_when_locked(monkeypatch, tmp_path: Path) -> None:
    client = _make_client(monkeypatch, tmp_path, desktop=True)
    repo = RuntimeProfileRepository()

    thread_id = "thread_4"
    host_dir = tmp_path / "locked-host"
    host_dir.mkdir(parents=True)
    repo.update(thread_id, execution_mode="host", host_workdir=str(host_dir))
    repo.lock(thread_id)

    response = client.put(
        f"/api/threads/{thread_id}/runtime-profile",
        json={
            "execution_mode": "sandbox",
            "host_workdir": None,
        },
    )
    assert response.status_code == 409


def test_put_runtime_profile_host_dir_binding(monkeypatch, tmp_path: Path) -> None:
    client = _make_client(monkeypatch, tmp_path, desktop=True)
    first = tmp_path / "first-host-dir"
    second = tmp_path / "second-host-dir"
    first.mkdir(parents=True)
    second.mkdir(parents=True)

    bind_response = client.put(
        "/api/threads/thread_5/runtime-profile",
        json={
            "execution_mode": "host",
            "host_workdir": str(first),
        },
    )
    assert bind_response.status_code == 200

    sandbox_response = client.put(
        "/api/threads/thread_5/runtime-profile",
        json={
            "execution_mode": "sandbox",
            "host_workdir": None,
        },
    )
    assert sandbox_response.status_code == 200
    assert sandbox_response.json()["host_workdir"] == str(first.resolve())

    change_response = client.put(
        "/api/threads/thread_5/runtime-profile",
        json={
            "execution_mode": "host",
            "host_workdir": str(second),
        },
    )
    assert change_response.status_code == 422
    assert "already bound" in change_response.json()["detail"]
