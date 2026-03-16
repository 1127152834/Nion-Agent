"""Evolution data models."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class SuggestionType(StrEnum):
    """Suggestion type."""

    MEMORY = "memory_suggestion"
    SOUL = "soul_suggestion"
    AGENT = "agent_suggestion"


class SuggestionStatus(StrEnum):
    """Suggestion status."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"


class SuggestionPriority(StrEnum):
    """Suggestion priority."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class EvolutionSuggestion(BaseModel):
    """Evolution suggestion."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    report_id: str
    type: SuggestionType
    target_domain: str
    content: str
    evidence_summary: str
    impact_scope: str
    confidence: float = Field(ge=0.0, le=1.0)
    priority: SuggestionPriority
    status: SuggestionStatus = SuggestionStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    default_action: Literal["suggest_only"] = "suggest_only"


class ReportStatus(StrEnum):
    """Report status."""

    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class EvolutionReport(BaseModel):
    """Evolution report."""

    report_id: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%dT%H-%M-%SZ"))
    timestamp: datetime = Field(default_factory=datetime.now)
    status: ReportStatus
    duration_seconds: int
    input_sources: dict[str, Any] = Field(default_factory=dict)
    suggestions: list[EvolutionSuggestion] = Field(default_factory=list)
    summary: str
    error_message: str | None = None
    next_scheduled: datetime | None = None


class EvolutionSettings(BaseModel):
    """Evolution settings."""

    enabled: bool = True
    interval_hours: int = Field(default=24, ge=1, le=168)
    auto_trigger: bool = False
