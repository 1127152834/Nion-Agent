"""Heartbeat data models."""

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class HeartbeatCategory(str, Enum):
    """Heartbeat category."""

    REVIEW = "review"
    MAINTENANCE = "maintenance"
    CHECK = "check"


class HeartbeatResultType(str, Enum):
    """Heartbeat result type."""

    SUMMARY = "summary"
    MAINTENANCE_REPORT = "maintenance_report"
    SUGGESTION = "suggestion"


class HeartbeatTemplate(BaseModel):
    """Heartbeat template definition."""

    template_id: str
    name: str
    description: str
    category: HeartbeatCategory
    default_enabled: bool = True
    default_cron: str
    default_timezone: str = "UTC"
    result_type: HeartbeatResultType
    memory_scope: str = "read"
    soul_scope: str = "none"
    estimated_duration_seconds: int = 60


class TemplateConfig(BaseModel):
    """Single template configuration."""

    template_id: str
    enabled: bool = True
    cron: str
    generate_reminder: bool = False
    generate_log: bool = True
    auto_execute: bool = True


class HeartbeatSettings(BaseModel):
    """Heartbeat global settings."""

    enabled: bool = True
    timezone: str = "UTC"
    templates: dict[str, TemplateConfig] = Field(default_factory=dict)


class HeartbeatLogRecord(BaseModel):
    """Heartbeat log record."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    heartbeat_type: str
    timestamp: datetime
    status: str
    result_type: HeartbeatResultType
    result: dict[str, Any]
    duration_seconds: int
    error_message: str | None = None
    user_visible: bool = True


class HeartbeatRunSummary(BaseModel):
    """Heartbeat run summary."""

    heartbeat_type: str
    timestamp: datetime
    summary: str
    key_metrics: dict[str, Any] = Field(default_factory=dict)
    next_scheduled: datetime | None = None
    suggestions: list[str] = Field(default_factory=list)
