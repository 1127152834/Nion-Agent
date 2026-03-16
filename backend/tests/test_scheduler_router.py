from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers.scheduler import router
from nion.config.paths import Paths
from nion.scheduler.service import get_scheduler, shutdown_scheduler


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def _base_payload(*, agent_name: str, name: str = "daily-market-report") -> dict:
    run_at = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0).isoformat()
    return {
        "agent_name": agent_name,
        "name": name,
        "description": "Generate market report",
        "trigger": {
            "type": "once",
            "scheduled_time": run_at,
        },
        "steps": [
            {
                "id": "step-1",
                "name": "default",
                "agents": [
                    {
                        "agent_name": agent_name,
                        "prompt": "Analyze Xiaomi Auto trends.",
                        "timeout_seconds": 30,
                        "retry_on_failure": False,
                        "max_retries": 0,
                    }
                ],
                "parallel": False,
                "depends_on": [],
            }
        ],
        "enabled": True,
        "created_by": "tester",
        "timeout_seconds": 120,
        "max_concurrent_steps": 2,
    }


def test_scheduler_task_crud_and_run_now_scoped_to_agent(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with patch(
            "nion.scheduler.runner.TaskScheduler._execute_workflow",
            return_value={"success": True, "context": {"step-1": [{"output": "ok"}]}},
        ):
            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()
                try:
                    create_resp = client.post("/api/scheduler/tasks", json=_base_payload(agent_name="agent-a"))
                    assert create_resp.status_code == 201
                    task = create_resp.json()
                    task_id = task["id"]
                    assert task["agent_name"] == "agent-a"
                    assert task["name"] == "daily-market-report"
                    assert task["status"] == "pending"

                    list_resp = client.get("/api/scheduler/tasks?agent_name=agent-a")
                    assert list_resp.status_code == 200
                    tasks = list_resp.json()
                    assert len(tasks) == 1
                    assert tasks[0]["id"] == task_id

                    run_resp = client.post(f"/api/scheduler/tasks/{task_id}/run")
                    assert run_resp.status_code == 202
                    assert run_resp.json()["task_id"] == task_id

                    history: list[dict] = []
                    for _ in range(100):
                        history_resp = client.get(f"/api/scheduler/tasks/{task_id}/history")
                        assert history_resp.status_code == 200
                        history = history_resp.json()
                        if history:
                            break
                        time.sleep(0.05)
                    assert len(history) == 1
                    assert history[0]["status"] == "completed"

                    task_status = None
                    for _ in range(100):
                        get_resp = client.get(f"/api/scheduler/tasks/{task_id}")
                        assert get_resp.status_code == 200
                        task_status = get_resp.json().get("status")
                        if task_status == "completed":
                            break
                        time.sleep(0.05)
                    assert task_status == "completed"

                    clear_history_resp = client.delete(f"/api/scheduler/tasks/{task_id}/history")
                    assert clear_history_resp.status_code == 204

                    history_resp = client.get(f"/api/scheduler/tasks/{task_id}/history")
                    assert history_resp.status_code == 200
                    assert history_resp.json() == []

                    delete_resp = client.delete(f"/api/scheduler/tasks/{task_id}")
                    assert delete_resp.status_code == 204

                    missing_resp = client.get(f"/api/scheduler/tasks/{task_id}")
                    assert missing_resp.status_code == 404
                finally:
                    shutdown_scheduler()


def test_scheduler_create_requires_agent_name(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = _base_payload(agent_name="agent-a")
    del payload["agent_name"]

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()
            try:
                resp = client.post("/api/scheduler/tasks", json=payload)
                assert resp.status_code == 422
            finally:
                shutdown_scheduler()


def test_scheduler_rejects_non_time_triggers(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = _base_payload(agent_name="agent-a")
    payload["trigger"] = {"type": "webhook", "webhook_secret": "secret"}

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()
            try:
                resp = client.post("/api/scheduler/tasks", json=payload)
                assert resp.status_code in {400, 409, 422}
            finally:
                shutdown_scheduler()


def test_scheduler_list_filters_by_agent_name(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()
            try:
                a = client.post("/api/scheduler/tasks", json=_base_payload(agent_name="agent-a", name="task-a"))
                b = client.post("/api/scheduler/tasks", json=_base_payload(agent_name="agent-b", name="task-b"))
                assert a.status_code == 201
                assert b.status_code == 201

                all_resp = client.get("/api/scheduler/tasks")
                assert all_resp.status_code == 200
                assert len(all_resp.json()) == 2

                only_a = client.get("/api/scheduler/tasks?agent_name=agent-a")
                assert only_a.status_code == 200
                tasks_a = only_a.json()
                assert len(tasks_a) == 1
                assert tasks_a[0]["agent_name"] == "agent-a"
            finally:
                shutdown_scheduler()


def test_scheduler_dashboard_aggregates_24h_metrics(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    def _exec_result(task, **_kwargs):
        # Make agent-a succeed and agent-b fail.
        if getattr(task, "agent_name", None) == "agent-a":
            return {"success": True, "context": {}}
        return {"success": False, "error": "boom", "context": {}}

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with patch("nion.scheduler.runner.TaskScheduler._execute_workflow", side_effect=_exec_result):
            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()
                try:
                    a = client.post("/api/scheduler/tasks", json=_base_payload(agent_name="agent-a", name="task-a"))
                    b = client.post("/api/scheduler/tasks", json=_base_payload(agent_name="agent-b", name="task-b"))
                    assert a.status_code == 201
                    assert b.status_code == 201
                    task_a_id = a.json()["id"]
                    task_b_id = b.json()["id"]

                    assert client.post(f"/api/scheduler/tasks/{task_a_id}/run").status_code == 202
                    assert client.post(f"/api/scheduler/tasks/{task_b_id}/run").status_code == 202

                    # Wait for async runs to complete and histories to be recorded.
                    for _ in range(100):
                        ha = client.get(f"/api/scheduler/tasks/{task_a_id}/history").json()
                        hb = client.get(f"/api/scheduler/tasks/{task_b_id}/history").json()
                        if ha and hb:
                            break
                        time.sleep(0.05)

                    dash = client.get("/api/scheduler/dashboard")
                    assert dash.status_code == 200
                    payload = dash.json()
                    assert payload["agent_count_with_tasks"] == 2
                    assert payload["task_count"] == 2
                    assert payload["failed_task_count_24h"] == 1
                    assert payload["success_rate_24h"] in {0.5, 0.0, 1.0}

                    agents = {row["agent_name"]: row for row in payload["agents"]}
                    assert agents["agent-a"]["task_count"] == 1
                    assert agents["agent-b"]["task_count"] == 1
                    assert agents["agent-a"]["failed_runs_24h"] == 0
                    assert agents["agent-b"]["failed_runs_24h"] == 1
                finally:
                    shutdown_scheduler()


def test_scheduler_once_trigger_respects_timezone(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = _base_payload(agent_name="agent-a")
    payload["trigger"] = {
        "type": "once",
        "scheduled_time": "2099-01-01T09:00:00",
        "timezone": "Asia/Shanghai",
    }

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()
            try:
                create_resp = client.post("/api/scheduler/tasks", json=payload)
                assert create_resp.status_code == 201
                task = create_resp.json()
                assert task["trigger"]["timezone"] == "Asia/Shanghai"
                # 2099-01-01 09:00:00+08:00 -> 2099-01-01 01:00:00+00:00
                assert task["trigger"]["scheduled_time"] == "2099-01-01T01:00:00Z"
            finally:
                shutdown_scheduler()
