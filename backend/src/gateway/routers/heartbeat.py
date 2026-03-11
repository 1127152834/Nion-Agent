"""Heartbeat API router."""

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
async def get_settings(agent_name: str = "_default") -> HeartbeatSettings:
    """Get Heartbeat settings for an agent."""
    service = get_heartbeat_service()
    return service.get_settings(agent_name)


@router.put("/settings", response_model=HeartbeatSettings)
async def update_settings(settings: HeartbeatSettings, agent_name: str = "_default") -> HeartbeatSettings:
    """Update Heartbeat settings for an agent."""
    service = get_heartbeat_service()
    return service.update_settings(settings, agent_name)


@router.get("/templates", response_model=list[HeartbeatTemplate])
async def get_templates() -> list[HeartbeatTemplate]:
    """Get all Heartbeat templates."""
    service = get_heartbeat_service()
    return service.get_templates()


@router.post("/bootstrap", status_code=201)
async def bootstrap(agent_name: str = "_default") -> dict:
    """Initialize default Heartbeat tasks for an agent."""
    service = get_heartbeat_service()
    result = service.bootstrap(agent_name)
    return {"status": "success", "tasks": result}


@router.get("/logs", response_model=list[HeartbeatLogRecord])
async def get_logs(
    agent_name: str = "_default",
    template_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[HeartbeatLogRecord]:
    """Get Heartbeat logs for an agent."""
    service = get_heartbeat_service()
    logs = service.get_logs(agent_name, template_id=template_id, limit=limit + offset)

    # Filter by status
    if status:
        logs = [log for log in logs if log.status == status]

    # Pagination
    return logs[offset : offset + limit]


@router.get("/logs/{log_id}", response_model=HeartbeatLogRecord)
async def get_log(log_id: str, agent_name: str = "_default") -> HeartbeatLogRecord:
    """Get single log detail for an agent."""
    service = get_heartbeat_service()
    log = service.get_log(log_id, agent_name)
    if not log:
        raise HTTPException(status_code=404, detail=f"Log not found: {log_id}")
    return log


@router.post("/execute/{template_id}", status_code=202)
async def execute_heartbeat(template_id: str, agent_name: str = "_default") -> dict:
    """Execute Heartbeat manually for an agent."""
    service = get_heartbeat_service()
    try:
        task_id = service.execute_heartbeat(template_id, agent_name)
        return {"status": "started", "task_id": task_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/status", response_model=HeartbeatStatusResponse)
async def get_status(agent_name: str = "_default") -> HeartbeatStatusResponse:
    """Get Heartbeat system status for an agent."""
    service = get_heartbeat_service()
    status = service.get_status(agent_name)
    return HeartbeatStatusResponse(**status)
