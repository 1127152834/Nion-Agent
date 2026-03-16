"""Scheduler singleton service."""

from __future__ import annotations

import threading

from nion.scheduler.runner import TaskScheduler

_LOCK = threading.Lock()
_scheduler: TaskScheduler | None = None


def get_scheduler() -> TaskScheduler:
    global _scheduler
    with _LOCK:
        if _scheduler is None:
            _scheduler = TaskScheduler()
    return _scheduler


def startup_scheduler() -> None:
    scheduler = get_scheduler()
    scheduler.start()


def shutdown_scheduler() -> None:
    global _scheduler
    with _LOCK:
        if _scheduler is not None:
            _scheduler.shutdown()
            _scheduler = None
