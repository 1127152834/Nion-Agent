from __future__ import annotations

import time
from unittest.mock import patch

from src.config.paths import Paths
from src.evolution.models import EvolutionSettings
from src.evolution.service import EvolutionService
from src.scheduler import store as scheduler_store
from src.scheduler.service import get_scheduler, shutdown_scheduler


class _StubEvolutionService:
    async def run(self, agent_name: str = "_default"):
        from src.evolution.models import EvolutionReport, ReportStatus

        return EvolutionReport(status=ReportStatus.COMPLETED, duration_seconds=0, summary="ok")


def test_evolution_auto_trigger_creates_system_task_and_runs_once(tmp_path):
    paths = Paths(base_dir=tmp_path)

    with patch("src.scheduler.store.get_paths", return_value=paths):
        with patch("src.evolution.store.get_paths", return_value=paths):
            with patch("src.evolution.service.get_evolution_service", return_value=_StubEvolutionService()):
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

