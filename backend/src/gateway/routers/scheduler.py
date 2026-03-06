"""Scheduler API router."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from src.scheduler.models import RetryPolicy, ScheduledTask, TaskExecutionRecord, TaskMode, TriggerConfig, WorkflowStep
from src.scheduler.service import get_scheduler

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


class CreateTaskRequest(BaseModel):
    """Create task request payload."""

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
    created_by: str = "system"


class UpdateTaskRequest(BaseModel):
    """Update task request payload."""

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


class WebhookInvokeRequest(BaseModel):
    """Webhook invoke payload."""

    payload: dict | None = None


def _scheduler_started():
    scheduler = get_scheduler()
    scheduler.start()
    return scheduler


@router.get("/tasks", response_model=list[ScheduledTask])
async def list_tasks() -> list[ScheduledTask]:
    scheduler = _scheduler_started()
    return scheduler.list_tasks()


@router.post("/tasks", response_model=ScheduledTask, status_code=201)
async def create_task(req: CreateTaskRequest) -> ScheduledTask:
    scheduler = _scheduler_started()

    task = ScheduledTask(
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

    updated = ScheduledTask(
        id=current.id,
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
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc))


@router.get("/tasks/{task_id}/history", response_model=list[TaskExecutionRecord])
async def get_task_history(task_id: str) -> list[TaskExecutionRecord]:
    scheduler = _scheduler_started()
    if scheduler.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return scheduler.list_history(task_id)


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
