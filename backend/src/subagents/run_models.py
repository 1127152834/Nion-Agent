"""Persistent models for subagent runs."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SubagentRunStatus = Literal["pending", "running", "completed", "failed", "timed_out"]


class SubagentRunRecord(BaseModel):
    id: str
    trace_id: str
    subagent: str
    status: SubagentRunStatus
    thread_id: str | None = None
    result: str | None = None
    error: str | None = None
    ai_messages: list[dict[str, Any]] = Field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

