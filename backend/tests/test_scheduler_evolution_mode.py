from __future__ import annotations

import time
from datetime import UTC, datetime
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.gateway.routers.scheduler import router
from src.scheduler.models import ScheduledTask
from src.scheduler.service import get_scheduler, shutdown_scheduler


class _StubEvolutionService:
    async def run(self, agent_name: str = "_default"):
        from src.evolution.models import EvolutionReport, ReportStatus

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

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch("src.evolution.service.get_evolution_service", return_value=_StubEvolutionService()):
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

