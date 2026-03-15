"""Scheduler API router."""

from __future__ import annotations

import asyncio
import queue
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.scheduler import store
from src.scheduler.events import SchedulerEvent, get_scheduler_event_hub
from src.scheduler.models import (
    RetryPolicy,
    ScheduledTask,
    TaskExecutionRecord,
    TaskMode,
    TriggerConfig,
    TriggerType,
    WorkflowStep,
)
from src.scheduler.runner import TaskAlreadyRunningError
from src.scheduler.service import get_scheduler

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])

TIME_TRIGGER_TYPES = {TriggerType.CRON, TriggerType.INTERVAL, TriggerType.ONCE}


class CreateTaskRequest(BaseModel):
    """Create task request payload."""

    agent_name: str
    name: str
    description: str | None = None
    mode: TaskMode = TaskMode.WORKFLOW
    trigger: TriggerConfig
    steps: list[WorkflowStep] = Field(default_factory=list)
    reminder_title: str | None = None
    reminder_message: str | None = None
    on_complete: str | None = None
    on_failure: str | None = None
    notification_webhook: str | None = None
    max_concurrent_steps: int = Field(default=3, ge=1, le=10)
    timeout_seconds: int = Field(default=3600, ge=1, le=86_400)
    retry_policy: RetryPolicy | None = None
    enabled: bool = True
    created_by: str = "user"


class UpdateTaskRequest(BaseModel):
    """Update task request payload."""

    agent_name: str
    name: str
    description: str | None = None
    mode: TaskMode = TaskMode.WORKFLOW
    trigger: TriggerConfig
    steps: list[WorkflowStep] = Field(default_factory=list)
    reminder_title: str | None = None
    reminder_message: str | None = None
    on_complete: str | None = None
    on_failure: str | None = None
    notification_webhook: str | None = None
    max_concurrent_steps: int = Field(default=3, ge=1, le=10)
    timeout_seconds: int = Field(default=3600, ge=1, le=86_400)
    retry_policy: RetryPolicy | None = None
    enabled: bool = True


class DispatchEventRequest(BaseModel):
    """Event dispatch payload for event-triggered tasks."""

    event_type: str
    payload: dict | None = None


class SchedulerDashboardAgentRow(BaseModel):
    agent_name: str
    task_count: int
    success_rate_24h: float
    failed_runs_24h: int


class SchedulerDashboardResponse(BaseModel):
    agent_count_with_tasks: int
    task_count: int
    success_rate_24h: float
    failed_task_count_24h: int
    agents: list[SchedulerDashboardAgentRow]


def _scheduler_started():
    scheduler = get_scheduler()
    scheduler.start()
    return scheduler


def _is_system_task(task: ScheduledTask) -> bool:
    return task.mode in {TaskMode.HEARTBEAT, TaskMode.EVOLUTION} or task.name.startswith("heartbeat:")


def _validate_user_task_contract(*, agent_name: str, mode: TaskMode, trigger: TriggerConfig) -> str:
    resolved_agent_name = agent_name.strip()
    if not resolved_agent_name:
        raise HTTPException(status_code=422, detail="agent_name is required")
    if mode not in {TaskMode.WORKFLOW, TaskMode.REMINDER}:
        raise HTTPException(
            status_code=422,
            detail="Only workflow/reminder modes are supported for user tasks",
        )
    if trigger.type not in TIME_TRIGGER_TYPES:
        raise HTTPException(status_code=422, detail="Only time triggers (cron/interval/once) are supported")
    return resolved_agent_name


def _validate_workflow_steps_agent_binding(agent_name: str, steps: list[WorkflowStep]) -> None:
    for step in steps:
        for agent in step.agents:
            if agent.agent_name != agent_name:
                raise HTTPException(
                    status_code=422,
                    detail=f"All workflow agents must match task agent_name ({agent_name})",
                )


