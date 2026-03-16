"""Tests for scheduler management chat tools."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.testclient import TestClient

from nion.config.paths import Paths
from app.gateway.routers.scheduler import router as scheduler_router
from nion.scheduler.models import AgentStep, ScheduledTask, TriggerConfig, TriggerType, WorkflowStep
from nion.scheduler.service import get_scheduler, shutdown_scheduler
from nion.tools.builtins.scheduler_manage_tools import scheduler_create_task_tool, scheduler_operate_task_tool


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(scheduler_router)
    return app


def _httpx_request_via_test_client(client: TestClient):
    def _request(method: str, url: str, *, json=None, timeout=None):  # noqa: ANN001, ANN002, ARG001
        parts = urlsplit(url)
        path = parts.path
        if parts.query:
            path = f"{path}?{parts.query}"
        return client.request(method, path, json=json)

    return _request


def _runtime(
    thread_id: str = "thread-test",
    timezone: str = "Asia/Shanghai",
    agent_name: str = "agent-a",
) -> SimpleNamespace:
    return SimpleNamespace(context={"thread_id": thread_id, "user_timezone": timezone, "agent_name": agent_name})


def _workflow_task() -> ScheduledTask:
    return ScheduledTask(
        agent_name="agent-a",
        name="test-task",
        description="for delete test",
        trigger=TriggerConfig(
            type=TriggerType.ONCE,
            scheduled_time=(datetime.now(UTC) + timedelta(days=1)),
            timezone="UTC",
        ),
        steps=[
            WorkflowStep(
                id="step-1",
                name="default",
                agents=[
                    AgentStep(
                        agent_name="general-purpose",
                        prompt="say hello",
                        timeout_seconds=60,
                        retry_on_failure=False,
                        max_retries=0,
                    )
                ],
                parallel=False,
                depends_on=[],
            )
        ],
        created_by="tester",
    )


def test_scheduler_create_task_tool_creates_reminder_with_runtime_timezone(tmp_path):
    paths = Paths(base_dir=tmp_path)
    with patch("nion.scheduler.store.get_paths", return_value=paths):
        app = _make_app()
        with TestClient(app) as client:
            with patch(
                "nion.tools.builtins.scheduler_manage_tools.httpx.request",
                new=_httpx_request_via_test_client(client),
            ):
                scheduler = get_scheduler()
                scheduler.start()

                raw = scheduler_create_task_tool.func(
                    runtime=_runtime(),
                    name="drink-water",
                    mode="reminder",
                    trigger_type="cron",
                    cron_expression="0 9 * * *",
                    reminder_title="喝水提醒",
                    reminder_message="请喝水",
                )
                payload = json.loads(raw)
                assert payload["success"] is True
                task_id = payload["data"]["task_id"]
                created = scheduler.get_task(task_id)
                assert created is not None
                assert created.mode.value == "reminder"
                assert created.trigger.timezone == "Asia/Shanghai"
                assert created.reminder_message == "请喝水"

                shutdown_scheduler()


def test_scheduler_create_task_missing_cron_returns_clarification(tmp_path):
    paths = Paths(base_dir=tmp_path)
    with patch("nion.scheduler.store.get_paths", return_value=paths):
        scheduler = get_scheduler()
        scheduler.start()

        raw = scheduler_create_task_tool.func(
            runtime=_runtime(),
            name="drink-water",
            mode="reminder",
            trigger_type="cron",
        )
        payload = json.loads(raw)
        assert payload["success"] is False
        assert payload["next_action"] == "ask_clarification"
        assert "cron_expression" in payload["clarification"]["missing_fields"]

        shutdown_scheduler()


def test_scheduler_operate_task_requires_confirmation_for_delete(tmp_path):
    paths = Paths(base_dir=tmp_path)
    with patch("nion.scheduler.store.get_paths", return_value=paths):
        app = _make_app()
        with TestClient(app) as client:
            with patch(
                "nion.tools.builtins.scheduler_manage_tools.httpx.request",
                new=_httpx_request_via_test_client(client),
            ):
                scheduler = get_scheduler()
                scheduler.start()
                created = scheduler.add_task(_workflow_task())

                first_raw = scheduler_operate_task_tool.func(
                    task_id=created.id,
                    operation="delete",
                )
                first = json.loads(first_raw)
                assert first["success"] is False
                assert first["requires_confirmation"] is True
                token = first["confirmation_token"]
                assert isinstance(token, str) and token

                second_raw = scheduler_operate_task_tool.func(
                    task_id=created.id,
                    operation="delete",
                    confirmation_token=token,
                )
                second = json.loads(second_raw)
                assert second["success"] is True
                assert scheduler.get_task(created.id) is None

                shutdown_scheduler()
