"""ProcessLog domain models."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ProcessLogLevel = Literal["debug", "info", "warn", "error"]


class ProcessLogEvent(BaseModel):
    """Unified process log event."""

    id: str
    trace_id: str
    chat_id: str | None = None
    step: str
    level: ProcessLogLevel = "info"
    duration_ms: int = 0
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