@router.get("/tasks", response_model=list[ScheduledTask])
async def list_tasks(agent_name: str | None = None) -> list[ScheduledTask]:
    scheduler = _scheduler_started()
    tasks = [task for task in scheduler.list_tasks() if not _is_system_task(task)]
    if agent_name is not None:
        tasks = [task for task in tasks if task.agent_name == agent_name]
    return tasks


@router.get("/dashboard", response_model=SchedulerDashboardResponse)
async def get_dashboard() -> SchedulerDashboardResponse:
    scheduler = _scheduler_started()
    tasks = [task for task in scheduler.list_tasks() if not _is_system_task(task)]
    task_map = {task.id: task for task in tasks}

    per_agent: dict[str, dict[str, int]] = {}
    for task in tasks:
        bucket = per_agent.setdefault(
            task.agent_name,
            {"task_count": 0, "runs_total": 0, "runs_success": 0, "runs_failed": 0},
        )
        bucket["task_count"] += 1

    since = datetime.now(UTC) - timedelta(hours=24)
    failed_task_ids: set[str] = set()
    total_runs = 0
    success_runs = 0

    for task_id, records in store.load_history().items():
        task = task_map.get(task_id)
        if task is None:
            continue
        bucket = per_agent.setdefault(
            task.agent_name,
            {"task_count": 0, "runs_total": 0, "runs_success": 0, "runs_failed": 0},
        )
        for record in records:
            if record.started_at < since:
                continue
            total_runs += 1
            bucket["runs_total"] += 1
            if record.success:
                success_runs += 1
                bucket["runs_success"] += 1
            else:
                bucket["runs_failed"] += 1
                failed_task_ids.add(task_id)

    agents = [
        SchedulerDashboardAgentRow(
            agent_name=agent_name,
            task_count=bucket["task_count"],
            success_rate_24h=(bucket["runs_success"] / bucket["runs_total"]) if bucket["runs_total"] else 0.0,
            failed_runs_24h=bucket["runs_failed"],
        )
        for agent_name, bucket in sorted(per_agent.items(), key=lambda item: item[0])
        if bucket["task_count"] > 0
    ]

    return SchedulerDashboardResponse(
        agent_count_with_tasks=len(agents),
        task_count=len(tasks),
        success_rate_24h=(success_runs / total_runs) if total_runs else 0.0,
        failed_task_count_24h=len(failed_task_ids),
        agents=agents,
    )


@router.post("/tasks", response_model=ScheduledTask, status_code=201)
async def create_task(req: CreateTaskRequest) -> ScheduledTask:
    scheduler = _scheduler_started()
    agent_name = _validate_user_task_contract(agent_name=req.agent_name, mode=req.mode, trigger=req.trigger)
    _validate_workflow_steps_agent_binding(agent_name, req.steps)

    task = ScheduledTask(
        agent_name=agent_name,
        name=req.name,
        description=req.description,
        mode=req.mode,
        trigger=req.trigger,
        steps=req.steps,
        reminder_title=req.reminder_title,
        reminder_message=req.reminder_message,
        on_complete=req.on_complete,
        on_failure=req.on_failure,
        notification_webhook=req.notification_webhook,
        max_concurrent_steps=req.max_concurrent_steps,
        timeout_seconds=req.timeout_seconds,
        retry_policy=req.retry_policy,
        enabled=req.enabled,
        created_by=req.created_by,
        created_at=datetime.now(UTC),
    )

    try:
        return scheduler.add_task(task)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/tasks/{task_id}", response_model=ScheduledTask)
async def get_task(task_id: str) -> ScheduledTask:
    scheduler = _scheduler_started()
    task = scheduler.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return task


