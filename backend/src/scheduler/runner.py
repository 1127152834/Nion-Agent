"""Task scheduler runtime."""

from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.scheduler import store
from src.scheduler.models import ScheduledTask, TaskExecutionRecord, TaskMode, TaskStatus, TriggerType

if TYPE_CHECKING:
    from src.scheduler.workflow import WorkflowExecutor

logger = logging.getLogger(__name__)


class TaskScheduler:
    """Scheduler service managing task lifecycle and execution."""

    def __init__(self):
        self._scheduler = BackgroundScheduler(timezone=UTC)
        self._execution_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scheduler-task-")
        self._workflow_executor: WorkflowExecutor | None = None
        self._lock = threading.RLock()
        self._tasks: dict[str, ScheduledTask] = {}
        self._started = False

    def _get_workflow_executor(self) -> WorkflowExecutor:
        if self._workflow_executor is not None:
            return self._workflow_executor
        from src.scheduler.workflow import WorkflowExecutor

        self._workflow_executor = WorkflowExecutor()
        return self._workflow_executor

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self._tasks = store.load_tasks()
            self._scheduler.start()
            for task in self._tasks.values():
                self._schedule_task(task)
            store.save_tasks(self._tasks)
            self._started = True

    def shutdown(self) -> None:
        with self._lock:
            if not self._started:
                return
            self._scheduler.shutdown(wait=False)
            self._execution_pool.shutdown(wait=False, cancel_futures=True)
            self._started = False

    def list_tasks(self) -> list[ScheduledTask]:
        with self._lock:
            return sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)

    def get_task(self, task_id: str) -> ScheduledTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def add_task(self, task: ScheduledTask) -> ScheduledTask:
        with self._lock:
            if task.id in self._tasks:
                raise ValueError(f"Task already exists: {task.id}")
            self._tasks[task.id] = task
            self._schedule_task(task)
            store.save_tasks(self._tasks)
            return task

    def update_task(self, task_id: str, updated: ScheduledTask) -> ScheduledTask:
        with self._lock:
            current = self._tasks.get(task_id)
            if current is None:
                raise KeyError(task_id)

            updated.id = task_id
            updated.created_at = current.created_at
            updated.created_by = current.created_by

            self._unschedule_task(task_id)
            self._tasks[task_id] = updated
            self._schedule_task(updated)
            store.save_tasks(self._tasks)
            return updated

    def remove_task(self, task_id: str) -> bool:
        with self._lock:
            if task_id not in self._tasks:
                return False
            self._unschedule_task(task_id)
            del self._tasks[task_id]
            store.save_tasks(self._tasks)
            return True

    def list_history(self, task_id: str) -> list[TaskExecutionRecord]:
        history = store.load_history()
        return history.get(task_id, [])

    def run_task_now(self, task_id: str) -> TaskExecutionRecord:
        task = self.get_task(task_id)
        if task is None:
            raise KeyError(task_id)

        future = self._execution_pool.submit(self._execute_task, task_id, True)
        try:
            return future.result(timeout=task.timeout_seconds + 10)
        except FuturesTimeoutError as exc:
            raise TimeoutError(f"Task {task_id} timed out while waiting for immediate execution") from exc

    def dispatch_event(self, event_type: str, payload: dict[str, Any] | None = None) -> list[str]:
        payload = payload or {}
        started_task_ids: list[str] = []

        with self._lock:
            targets = [
                task
                for task in self._tasks.values()
                if task.enabled
                and task.trigger.type == TriggerType.EVENT
                and task.trigger.event_type == event_type
                and self._match_event_filters(task.trigger.event_filters, payload)
            ]

        for task in targets:
            self._execution_pool.submit(self._execute_task, task.id, True)
            started_task_ids.append(task.id)

        return started_task_ids

    def trigger_webhook(
        self,
        task_id: str,
        *,
        payload: dict[str, Any] | None = None,
        secret: str | None = None,
    ) -> TaskExecutionRecord:
        payload = payload or {}
        task = self.get_task(task_id)
        if task is None:
            raise KeyError(task_id)
        if task.trigger.type != TriggerType.WEBHOOK:
            raise ValueError(f"Task {task_id} is not configured with webhook trigger")
        if task.trigger.webhook_secret and task.trigger.webhook_secret != secret:
            raise PermissionError("Invalid webhook secret")
        if not self._match_event_filters(task.trigger.event_filters, payload):
            raise ValueError("Webhook payload does not match event_filters")

        return self.run_task_now(task_id)

    def _match_event_filters(self, filters: dict[str, Any] | None, payload: dict[str, Any]) -> bool:
        if not filters:
            return True
        for key, expected in filters.items():
            if payload.get(key) != expected:
                return False
        return True

    def _schedule_task(self, task: ScheduledTask) -> None:
        self._unschedule_task(task.id)

        if not task.enabled:
            task.next_run_at = None
            return

        trigger = None
        trigger_timezone = ZoneInfo(task.trigger.timezone or "UTC")
        if task.trigger.type == TriggerType.CRON:
            trigger = CronTrigger.from_crontab(task.trigger.cron_expression or "", timezone=trigger_timezone)
        elif task.trigger.type == TriggerType.INTERVAL:
            trigger = IntervalTrigger(seconds=task.trigger.interval_seconds, timezone=trigger_timezone)
        elif task.trigger.type == TriggerType.ONCE:
            run_date = task.trigger.scheduled_time
            if run_date and run_date.tzinfo is None:
                run_date = run_date.replace(tzinfo=trigger_timezone).astimezone(UTC)
            trigger = DateTrigger(run_date=run_date, timezone=trigger_timezone)
        elif task.trigger.type in {TriggerType.EVENT, TriggerType.WEBHOOK}:
            task.next_run_at = None
            return

        self._scheduler.add_job(
            self._execute_task_job,
            trigger=trigger,
            args=[task.id],
            id=task.id,
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        job = self._scheduler.get_job(task.id)
        task.next_run_at = job.next_run_time if job else None

    def _unschedule_task(self, task_id: str) -> None:
        job = self._scheduler.get_job(task_id)
        if job is not None:
            self._scheduler.remove_job(task_id)

    def _execute_task_job(self, task_id: str) -> None:
        self._execute_task(task_id, manual=False)

    def _execute_task(self, task_id: str, manual: bool = False) -> TaskExecutionRecord:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                raise KeyError(task_id)
            if not task.enabled and not manual:
                return TaskExecutionRecord(
                    task_id=task_id,
                    started_at=datetime.now(UTC),
                    completed_at=datetime.now(UTC),
                    status=TaskStatus.CANCELLED,
                    success=False,
                    error="Task disabled",
                )

            task.status = TaskStatus.RUNNING
            task.last_run_at = datetime.now(UTC)
            task.last_error = None
            store.save_tasks(self._tasks)

        record = TaskExecutionRecord(
            task_id=task_id,
            started_at=task.last_run_at or datetime.now(UTC),
            status=TaskStatus.RUNNING,
            success=False,
        )

        try:
            result = self._execute_workflow(task)
            success = bool(result.get("success"))
            with self._lock:
                if success:
                    task.status = TaskStatus.COMPLETED
                    task.last_result = result
                    task.last_error = None
                else:
                    task.status = TaskStatus.FAILED
                    task.last_result = result
                    task.last_error = result.get("error", "workflow failed")

                self._refresh_next_run(task)
                store.save_tasks(self._tasks)

            record.status = task.status
            record.success = success
            record.result = result
            record.error = None if success else task.last_error

            if success and task.on_complete:
                self._send_webhook(task.on_complete, {"task_id": task.id, "event": "completed", "result": result})
            if (not success) and task.on_failure:
                self._send_webhook(task.on_failure, {"task_id": task.id, "event": "failed", "result": result})

        except Exception as exc:  # noqa: PERF203
            logger.exception("Failed to execute task %s", task_id)
            with self._lock:
                task.status = TaskStatus.FAILED
                task.last_error = str(exc)
                self._refresh_next_run(task)
                store.save_tasks(self._tasks)

            record.status = TaskStatus.FAILED
            record.success = False
            record.error = str(exc)

            if task.on_failure:
                self._send_webhook(task.on_failure, {"task_id": task.id, "event": "failed", "error": str(exc)})

        record.completed_at = datetime.now(UTC)
        store.append_history(task_id, record)

        if task.notification_webhook:
            self._send_webhook(
                task.notification_webhook,
                {
                    "task_id": task.id,
                    "event": "status",
                    "status": record.status.value,
                    "success": record.success,
                    "error": record.error,
                },
            )

        return record

    def _refresh_next_run(self, task: ScheduledTask) -> None:
        if task.trigger.type in {TriggerType.EVENT, TriggerType.WEBHOOK}:
            task.next_run_at = None
            return
        job = self._scheduler.get_job(task.id)
        task.next_run_at = job.next_run_time if job else None

    def _execute_workflow(self, task: ScheduledTask) -> dict[str, Any]:
        if task.mode == TaskMode.REMINDER:
            reminder = {
                "title": task.reminder_title or task.name,
                "message": task.reminder_message or task.description or task.name,
            }
            return {
                "success": True,
                "mode": task.mode.value,
                "reminder": reminder,
                "triggered_at": datetime.now(UTC).isoformat(),
            }

        workflow_executor = self._get_workflow_executor()
        return asyncio.run(
            asyncio.wait_for(
                workflow_executor.execute(task_id=task.id, steps=task.steps),
                timeout=task.timeout_seconds,
            )
        )

    def _send_webhook(self, url: str, payload: dict[str, Any]) -> None:
        try:
            httpx.post(url, json=payload, timeout=10.0)
        except Exception:
            logger.warning("Failed to send webhook to %s", url, exc_info=True)
