from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers.scheduler import router
from nion.config.paths import Paths
from nion.scheduler.mode_registry import register_mode_executor
from nion.scheduler.models import ScheduledTask
from nion.scheduler.service import get_scheduler, shutdown_scheduler


class _StubEvolutionService:
    async def run(self, agent_name: str = "_default"):
        from app.evolution.models import EvolutionReport, ReportStatus

        return EvolutionReport(
            status=ReportStatus.COMPLETED,
            duration_seconds=0,
            summary="ok",
        )


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_scheduler_filters_out_evolution_system_tasks(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with patch("app.evolution.service.get_evolution_service", return_value=_StubEvolutionService()):
            async def _evolution_executor(task, trace_id):
                from app.evolution.service import get_evolution_service

                report = await asyncio.wait_for(
                    get_evolution_service().run(task.agent_name),
                    timeout=task.timeout_seconds,
                )
                payload = report.model_dump(mode="json") if hasattr(report, "model_dump") else report
                return {
                    "success": True,
                    "mode": task.mode.value,
                    "evolution": payload,
                    "trace_id": trace_id,
                    "triggered_at": datetime.now(UTC).isoformat(),
                }

            register_mode_executor("evolution", _evolution_executor)

            with TestClient(app) as client:
                scheduler = get_scheduler()
                scheduler.start()
                try:
                    # NOTE: mode uses raw string on purpose. This should fail before implementation.
                    task = ScheduledTask.model_validate(
                        {
                            "agent_name": "agent-a",
                            "name": "evolution:agent-a:auto_trigger",
                            "description": "Evolution auto trigger",
                            "mode": "evolution",
                            "trigger": {
                                "type": "interval",
                                "interval_seconds": 3600,
                                "timezone": "UTC",
                            },
                            "steps": [],
                            "enabled": True,
                            "created_by": "evolution",
                            "timeout_seconds": 60,
                            "max_concurrent_steps": 1,
                            "created_at": datetime.now(UTC).isoformat(),
                        }
                    )

                    created = scheduler.add_task(task)
                    assert client.post(f"/api/scheduler/tasks/{created.id}/run").status_code == 202

                    # list should not expose evolution system tasks
                    tasks = client.get("/api/scheduler/tasks?agent_name=agent-a").json()
                    assert all(item["id"] != created.id for item in tasks)

                    # wait for history to be recorded and completed
                    history = []
                    for _ in range(200):
                        history = client.get(f"/api/scheduler/tasks/{created.id}/history").json()
                        if history:
                            break
                        time.sleep(0.02)
                    assert history
                    assert history[0]["status"] == "completed"
                finally:
                    shutdown_scheduler()