@router.put("/tasks/{task_id}", response_model=ScheduledTask)
async def update_task(task_id: str, req: UpdateTaskRequest) -> ScheduledTask:
    scheduler = _scheduler_started()
    current = scheduler.get_task(task_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    agent_name = _validate_user_task_contract(agent_name=req.agent_name, mode=req.mode, trigger=req.trigger)
    if current.agent_name != agent_name:
        raise HTTPException(status_code=409, detail="agent_name cannot be changed")
    _validate_workflow_steps_agent_binding(agent_name, req.steps)

    updated = ScheduledTask(
        id=current.id,
        agent_name=current.agent_name,
        name=req.name,
        description=req.description,
        mode=req.mode,
        trigger=req.trigger,
        steps=req.steps,
        reminder_title=req.reminder_title,
        reminder_message=req.reminder_message,
        on_complete=req.on_complete,
        on_failure=req.on_failure,
        notification_webhook=req.notification_webhook,
        max_concurrent_steps=req.max_concurrent_steps,
        timeout_seconds=req.timeout_seconds,
        retry_policy=req.retry_policy,
        enabled=req.enabled,
        created_by=current.created_by,
        created_at=current.created_at,
        last_run_at=current.last_run_at,
        next_run_at=current.next_run_at,
        status=current.status,
        last_result=current.last_result,
        last_error=current.last_error,
    )

    try:
        return scheduler.update_task(task_id, updated)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str) -> Response:
    scheduler = _scheduler_started()
    deleted = scheduler.remove_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return Response(status_code=204)


@router.post("/tasks/{task_id}/run", status_code=202)
async def run_task_now(task_id: str) -> dict:
    scheduler = _scheduler_started()
    try:
        result = scheduler.run_task_now(task_id)
        return {
            "task_id": task_id,
            "run_id": result.run_id,
            "status": result.status.value,
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    except TaskAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/tasks/{task_id}/history", response_model=list[TaskExecutionRecord])
async def get_task_history(task_id: str) -> list[TaskExecutionRecord]:
    scheduler = _scheduler_started()
    if scheduler.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return scheduler.list_history(task_id)


@router.get("/events", summary="Subscribe scheduler events (SSE)")
async def stream_scheduler_events(request: Request) -> StreamingResponse:
    """Stream scheduler events via Server-Sent Events (SSE)."""
    scheduler = _scheduler_started()
    hub = get_scheduler_event_hub()
    q = hub.subscribe()

    tasks = [task for task in scheduler.list_tasks() if not _is_system_task(task)]
    snapshot = SchedulerEvent(
        type="snapshot",
        data={
            "timestamp": datetime.now(UTC).isoformat(),
            "tasks": [task.model_dump(mode="json") for task in tasks],
        },
    ).to_sse()

    async def event_stream():
        try:
            yield SchedulerEvent(type="ready", data={"timestamp": datetime.now(UTC).isoformat()}).to_sse()
            yield snapshot
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.to_thread(q.get, True, 20.0)
                    yield event.to_sse()
                except queue.Empty:
                    yield SchedulerEvent(type="heartbeat", data={"timestamp": datetime.now(UTC).isoformat()}).to_sse()
        finally:
            hub.unsubscribe(q)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


@router.post("/events")
async def dispatch_event(req: DispatchEventRequest) -> dict:
    scheduler = _scheduler_started()
    task_ids = scheduler.dispatch_event(req.event_type, req.payload)
    return {
        "event_type": req.event_type,
        "started_task_ids": task_ids,
        "count": len(task_ids),
    }


@router.post("/tasks/{task_id}/webhook", status_code=202)
async def trigger_task_webhook(
    task_id: str,
    request: Request,
    x_nion_webhook_secret: Annotated[str | None, Header(alias="X-Nion-Webhook-Secret")] = None,
) -> dict:
    scheduler = _scheduler_started()

    payload: dict | None
    try:
        parsed = await request.json()
        payload = parsed if isinstance(parsed, dict) else {"_raw": parsed}
    except Exception:
        payload = None

    try:
        result = scheduler.trigger_webhook(
            task_id,
            payload=payload,
            secret=x_nion_webhook_secret,
        )
        return {
            "task_id": task_id,
            "run_id": result.run_id,
            "status": result.status.value,
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc))
