"""Subagent run persistence APIs."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from nion.subagents import get_persisted_task_result, list_persisted_tasks, patch_persisted_task
from nion.subagents.run_models import SubagentRunRecord
from nion.subagents.run_store import upsert_run

router = APIRouter(prefix="/api/subagent-runs", tags=["subagent-runs"])


class CreateSubagentRunRequest(BaseModel):
    id: str | None = None
    trace_id: str
    subagent: str
    status: str = "pending"
    thread_id: str | None = None
    result: str | None = None
    error: str | None = None
    ai_messages: list[dict[str, Any]] = Field(default_factory=list)


class PatchSubagentRunRequest(BaseModel):
    status: str | None = None
    result: str | None = None
    error: str | None = None
    ai_messages: list[dict[str, Any]] | None = None


@router.get("", response_model=list[SubagentRunRecord], summary="List persisted subagent runs")
async def list_subagent_runs(
    limit: int = Query(default=200, ge=1, le=2000),
    status: str | None = None,
    trace_id: str | None = None,
) -> list[SubagentRunRecord]:
    return list_persisted_tasks(limit=limit, status=status, trace_id=trace_id)


@router.get("/{run_id}", response_model=SubagentRunRecord, summary="Get one persisted subagent run")
async def get_subagent_run(run_id: str) -> SubagentRunRecord:
    record = get_persisted_task_result(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Subagent run not found: {run_id}")
    return record


@router.post("", response_model=SubagentRunRecord, summary="Create persisted subagent run")
async def create_subagent_run(payload: CreateSubagentRunRequest) -> SubagentRunRecord:
    now = datetime.now(UTC)
    record = SubagentRunRecord(
        id=(payload.id or uuid.uuid4().hex[:12]).strip(),
        trace_id=payload.trace_id.strip(),
        subagent=payload.subagent.strip(),
        status=payload.status.strip().lower(),
        thread_id=payload.thread_id,
        result=payload.result,
        error=payload.error,
        ai_messages=payload.ai_messages,
        created_at=now,
        updated_at=now,
    )
    return upsert_run(record)


@router.patch("/{run_id}", response_model=SubagentRunRecord, summary="Patch persisted subagent run")
async def patch_subagent_run(run_id: str, payload: PatchSubagentRunRequest) -> SubagentRunRecord:
    fields: dict[str, Any] = payload.model_dump(exclude_none=True)
    if fields.get("status") is not None:
        fields["status"] = str(fields["status"]).strip().lower()
    patched = patch_persisted_task(run_id, fields)
    if patched is None:
        raise HTTPException(status_code=404, detail=f"Subagent run not found: {run_id}")
    return patched
