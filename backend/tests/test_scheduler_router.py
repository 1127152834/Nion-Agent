from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.gateway.routers.scheduler import router
from src.scheduler.service import get_scheduler, shutdown_scheduler


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def _base_payload() -> dict:
    run_at = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0).isoformat()
    return {
        "name": "daily-market-report",
        "description": "Generate market report",
        "trigger": {
            "type": "once",
            "scheduled_time": run_at,
        },
        "steps": [
            {
                "id": "step-1",
                "name": "research",
                "agents": [
                    {
                        "agent_name": "general-purpose",
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


def test_scheduler_task_crud_and_run_now(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch(
            "src.scheduler.runner.TaskScheduler._execute_workflow",
            return_value={"success": True, "context": {"step-1": [{"output": "ok"}]}},
        ):
            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()

                create_resp = client.post("/api/scheduler/tasks", json=_base_payload())
                assert create_resp.status_code == 201
                task = create_resp.json()
                task_id = task["id"]
                assert task["name"] == "daily-market-report"
                assert task["status"] == "pending"

                list_resp = client.get("/api/scheduler/tasks")
                assert list_resp.status_code == 200
                tasks = list_resp.json()
                assert len(tasks) == 1
                assert tasks[0]["id"] == task_id

                run_resp = client.post(f"/api/scheduler/tasks/{task_id}/run")
                assert run_resp.status_code == 202
                assert run_resp.json()["task_id"] == task_id

                history_resp = client.get(f"/api/scheduler/tasks/{task_id}/history")
                assert history_resp.status_code == 200
                history = history_resp.json()
                assert len(history) == 1
                assert history[0]["status"] == "completed"

                get_resp = client.get(f"/api/scheduler/tasks/{task_id}")
                assert get_resp.status_code == 200
                assert get_resp.json()["status"] == "completed"

                delete_resp = client.delete(f"/api/scheduler/tasks/{task_id}")
                assert delete_resp.status_code == 204

                missing_resp = client.get(f"/api/scheduler/tasks/{task_id}")
                assert missing_resp.status_code == 404

                shutdown_scheduler()


def test_scheduler_rejects_invalid_trigger(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = _base_payload()
    payload["trigger"] = {"type": "interval", "interval_seconds": -1}

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()

            resp = client.post("/api/scheduler/tasks", json=payload)
            assert resp.status_code == 422

            shutdown_scheduler()


def test_scheduler_webhook_trigger_with_secret(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = _base_payload()
    payload["trigger"] = {
        "type": "webhook",
        "webhook_secret": "top-secret",
    }

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch(
            "src.scheduler.runner.TaskScheduler._execute_workflow",
            return_value={"success": True, "context": {"step-1": [{"output": "ok"}]}},
        ):
            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()

                create_resp = client.post("/api/scheduler/tasks", json=payload)
                assert create_resp.status_code == 201
                task_id = create_resp.json()["id"]

                denied = client.post(
                    f"/api/scheduler/tasks/{task_id}/webhook",
                    json={"source": "crm", "event": "user.created"},
                )
                assert denied.status_code == 401

                accepted = client.post(
                    f"/api/scheduler/tasks/{task_id}/webhook",
                    json={"source": "crm", "event": "user.created"},
                    headers={"X-Nion-Webhook-Secret": "top-secret"},
                )
                assert accepted.status_code == 202
                assert accepted.json()["task_id"] == task_id

                history_resp = client.get(f"/api/scheduler/tasks/{task_id}/history")
                assert history_resp.status_code == 200
                history = history_resp.json()
                assert len(history) == 1
                assert history[0]["status"] == "completed"

                shutdown_scheduler()


def test_scheduler_webhook_rejects_non_webhook_task(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch(
            "src.scheduler.runner.TaskScheduler._execute_workflow",
            return_value={"success": True, "context": {"step-1": [{"output": "ok"}]}},
        ):
            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()

                create_resp = client.post("/api/scheduler/tasks", json=_base_payload())
                assert create_resp.status_code == 201
                task_id = create_resp.json()["id"]

                resp = client.post(
                    f"/api/scheduler/tasks/{task_id}/webhook",
                    json={"event": "any"},
                )
                assert resp.status_code == 409

                shutdown_scheduler()


def test_scheduler_reminder_mode_runs_without_workflow_executor(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = {
        "name": "drink-water",
        "description": "hydrate",
        "mode": "reminder",
        "trigger": {
            "type": "interval",
            "interval_seconds": 3600,
            "timezone": "Asia/Shanghai",
        },
        "steps": [],
        "reminder_title": "喝水提醒",
        "reminder_message": "现在喝一杯水",
        "enabled": True,
        "created_by": "tester",
    }

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()

            create_resp = client.post("/api/scheduler/tasks", json=payload)
            assert create_resp.status_code == 201
            task = create_resp.json()
            assert task["mode"] == "reminder"
            task_id = task["id"]

            run_resp = client.post(f"/api/scheduler/tasks/{task_id}/run")
            assert run_resp.status_code == 202

            history_resp = client.get(f"/api/scheduler/tasks/{task_id}/history")
            assert history_resp.status_code == 200
            history = history_resp.json()
            assert len(history) == 1
            assert history[0]["status"] == "completed"
            assert history[0]["result"]["mode"] == "reminder"
            assert history[0]["result"]["reminder"]["message"] == "现在喝一杯水"

            shutdown_scheduler()


def test_scheduler_once_trigger_respects_timezone(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    payload = _base_payload()
    payload["trigger"] = {
        "type": "once",
        "scheduled_time": "2099-01-01T09:00:00",
        "timezone": "Asia/Shanghai",
    }

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            scheduler = get_scheduler()
            scheduler.start()

            create_resp = client.post("/api/scheduler/tasks", json=payload)
            assert create_resp.status_code == 201
            task = create_resp.json()
            assert task["trigger"]["timezone"] == "Asia/Shanghai"
            # 2099-01-01 09:00:00+08:00 -> 2099-01-01 01:00:00+00:00
            assert task["trigger"]["scheduled_time"] == "2099-01-01T01:00:00Z"

            shutdown_scheduler()
