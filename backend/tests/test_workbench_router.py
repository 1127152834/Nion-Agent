import subprocess
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import src.gateway.routers.workbench as workbench


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
