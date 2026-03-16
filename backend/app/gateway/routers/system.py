"""System-level runtime governance APIs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.config.app_config import ensure_latest_app_config
from src.system.timezone_service import SystemTimezoneState, TimezoneUpdateSummary, get_timezone_service

router = APIRouter(prefix="/api/system", tags=["system"])


class UpdateTimezoneRequest(BaseModel):
    timezone: str = Field(..., min_length=1)


class SandboxPolicyResponse(BaseModel):
    strict_mode: bool = Field(default=False, description="Whether strict sandbox mode is enabled globally.")


@router.get("/sandbox-policy", response_model=SandboxPolicyResponse, summary="Get sandbox policy flags")
async def get_sandbox_policy() -> SandboxPolicyResponse:
    app_config = ensure_latest_app_config(process_name="gateway")
    return SandboxPolicyResponse(strict_mode=bool(getattr(app_config.sandbox, "strict_mode", False)))


@router.get("/timezone", response_model=SystemTimezoneState, summary="Get global timezone state")
async def get_timezone() -> SystemTimezoneState:
    service = get_timezone_service()
    return service.get_state()


@router.put("/timezone", response_model=TimezoneUpdateSummary, summary="Update global timezone and propagate")
async def update_timezone(payload: UpdateTimezoneRequest) -> TimezoneUpdateSummary:
    service = get_timezone_service()
    try:
        return service.update_timezone(payload.timezone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
