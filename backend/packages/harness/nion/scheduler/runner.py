"""Task scheduler runtime."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

from nion.processlog.service import get_processlog_service
from nion.scheduler import store
from nion.scheduler.events import SchedulerEvent, get_scheduler_event_hub
from nion.scheduler.models import ScheduledTask, TaskExecutionRecord, TaskMode, TaskStatus, TriggerType

if TYPE_CHECKING:
    from nion.scheduler.workflow import WorkflowExecutor

logger = logging.getLogger(__name__)


class TaskAlreadyRunningError(RuntimeError):
    """Task is already running."""


class TaskScheduler:
    """Scheduler service managing task lifecycle and execution."""

    def __init__(self):
        self._scheduler = BackgroundScheduler(timezone=UTC)
        self._execution_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scheduler-task-")
        self._workflow_executor: WorkflowExecutor | None = None
        self._lock = threading.RLock()
        self._tasks: dict[str, ScheduledTask] = {}
        self._started = False
        self._events = get_scheduler_event_hub()

    def _should_emit_task_event(self, task: ScheduledTask | None) -> bool:
        if task is None:
            return False
        return task.mode not in {TaskMode.HEARTBEAT, TaskMode.EVOLUTION}

    def _publish_event(self, event_type: str, data: dict[str, Any]) -> None:
        try:
            self._events.publish(SchedulerEvent(type=event_type, data=data))
        except Exception:  # noqa: BLE001 - events are best-effort and must not break scheduler
            logger.debug("Failed to publish scheduler event: %s", event_type, exc_info=True)

    def _should_generate_enhanced_execution_log(self) -> bool:
        if os.getenv("PYTEST_CURRENT_TEST"):
            return False
        raw = (os.getenv("NION_SCHEDULER_ENHANCED_EXECUTION_LOG") or "true").strip().lower()
        return raw not in {"0", "false", "no", "off"}

    def _update_history_execution_log(self, task_id: str, run_id: str, execution_log: str) -> bool:
        history = store.load_history()
        records = history.get(task_id) or []
        updated = False
        for idx, record in enumerate(records):
            if record.run_id != run_id:
                continue
            result = record.result if isinstance(record.result, dict) else {}
            result["execution_log"] = execution_log
            record.result = result
            records[idx] = record
            updated = True
            break
        if not updated:
            return False
        history[task_id] = records
        store.save_history(history)
        return True

    def _enqueue_enhanced_execution_log(self, task: ScheduledTask, record: TaskExecutionRecord) -> None:
        if not self._should_generate_enhanced_execution_log():
            return
        if task.mode != TaskMode.WORKFLOW or not record.thread_id:
            return
        if not self._should_emit_task_event(task):
            return

        task_snapshot = task.model_copy(deep=True)
        record_snapshot = record.model_copy(deep=True)

        def worker() -> None:
            try:
                execution_log = self._generate_execution_log(task_snapshot, record_snapshot)
                if not execution_log.strip():
                    return
                if not self._update_history_execution_log(task_snapshot.id, record_snapshot.run_id, execution_log):
                    return
                self._publish_event(
                    "task_run_log_updated",
                    {"task_id": task_snapshot.id, "run_id": record_snapshot.run_id},
                )
            except Exception:  # noqa: BLE001
                logger.debug(
                    "Failed to generate enhanced execution_log for task %s run %s",
                    task_snapshot.id,
                    record_snapshot.run_id,
                    exc_info=True,
                )

        self._execution_pool.submit(worker)

    def _get_workflow_executor(self) -> WorkflowExecutor:
        if self._workflow_executor is not None:
            return self._workflow_executor
        from nion.scheduler.workflow import WorkflowExecutor

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
            task_payload = task.model_dump(mode="json")
        if self._should_emit_task_event(task):
            self._publish_event("task_upserted", {"reason": "created", "task": task_payload})
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
            task_payload = updated.model_dump(mode="json")
        if self._should_emit_task_event(updated):
            self._publish_event("task_upserted", {"reason": "updated", "task": task_payload})
        return updated

    def remove_task(self, task_id: str) -> bool:
        with self._lock:
            if task_id not in self._tasks:
                return False
            task = self._tasks.get(task_id)
            self._unschedule_task(task_id)
            del self._tasks[task_id]
            store.save_tasks(self._tasks)
            agent_name = task.agent_name if task is not None else None
        if self._should_emit_task_event(task):
            self._publish_event("task_deleted", {"task_id": task_id, "agent_name": agent_name})
        return True

    def list_history(self, task_id: str) -> list[TaskExecutionRecord]:
        history = store.load_history()
        return history.get(task_id, [])

    def run_task_now(self, task_id: str) -> TaskExecutionRecord:
        """Enqueue a task run and return immediately.

        The run will execute in the scheduler background pool. Frontend should
        observe status changes via SSE `/api/scheduler/events`.
        """
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                raise KeyError(task_id)
            if task.status == TaskStatus.RUNNING:
                raise TaskAlreadyRunningError(f"Task {task_id} is already running")

            started_at = datetime.now(UTC)
            run_id = uuid.uuid4().hex[:12]
            trace_id = run_id
            thread_id = f"scheduler-{task_id}-{run_id}" if task.mode == TaskMode.WORKFLOW else None

            # Persist "running" first so UI can reflect the start without waiting for
            # the worker thread to be scheduled.
            task.status = TaskStatus.RUNNING
            task.last_run_at = started_at
            task.last_error = None
            store.save_tasks(self._tasks)

            record = TaskExecutionRecord(
                run_id=run_id,
                trace_id=trace_id,
                thread_id=thread_id,
                task_id=task_id,
                started_at=started_at,
                status=TaskStatus.RUNNING,
                success=False,
            )
            task_payload = task.model_dump(mode="json")
            record_payload = record.model_dump(mode="json")

        if self._should_emit_task_event(task):
            self._publish_event(
                "task_run_started",
                {
                    "task_id": task_id,
                    "agent_name": task_payload.get("agent_name"),
                    "task": task_payload,
                    "record": record_payload,
                },
            )
        self._execution_pool.submit(self._execute_task, task_id, True, record)
        return record

    def dispatch_event(self, event_type: str, payload: dict[str, Any] | None = None) -> list[str]:
        payload = payload or {}
        started_task_ids: list[str] = []

        with self._lock:
            targets = [task for task in self._tasks.values() if task.enabled and task.trigger.type == TriggerType.EVENT and task.trigger.event_type == event_type and self._match_event_filters(task.trigger.event_filters, payload)]

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

    def _execute_task(
        self,
        task_id: str,
        manual: bool = False,
        record: TaskExecutionRecord | None = None,
    ) -> TaskExecutionRecord:
        caller_provided_record = record is not None
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                raise KeyError(task_id)
            # Avoid overlapping runs of the same task (e.g. scheduled fire while a manual run is in-flight).
            if record is None and task.status == TaskStatus.RUNNING:
                run_id = uuid.uuid4().hex[:12]
                now = datetime.now(UTC)
                return TaskExecutionRecord(
                    run_id=run_id,
                    trace_id=run_id,
                    task_id=task_id,
                    started_at=now,
                    completed_at=now,
                    status=TaskStatus.CANCELLED,
                    success=False,
                    error="Task already running",
                )
            if not task.enabled and not manual:
                run_id = uuid.uuid4().hex[:12]
                return TaskExecutionRecord(
                    run_id=run_id,
                    trace_id=run_id,
                    task_id=task_id,
                    started_at=datetime.now(UTC),
                    completed_at=datetime.now(UTC),
                    status=TaskStatus.CANCELLED,
                    success=False,
                    error="Task disabled",
                )

            if record is None:
                started_at = datetime.now(UTC)
                run_id = uuid.uuid4().hex[:12]
                trace_id = run_id
                thread_id = f"scheduler-{task_id}-{run_id}" if task.mode == TaskMode.WORKFLOW else None
                record = TaskExecutionRecord(
                    run_id=run_id,
                    trace_id=trace_id,
                    thread_id=thread_id,
                    task_id=task_id,
                    started_at=started_at,
                    status=TaskStatus.RUNNING,
                    success=False,
                )
            else:
                # Normalize ids in case callers didn't set them (best-effort).
                if not record.trace_id:
                    record.trace_id = record.run_id
                if not record.started_at:
                    record.started_at = datetime.now(UTC)
                if task.mode == TaskMode.WORKFLOW and not record.thread_id:
                    record.thread_id = f"scheduler-{task_id}-{record.run_id}"
                record.status = TaskStatus.RUNNING
                record.success = False

            task.status = TaskStatus.RUNNING
            task.last_run_at = record.started_at
            task.last_error = None
            store.save_tasks(self._tasks)
            task_payload = task.model_dump(mode="json")
            record_payload = record.model_dump(mode="json")

        if (not caller_provided_record) and self._should_emit_task_event(task):
            self._publish_event(
                "task_run_started",
                {
                    "task_id": task_id,
                    "agent_name": task_payload.get("agent_name"),
                    "task": task_payload,
                    "record": record_payload,
                },
            )

        run_id = record.run_id
        trace_id = record.trace_id or record.run_id
        thread_id = record.thread_id

        processlog = get_processlog_service()
        processlog.record(
            trace_id=trace_id,
            chat_id=thread_id,
            step="SchedulerTaskStart",
            level="info",
            data={
                "task_id": task_id,
                "run_id": run_id,
                "mode": task.mode.value,
                "manual": manual,
                "agent_name": task.agent_name,
                "trigger_type": task.trigger.type.value,
            },
        )

        try:
            retry_policy = task.retry_policy
            max_attempts = retry_policy.max_attempts if retry_policy else 1
            backoff = retry_policy.backoff if retry_policy else "none"

            attempts: list[dict[str, Any]] = []
            result: dict[str, Any] = {"success": False}
            success = False

            for attempt in range(max(1, int(max_attempts))):
                attempt_started_at = datetime.now(UTC)
                attempt_result: dict[str, Any]
                try:
                    attempt_result = self._execute_workflow(
                        task,
                        trace_id=trace_id,
                        thread_id=thread_id,
                    )
                except Exception as exc:  # noqa: PERF203
                    logger.exception(
                        "Task %s attempt %s failed",
                        task_id,
                        attempt + 1,
                    )
                    attempt_result = {
                        "success": False,
                        "error": str(exc),
                        "exception": exc.__class__.__name__,
                    }

                attempt_completed_at = datetime.now(UTC)
                attempt_success = bool(attempt_result.get("success"))
                attempt_error = None if attempt_success else str(attempt_result.get("error") or "workflow failed")
                attempts.append(
                    {
                        "attempt": attempt + 1,
                        "success": attempt_success,
                        "error": attempt_error,
                        "started_at": attempt_started_at.isoformat(),
                        "completed_at": attempt_completed_at.isoformat(),
                        "duration_ms": int((attempt_completed_at - attempt_started_at).total_seconds() * 1000),
                    }
                )

                result = attempt_result if isinstance(attempt_result, dict) else {"success": False}
                success = attempt_success
                if attempt_success:
                    break

                if attempt < int(max_attempts) - 1:
                    sleep_seconds = 0.0
                    if backoff == "linear":
                        sleep_seconds = min(60.0, 5.0 * (attempt + 1))
                    elif backoff == "exponential":
                        sleep_seconds = min(60.0, 5.0 * (2**attempt))

                    if sleep_seconds > 0:
                        time.sleep(sleep_seconds)

            if isinstance(result, dict):
                result.setdefault("trace_id", trace_id)
                if thread_id:
                    result.setdefault("thread_id", thread_id)
                if int(max_attempts) > 1:
                    result["retry"] = {
                        "max_attempts": int(max_attempts),
                        "backoff": backoff,
                        "attempts": attempts,
                    }

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
                self._send_webhook(
                    task.on_complete,
                    {
                        "task_id": task.id,
                        "run_id": run_id,
                        "trace_id": trace_id,
                        "thread_id": thread_id,
                        "event": "completed",
                        "result": result,
                    },
                )
            if (not success) and task.on_failure:
                self._send_webhook(
                    task.on_failure,
                    {
                        "task_id": task.id,
                        "run_id": run_id,
                        "trace_id": trace_id,
                        "thread_id": thread_id,
                        "event": "failed",
                        "result": result,
                    },
                )

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
                self._send_webhook(
                    task.on_failure,
                    {
                        "task_id": task.id,
                        "run_id": run_id,
                        "trace_id": trace_id,
                        "thread_id": thread_id,
                        "event": "failed",
                        "error": str(exc),
                    },
                )

        record.completed_at = datetime.now(UTC)

        # Attach a deterministic fallback execution log immediately so history is available
        # without waiting for best-effort LLM summarization.
        try:
            execution_log = self._build_execution_log_fallback(task, record)
            if isinstance(record.result, dict):
                record.result.setdefault("execution_log", execution_log)
            else:
                record.result = {"execution_log": execution_log}
            with self._lock:
                current = self._tasks.get(task_id)
                if current is not None and isinstance(record.result, dict):
                    current.last_result = record.result
                    store.save_tasks(self._tasks)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to attach execution_log fallback for task %s", task_id)

        store.append_history(task_id, record)

        # Generate an enhanced descriptive execution log in background (SSE will notify UI).
        self._enqueue_enhanced_execution_log(task, record)

        if task.notification_webhook:
            artifacts: list[str] = []
            if isinstance(record.result, dict):
                raw_artifacts = record.result.get("artifacts")
                if isinstance(raw_artifacts, list):
                    artifacts = [item for item in raw_artifacts if isinstance(item, str)]
            artifacts_preview = artifacts[:10]
            self._send_webhook(
                task.notification_webhook,
                {
                    "task_id": task.id,
                    "event": "status",
                    "run_id": record.run_id,
                    "trace_id": record.trace_id,
                    "thread_id": record.thread_id,
                    "mode": task.mode.value,
                    "status": record.status.value,
                    "success": record.success,
                    "error": record.error,
                    "artifacts": {
                        "count": len(artifacts),
                        "preview": artifacts_preview,
                    },
                },
            )

        processlog.record(
            trace_id=trace_id,
            chat_id=thread_id,
            step="SchedulerTaskEnd",
            level="info" if record.success else "error",
            duration_ms=int((record.completed_at - record.started_at).total_seconds() * 1000) if record.completed_at else 0,
            data={
                "task_id": task_id,
                "run_id": run_id,
                "status": record.status.value,
                "success": record.success,
                "error": record.error,
            },
        )

        try:
            final_task_payload: dict[str, Any] | None = None
            with self._lock:
                current = self._tasks.get(task_id)
                if current is not None:
                    final_task_payload = current.model_dump(mode="json")

            if self._should_emit_task_event(task):
                self._publish_event(
                    "task_run_finished",
                    {
                        "task_id": task_id,
                        "agent_name": final_task_payload.get("agent_name") if isinstance(final_task_payload, dict) else None,
                        "task": final_task_payload,
                        "record": record.model_dump(mode="json"),
                    },
                )
        except Exception:  # noqa: BLE001 - events are best-effort
            logger.debug("Failed to publish scheduler finished event for task %s", task_id, exc_info=True)

        return record

    def _refresh_next_run(self, task: ScheduledTask) -> None:
        if task.trigger.type in {TriggerType.EVENT, TriggerType.WEBHOOK}:
            task.next_run_at = None
            return

        # One-shot tasks are "consumed" after a successful run (including manual runs
        # before the scheduled time). If they fired at/after scheduled_time (success
        # or failure), disable them to avoid re-running on restart.
        if task.trigger.type == TriggerType.ONCE:
            now = datetime.now(UTC)
            scheduled_time = task.trigger.scheduled_time

            if task.status == TaskStatus.COMPLETED:
                self._unschedule_task(task.id)
                task.next_run_at = None
                task.enabled = False
                return

            if scheduled_time and scheduled_time <= now and task.last_run_at is not None:
                self._unschedule_task(task.id)
                task.next_run_at = None
                task.enabled = False
                return

        job = self._scheduler.get_job(task.id)
        task.next_run_at = job.next_run_time if job else None

    def _excerpt(self, text: str, max_len: int = 400) -> str:
        normalized = (text or "").strip()
        if not normalized:
            return ""
        return normalized if len(normalized) <= max_len else normalized[:max_len] + "..."

    def _extract_workflow_output(self, task: ScheduledTask, result: dict[str, Any]) -> str | None:
        raw_steps = result.get("steps")
        if not isinstance(raw_steps, dict):
            return None

        for step in reversed(task.steps):
            step_id = getattr(step, "id", None)
            if not step_id:
                continue
            raw_step = raw_steps.get(step_id)
            if not isinstance(raw_step, dict):
                continue
            raw_results = raw_step.get("results")
            if not isinstance(raw_results, list) or not raw_results:
                continue
            for item in reversed(raw_results):
                if not isinstance(item, dict):
                    continue
                output = item.get("output")
                if isinstance(output, str) and output.strip():
                    return output
        return None

    def _build_execution_log_fallback(self, task: ScheduledTask, record: TaskExecutionRecord) -> str:
        started_at = record.started_at.isoformat() if record.started_at else "-"
        completed_at = record.completed_at.isoformat() if record.completed_at else "-"
        duration_ms = int((record.completed_at - record.started_at).total_seconds() * 1000) if record.completed_at and record.started_at else 0

        result = record.result if isinstance(record.result, dict) else {}
        artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), list) else []
        artifacts = [item for item in artifacts if isinstance(item, str)]

        lines: list[str] = [
            "## 执行概览",
            f"- 任务：{task.name}",
            f"- 模式：{task.mode.value}",
            f"- 状态：{record.status.value}",
            f"- 开始：{started_at}",
            f"- 结束：{completed_at}",
            f"- 耗时：{duration_ms}ms",
        ]

        if record.thread_id:
            lines.append(f"- 会话：{record.thread_id}")
        if record.trace_id:
            lines.append(f"- trace_id：{record.trace_id}")

        if task.mode == TaskMode.REMINDER:
            reminder = {}
            if isinstance(result.get("reminder"), dict):
                reminder = result.get("reminder") or {}
            title = reminder.get("title") if isinstance(reminder.get("title"), str) else (task.reminder_title or task.name)
            message = reminder.get("message") if isinstance(reminder.get("message"), str) else (task.reminder_message or task.description or task.name)
            lines.extend(
                [
                    "",
                    "## 提醒内容",
                    f"**{title}**",
                    "",
                    (message or "").strip() or "-",
                ]
            )
        elif task.mode == TaskMode.WORKFLOW:
            output = self._extract_workflow_output(task, result) or ""
            if output.strip():
                lines.extend(["", "## 输出摘要", self._excerpt(output, 800)])

        if artifacts:
            lines.append("")
            lines.append("## 产物")
            for path in artifacts[:30]:
                lines.append(f"- {path}")
            if len(artifacts) > 30:
                lines.append(f"- ...（共 {len(artifacts)} 个，仅展示前 30 个）")

        if record.error:
            lines.extend(["", "## 错误", self._excerpt(str(record.error), 800)])

        return "\n".join(lines).strip() + "\n"

    def _generate_execution_log(self, task: ScheduledTask, record: TaskExecutionRecord) -> str:
        """Best-effort descriptive execution log (markdown)."""
        fallback = self._build_execution_log_fallback(task, record)
        if task.mode != TaskMode.WORKFLOW or not record.thread_id:
            return fallback

        duration_ms = int((record.completed_at - record.started_at).total_seconds() * 1000) if record.completed_at and record.started_at else 0
        result = record.result if isinstance(record.result, dict) else {}
        artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), list) else []
        artifacts = [item for item in artifacts if isinstance(item, str)]

        prompt_lines: list[str] = [
            "你刚刚执行了一次定时任务。请生成一份“执行日志/执行报告”（Markdown），必须可读、可复盘。",
            "",
            "要求：",
            "- 只基于本次会话与工具返回的真实内容，不要编造。",
            "- 按顺序列出你做了哪些关键步骤（3-10 条），每条说明做了什么以及目的。",
            "- 列出使用过的工具/外部资源（如果会话里出现过）。",
            "- 产物与位置：列出文件路径/链接/会话 thread_id（如果有）。",
            "- 结尾给出 1-3 条可执行的下一步建议（可选）。",
            "",
            "已知信息（可引用）：",
            f"- task_name: {task.name}",
            f"- task_id: {task.id}",
            f"- agent_name: {task.agent_name}",
            f"- status: {record.status.value}",
            f"- duration_ms: {duration_ms}",
            f"- thread_id: {record.thread_id}",
            f"- trace_id: {record.trace_id}",
        ]
        if artifacts:
            prompt_lines.append(f"- artifacts: {artifacts[:30]}")
        if record.error:
            prompt_lines.append(f"- error: {self._excerpt(str(record.error), 800)}")

        prompt_lines.extend(
            [
                "",
                "注意：不要调用任何工具，不要执行任何操作，只输出日志。",
            ]
        )

        try:
            from nion.client import NionClient

            client = NionClient(
                thinking_enabled=False,
                subagent_enabled=False,
                plan_mode=False,
            )
            report_trace_id = f"{record.trace_id}-log" if record.trace_id else None
            generated = client.chat(
                "\n".join(prompt_lines),
                thread_id=record.thread_id,
                agent_name=task.agent_name,
                trace_id=report_trace_id,
                thinking_enabled=False,
                subagent_enabled=False,
                plan_mode=False,
            )
            generated = (generated or "").strip()
            return generated if generated else fallback
        except Exception:  # noqa: BLE001
            logger.exception("Failed to generate descriptive execution log for task %s", task.id)
            return fallback

    def _execute_workflow(self, task: ScheduledTask, *, trace_id: str, thread_id: str | None) -> dict[str, Any]:
        if task.mode in {TaskMode.EVOLUTION, TaskMode.HEARTBEAT}:
            from nion.scheduler.mode_registry import get_mode_executor

            executor = get_mode_executor(task.mode.value)
            if executor is None:
                raise ValueError(f"No executor registered for mode {task.mode.value}")
            return asyncio.run(executor(task, trace_id))

        if task.mode == TaskMode.REMINDER:
            reminder = {
                "title": task.reminder_title or task.name,
                "message": task.reminder_message or task.description or task.name,
            }
            return {
                "success": True,
                "mode": task.mode.value,
                "reminder": reminder,
                "trace_id": trace_id,
                "triggered_at": datetime.now(UTC).isoformat(),
            }

        workflow_executor = self._get_workflow_executor()
        return asyncio.run(
            asyncio.wait_for(
                workflow_executor.execute(
                    task_id=task.id,
                    steps=task.steps,
                    max_concurrent=task.max_concurrent_steps,
                    trace_id=trace_id,
                    thread_id=thread_id or f"scheduler-{task.id}-{trace_id}",
                ),
                timeout=task.timeout_seconds,
            )
        )

    def _send_webhook(self, url: str, payload: dict[str, Any]) -> None:
        try:
            httpx.post(url, json=payload, timeout=10.0)
        except Exception:
            logger.warning("Failed to send webhook to %s", url, exc_info=True)
