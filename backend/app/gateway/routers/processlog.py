"""ProcessLog export APIs."""

from __future__ import annotations

from fastapi import APIRouter, Query

from src.processlog.service import get_processlog_service

router = APIRouter(prefix="/api/processlog", tags=["processlog"])


@router.get("/trace/{trace_id}/export", summary="Export processlog events by trace_id")
async def export_trace(trace_id: str, limit: int = Query(default=2000, ge=1, le=20000)) -> dict:
    service = get_processlog_service()
    return service.export_trace(trace_id, limit=limit)


@router.get("/chat/{chat_id}/export", summary="Export processlog events by chat_id")
async def export_chat(chat_id: str, limit: int = Query(default=2000, ge=1, le=20000)) -> dict:
    service = get_processlog_service()
    return service.export_chat(chat_id, limit=limit)
