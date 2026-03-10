"""Heartbeat API router."""

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.heartbeat.models import HeartbeatLogRecord, HeartbeatSettings, HeartbeatTemplate
from src.heartbeat.service import get_heartbeat_service

router = APIRouter(prefix="/api/heartbeat", tags=["heartbeat"])


class HeartbeatStatusResponse(BaseModel):
    """Heartbeat system status response."""

    enabled: bool
    next_runs: dict[str, str | None]
    recent_logs: list[HeartbeatLogRecord]


@router.get("/settings", response_model=HeartbeatSettings)
async def get_settings() -> HeartbeatSettings:
    """Get Heartbeat settings."""
    service = get_heartbeat_service()
    return service.get_settings()


@router.put("/settings", response_model=HeartbeatSettings)
async def update_settings(settings: HeartbeatSettings) -> HeartbeatSettings:
    """Update Heartbeat settings."""
    service = get_heartbeat_service()
    return service.update_settings(settings)


@router.get("/templates", response_model=list[HeartbeatTemplate])
async def get_templates() -> list[HeartbeatTemplate]:
    """Get all Heartbeat templates."""
    service = get_heartbeat_service()
    return service.get_templates()


@router.post("/bootstrap", status_code=201)
async def bootstrap() -> dict:
    """Initialize default Heartbeat tasks."""
    service = get_heartbeat_service()
    result = service.bootstrap()
    return {"status": "success", "tasks": result}


@router.get("/logs", response_model=list[HeartbeatLogRecord])
async def get_logs(
    template_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[HeartbeatLogRecord]:
    """Get Heartbeat logs."""
    service = get_heartbeat_service()
    logs = service.get_logs(template_id=template_id, limit=limit + offset)

    # Filter by status
    if status:
        logs = [log for log in logs if log.status == status]

    # Pagination
    return logs[offset : offset + limit]


@router.get("/logs/{log_id}", response_model=HeartbeatLogRecord)
async def get_log(log_id: str) -> HeartbeatLogRecord:
    """Get single log detail."""
    service = get_heartbeat_service()
    log = service.get_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail=f"Log not found: {log_id}")
    return log


@router.post("/execute/{template_id}", status_code=202)
async def execute_heartbeat(template_id: str) -> dict:
    """Execute Heartbeat manually."""
    service = get_heartbeat_service()
    try:
        task_id = service.execute_heartbeat(template_id)
        return {"status": "started", "task_id": task_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/status", response_model=HeartbeatStatusResponse)
async def get_status() -> HeartbeatStatusResponse:
    """Get Heartbeat system status."""
    service = get_heartbeat_service()
    status = service.get_status()
    return HeartbeatStatusResponse(**status)
