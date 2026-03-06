"""Heartbeat helpers for scheduled memory tasks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass
class HeartbeatTask:
    """One heartbeat task entry."""

    name: str
    enabled: bool = True


class HeartbeatManager:
    """Read and execute heartbeat tasks from workspace config."""

    def __init__(self, workspace_files: Any = None) -> None:
        self.workspace_files = workspace_files

    def get_tasks(self) -> list[HeartbeatTask]:
        """Load heartbeat tasks from workspace HEARTBEAT.md."""
        if self.workspace_files is None or not hasattr(self.workspace_files, "get_heartbeat_config"):
            return []

        config = self.workspace_files.get_heartbeat_config() or {}
        task_names = config.get("tasks", [])
        return [HeartbeatTask(name=str(task_name)) for task_name in task_names]

    def run_once(self, executor: Any) -> list[dict[str, Any]]:
        """Run current heartbeat tasks through an executor callback."""
        reports: list[dict[str, Any]] = []
        for task in self.get_tasks():
            if not task.enabled:
                continue
            result = executor(task.name)
            reports.append(
                {
                    "task": task.name,
                    "ran_at": datetime.now(UTC).isoformat(),
                    "result": result,
                }
            )
        return reports


__all__ = ["HeartbeatTask", "HeartbeatManager"]
