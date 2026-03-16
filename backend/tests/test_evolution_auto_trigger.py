from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

from nion.config.paths import Paths
from app.evolution.models import EvolutionSettings
from app.evolution.service import EvolutionService
from nion.scheduler import store as scheduler_store
from nion.scheduler.mode_registry import register_mode_executor
from nion.scheduler.service import get_scheduler, shutdown_scheduler


class _StubEvolutionService:
    async def run(self, agent_name: str = "_default"):
        from app.evolution.models import EvolutionReport, ReportStatus

        return EvolutionReport(status=ReportStatus.COMPLETED, duration_seconds=0, summary="ok")


def test_evolution_auto_trigger_creates_system_task_and_runs_once(tmp_path):
    paths = Paths(base_dir=tmp_path)

    with patch("nion.scheduler.store.get_paths", return_value=paths):
        with patch("app.evolution.store.get_paths", return_value=paths):
            with patch("app.evolution.service.get_evolution_service", return_value=_StubEvolutionService()):
                async def _evolution_executor(task, trace_id):
                    from datetime import UTC, datetime

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

                scheduler = get_scheduler()
                scheduler.start()
                try:
                    service = EvolutionService()

                    settings = EvolutionSettings(enabled=True, interval_hours=24, auto_trigger=True)
                    service.update_settings(settings, agent_name="agent-a")

                    tasks = scheduler.list_tasks()
                    evo_tasks = [t for t in tasks if t.name == "evolution:agent-a:auto_trigger"]
                    assert len(evo_tasks) == 1
                    evo_task = evo_tasks[0]
                    assert evo_task.mode.value == "evolution"

                    history = []
                    for _ in range(200):
                        history = scheduler_store.load_history().get(evo_task.id, [])
                        if history:
                            break
                        time.sleep(0.02)
                    assert history
                    assert history[0].status.value == "completed"
                    assert history[0].success is True
                finally:
                    shutdown_scheduler()
