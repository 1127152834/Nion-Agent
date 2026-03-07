"""Tests for memory fact correction APIs."""

import importlib.util
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths

BACKEND_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = BACKEND_DIR / "src"
AGENTS_DIR = SRC_DIR / "agents"
MEMORY_DIR = AGENTS_DIR / "memory"


def _ensure_namespace_pkg(name: str, path: Path) -> None:
    module = sys.modules.get(name)
    if module is None:
        module = types.ModuleType(name)
        module.__path__ = [str(path)]  # type: ignore[attr-defined]
        sys.modules[name] = module


def _load_module(module_name: str, module_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_ensure_namespace_pkg("src.agents", AGENTS_DIR)
_ensure_namespace_pkg("src.agents.memory", MEMORY_DIR)
memory_updater = _load_module("test_memory_updater_module", MEMORY_DIR / "updater.py")

memory_bridge = types.ModuleType("src.agents.memory.memory")
memory_bridge.get_memory_data = memory_updater.get_memory_data
memory_bridge.reload_memory_data = memory_updater.reload_memory_data
memory_bridge.update_memory_fact = memory_updater.update_fact
memory_bridge.pin_memory_fact = memory_updater.pin_fact
memory_bridge.delete_memory_fact = memory_updater.delete_fact
sys.modules["src.agents.memory.memory"] = memory_bridge

memory_router_module = _load_module(
    "test_memory_router_module",
    SRC_DIR / "gateway" / "routers" / "memory.py",
)
router = memory_router_module.router


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def _seed_memory_file(paths: Paths) -> None:
    payload = {
        "version": "1.0",
        "lastUpdated": "2026-03-06T00:00:00Z",
        "user": {
            "workContext": {"summary": "", "updatedAt": ""},
            "personalContext": {"summary": "", "updatedAt": ""},
            "topOfMind": {"summary": "", "updatedAt": ""},
        },
        "history": {
            "recentMonths": {"summary": "", "updatedAt": ""},
            "earlierContext": {"summary": "", "updatedAt": ""},
            "longTermBackground": {"summary": "", "updatedAt": ""},
        },
        "facts": [
            {
                "id": "fact_1",
                "content": "用户喜欢 Python",
                "category": "preference",
                "confidence": 0.8,
                "createdAt": "2026-03-05T00:00:00Z",
                "source": "thread_1",
            },
            {
                "id": "fact_2",
                "content": "用户正在做记忆系统升级",
                "category": "project",
                "confidence": 0.9,
                "createdAt": "2026-03-05T00:00:00Z",
                "source": "thread_2",
            },
        ],
    }

    paths.memory_file.parent.mkdir(parents=True, exist_ok=True)
    paths.memory_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@pytest.fixture()
def memory_client(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)
    _seed_memory_file(paths)
    memory_updater._memory_cache.clear()  # noqa: SLF001

    with patch(f"{memory_updater.__name__}.get_paths", return_value=paths):
        with TestClient(app) as client:
            yield client

    memory_updater._memory_cache.clear()  # noqa: SLF001


def test_patch_fact_and_readback(memory_client: TestClient) -> None:
    response = memory_client.patch(
        "/api/memory/facts/fact_1",
        json={
            "content": "用户偏好 Python 3.12",
            "inaccurate": True,
            "confidence": 0.95,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "fact_1"
    assert payload["content"] == "用户偏好 Python 3.12"
    assert payload["inaccurate"] is True
    assert payload["confidence"] == 0.95

    stored = memory_updater.get_memory_data()
    fact = next(f for f in stored["facts"] if f["id"] == "fact_1")
    assert fact["content"] == "用户偏好 Python 3.12"
    assert fact["inaccurate"] is True


def test_pin_fact_toggle_and_unpin(memory_client: TestClient) -> None:
    toggle_response = memory_client.post("/api/memory/facts/fact_2/pin", json={})
    assert toggle_response.status_code == 200
    assert toggle_response.json()["pinned"] is True

    unpin_response = memory_client.post(
        "/api/memory/facts/fact_2/pin",
        json={"pinned": False},
    )
    assert unpin_response.status_code == 200
    assert unpin_response.json()["pinned"] is False

    stored = memory_updater.get_memory_data()
    fact = next(f for f in stored["facts"] if f["id"] == "fact_2")
    assert fact["pinned"] is False


def test_delete_fact_and_readback(memory_client: TestClient) -> None:
    response = memory_client.delete("/api/memory/facts/fact_1")
    assert response.status_code == 200
    assert response.json() == {"success": True, "id": "fact_1"}

    stored = memory_updater.get_memory_data()
    remaining_ids = {fact["id"] for fact in stored["facts"]}
    assert "fact_1" not in remaining_ids
    assert "fact_2" in remaining_ids
