"""Scheduler package."""

from __future__ import annotations

from src.scheduler.models import (
    AgentStep,
    CompletionCriteria,
    CompletionCriteriaType,
    RetryPolicy,
    ScheduledTask,
    TaskExecutionRecord,
    TaskMode,
    TaskStatus,
    TriggerConfig,
    TriggerType,
    WorkflowStep,
)

__all__ = [
    "AgentStep",
    "CompletionCriteria",
    "CompletionCriteriaType",
    "RetryPolicy",
    "ScheduledTask",
    "TaskExecutionRecord",
    "TaskMode",
    "TaskScheduler",
    "TaskStatus",
    "TriggerConfig",
    "TriggerType",
    "WorkflowStep",
    "get_scheduler",
    "shutdown_scheduler",
    "startup_scheduler",
]


def get_scheduler():
    from src.scheduler.service import get_scheduler as _get_scheduler

    return _get_scheduler()


def startup_scheduler() -> None:
    from src.scheduler.service import startup_scheduler as _startup_scheduler

    _startup_scheduler()


def shutdown_scheduler() -> None:
    from src.scheduler.service import shutdown_scheduler as _shutdown_scheduler

    _shutdown_scheduler()


def __getattr__(name: str):
    if name != "TaskScheduler":
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    from src.scheduler.runner import TaskScheduler as _TaskScheduler

    globals()["TaskScheduler"] = _TaskScheduler
    return _TaskScheduler
