"""Persistence helpers for scheduler tasks."""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from src.config.paths import get_paths
from src.scheduler.models import ScheduledTask, TaskExecutionRecord

_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


def _scheduler_dir() -> Path:
    path = get_paths().base_dir / "scheduler"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _tasks_file() -> Path:
    return _scheduler_dir() / "tasks.json"


def _history_file() -> Path:
    return _scheduler_dir() / "history.json"


def _read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(path)


def load_tasks() -> dict[str, ScheduledTask]:
    with _LOCK:
        raw = _read_json(_tasks_file(), {})
    tasks: dict[str, ScheduledTask] = {}
    for task_id, item in raw.items():
        try:
            task = ScheduledTask.model_validate(item)
        except Exception as exc:  # noqa: BLE001
            # Breakable upgrade policy: skip invalid legacy entries, never crash on startup.
            logger.warning("Skip invalid scheduler task %s: %s", task_id, exc)
            continue
        tasks[task_id] = task
    return tasks


def save_tasks(tasks: dict[str, ScheduledTask]) -> None:
    payload = {task_id: task.model_dump(mode="json") for task_id, task in tasks.items()}
    with _LOCK:
        _write_json(_tasks_file(), payload)


def load_history() -> dict[str, list[TaskExecutionRecord]]:
    with _LOCK:
        raw = _read_json(_history_file(), {})
    return {
        task_id: [TaskExecutionRecord.model_validate(item) for item in records]
        for task_id, records in raw.items()
    }


def save_history(history: dict[str, list[TaskExecutionRecord]]) -> None:
    payload = {
        task_id: [record.model_dump(mode="json") for record in records]
        for task_id, records in history.items()
    }
    with _LOCK:
        _write_json(_history_file(), payload)


def append_history(task_id: str, record: TaskExecutionRecord, limit: int = 200) -> None:
    history = load_history()
    records = history.get(task_id, [])
    records.insert(0, record)
    history[task_id] = records[:limit]
    save_history(history)
