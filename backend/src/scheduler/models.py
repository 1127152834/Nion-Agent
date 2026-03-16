"""Scheduler domain models."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel, Field, model_validator


class TriggerType(StrEnum):
    """Supported trigger types."""

    CRON = "cron"
    INTERVAL = "interval"
    ONCE = "once"
    EVENT = "event"
    WEBHOOK = "webhook"


class TaskStatus(StrEnum):
    """Task runtime status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskMode(StrEnum):
    """Task execution mode."""

    WORKFLOW = "workflow"
    REMINDER = "reminder"
    HEARTBEAT = "heartbeat"
    EVOLUTION = "evolution"


class CompletionCriteriaType(StrEnum):
    """Step completion policy."""

    OUTPUT_CONTAINS = "output_contains"
    OUTPUT_MATCHES = "output_matches"
    NO_ERROR = "no_error"


class TriggerConfig(BaseModel):
    """Trigger configuration for scheduled tasks."""

    type: TriggerType
    cron_expression: str | None = None
    interval_seconds: int | None = Field(default=None, ge=1)
    scheduled_time: datetime | None = None
    event_type: str | None = None
    event_filters: dict[str, Any] | None = None
    webhook_secret: str | None = None
    timezone: str = "UTC"

    @model_validator(mode="after")
    def validate_by_type(self) -> TriggerConfig:
        timezone = self.timezone.strip() if self.timezone else "UTC"
        try:
            zone = ZoneInfo(timezone)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"invalid timezone: {timezone}") from exc

        self.timezone = timezone
        if self.type == TriggerType.CRON:
            if not self.cron_expression:
                raise ValueError("cron_expression is required for cron trigger")
            try:
                CronTrigger.from_crontab(self.cron_expression, timezone=zone)
            except ValueError as exc:
                raise ValueError(f"invalid cron_expression: {exc}") from exc
        if self.type == TriggerType.INTERVAL and self.interval_seconds is None:
            raise ValueError("interval_seconds is required for interval trigger")
        if self.type == TriggerType.ONCE and self.scheduled_time is None:
            raise ValueError("scheduled_time is required for once trigger")
        if self.type == TriggerType.EVENT and not self.event_type:
            raise ValueError("event_type is required for event trigger")

        if self.scheduled_time and self.scheduled_time.tzinfo is None:
            self.scheduled_time = self.scheduled_time.replace(tzinfo=zone).astimezone(UTC)
        return self


class CompletionCriteria(BaseModel):
    """Validation policy after a workflow step completes."""

    type: CompletionCriteriaType
    pattern: str | None = None

    @model_validator(mode="after")
    def validate_pattern(self) -> CompletionCriteria:
        if self.type in {CompletionCriteriaType.OUTPUT_CONTAINS, CompletionCriteriaType.OUTPUT_MATCHES} and not self.pattern:
            raise ValueError("pattern is required for output_contains/output_matches")
        return self


class RetryPolicy(BaseModel):
    """Task-level retry policy."""

    max_attempts: int = Field(default=1, ge=1, le=10)
    backoff: str = Field(default="none")


class AgentStep(BaseModel):
    """Single agent execution unit."""

    agent_name: str
    agent_config: dict[str, Any] | None = None
    prompt: str
    skill: str | None = None
    tools: list[str] | None = None
    mcp_servers: list[str] | None = None
    context_refs: list[str] | None = None
    timeout_seconds: int = Field(default=300, ge=1, le=3600)
    retry_on_failure: bool = False
    max_retries: int = Field(default=0, ge=0, le=10)


class WorkflowStep(BaseModel):
    """Workflow step with one or more agent units."""

    id: str
    name: str
    agents: list[AgentStep] = Field(default_factory=list)
    parallel: bool = False
    depends_on: list[str] = Field(default_factory=list)
    completion_criteria: CompletionCriteria | None = None


class ScheduledTask(BaseModel):
    """Scheduled task definition and runtime state."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    agent_name: str
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
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None

    status: TaskStatus = TaskStatus.PENDING
    last_result: dict[str, Any] | None = None
    last_error: str | None = None

    @model_validator(mode="after")
    def validate_mode(self) -> ScheduledTask:
        if self.mode == TaskMode.WORKFLOW and not self.steps:
            raise ValueError("steps are required for workflow mode")
        if self.mode == TaskMode.REMINDER:
            if not self.reminder_message:
                raise ValueError("reminder_message is required for reminder mode")
            if self.steps:
                raise ValueError("steps must be empty for reminder mode")
        if self.mode == TaskMode.HEARTBEAT:
            if self.steps:
                raise ValueError("steps must be empty for heartbeat mode")
        if self.mode == TaskMode.EVOLUTION:
            if self.steps:
                raise ValueError("steps must be empty for evolution mode")
        return self


class TaskExecutionRecord(BaseModel):
    """A historical execution record for one task run."""

    run_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    # Correlation id for processlog export (default: same as run_id).
    trace_id: str | None = None
    # Optional chat thread id for this run (workflow mode only by default).
    thread_id: str | None = None
    task_id: str
    started_at: datetime
    completed_at: datetime | None = None
    status: TaskStatus
    success: bool = False
    result: dict[str, Any] | None = None
    error: str | None = None
