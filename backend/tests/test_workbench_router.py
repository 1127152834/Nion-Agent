import subprocess
import sys
from importlib import util
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.config.paths import Paths

_WORKBENCH_PATH = Path(__file__).resolve().parents[1] / "src" / "gateway" / "routers" / "workbench.py"
_WORKBENCH_SPEC = util.spec_from_file_location("workbench_router", _WORKBENCH_PATH)
assert _WORKBENCH_SPEC and _WORKBENCH_SPEC.loader
# Avoid importing the full routers package (brings in langchain deps) in this isolated test.
workbench = util.module_from_spec(_WORKBENCH_SPEC)
sys.modules["workbench_router"] = workbench
_WORKBENCH_SPEC.loader.exec_module(workbench)
workbench.PluginTestCommandStep.model_rebuild()
workbench.PluginTestRequest.model_rebuild()
workbench.PluginTestStepResult.model_rebuild()
workbench.PluginTestResponse.model_rebuild()


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(workbench.plugin_router)
    return TestClient(app)


def test_plugin_test_step_handles_timeout_without_500(tmp_path: Path):
    with (
        _make_client() as client,
        patch.object(workbench, "_resolve_cwd", return_value=("/mnt/user-data/workspace", tmp_path)),
        patch.object(
            workbench.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(
                cmd="sleep 10",
                timeout=1,
                output="partial output",
                stderr="timeout stderr",
            ),
        ),
    ):
        response = client.post(
            "/api/workbench/plugins/demo/test",
            json={
                "thread_id": "thread-1",
                "command_steps": [
                    {
                        "id": "step-timeout",
                        "command": "sleep 10",
                        "cwd": "/mnt/user-data/workspace",
                        "timeout_seconds": 1,
                    }
                ],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["passed"] is False
    assert len(payload["steps"]) == 1
    assert payload["steps"][0]["id"] == "step-timeout"
    assert payload["steps"][0]["passed"] is False
    assert "timed out" in (payload["steps"][0]["message"] or "").lower()


def test_plugin_test_step_handles_invalid_cwd_as_failed_step():
    with (
        _make_client() as client,
        patch.object(
            workbench,
            "_resolve_cwd",
            side_effect=HTTPException(status_code=404, detail="Workbench cwd not found"),
        ),
    ):
        response = client.post(
            "/api/workbench/plugins/demo/test",
            json={
                "thread_id": "thread-1",
                "command_steps": [
                    {
                        "id": "step-cwd",
                        "command": "pwd",
                        "cwd": "/mnt/user-data/not-found",
                    }
                ],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["passed"] is False
    assert len(payload["steps"]) == 1
    assert payload["steps"][0]["id"] == "step-cwd"
    assert payload["steps"][0]["passed"] is False
    assert payload["steps"][0]["message"] == "Workbench cwd not found"


def test_plugin_test_thread_endpoint_creates_sandbox_dirs(tmp_path: Path):
    with (
        _make_client() as client,
        patch.object(workbench, "get_paths", return_value=Paths(tmp_path), create=True),
    ):
        response = client.post("/api/workbench/plugins/test-thread")

    assert response.status_code == 200
    payload = response.json()
    thread_id = payload["thread_id"]
    assert thread_id.startswith("workbench-test-")
    assert (tmp_path / "threads" / thread_id / "user-data" / "workspace").is_dir()
