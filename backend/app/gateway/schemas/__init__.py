"""Pydantic schemas for configuration center API."""

from typing import Any

from pydantic import BaseModel, Field


class ConfigValidateErrorItem(BaseModel):
    """Validation error item."""

    path: list[str] = Field(default_factory=list, description="Path to the invalid field")
    message: str = Field(..., description="Validation message")
    type: str = Field(default="validation_error", description="Validation error type")


class ConfigValidateWarningItem(BaseModel):
    """Validation warning item."""

    path: list[str] = Field(default_factory=list, description="Path to the warning field")
    message: str = Field(..., description="Warning message")
    type: str = Field(default="validation_warning", description="Warning type")


class ConfigReadResponse(BaseModel):
    """Response for reading configuration."""

    version: str = Field(..., description="Current config version")
    source_path: str = Field(..., description="Resolved config storage path")
    yaml_text: str = Field(..., description="Raw YAML representation")
    config: dict[str, Any] = Field(default_factory=dict, description="Raw config content")


class ConfigValidateRequest(BaseModel):
    """Request for validating configuration."""

    config: dict[str, Any] | None = Field(default=None, description="Config content to validate")
    yaml_text: str | None = Field(default=None, description="Raw YAML content to validate")


class ConfigValidateResponse(BaseModel):
    """Response for configuration validation."""

    valid: bool = Field(..., description="Whether the config is valid")
    errors: list[ConfigValidateErrorItem] = Field(default_factory=list, description="Validation errors")
    warnings: list[ConfigValidateWarningItem] = Field(default_factory=list, description="Validation warnings")
    config: dict[str, Any] | None = Field(default=None, description="Normalized config when validation succeeds")
    yaml_text: str | None = Field(default=None, description="YAML representation when validation succeeds")


class ConfigUpdateRequest(BaseModel):
    """Request for updating configuration."""

    version: str = Field(..., description="Expected current config version")
    config: dict[str, Any] | None = Field(default=None, description="New config content")
    yaml_text: str | None = Field(default=None, description="Raw YAML content to save")


class ConfigUpdateResponse(BaseModel):
    """Response for configuration update."""

    version: str = Field(..., description="Updated config version")
    source_path: str = Field(..., description="Resolved config storage path")
    yaml_text: str = Field(..., description="Raw YAML representation")
    config: dict[str, Any] = Field(default_factory=dict, description="Saved config content")
    warnings: list[ConfigValidateWarningItem] = Field(default_factory=list, description="Non-blocking validation warnings")


class RuntimeProcessConfigStatus(BaseModel):
    """Runtime config status for one process."""

    loaded_version: str | None = Field(default=None, description="Loaded config version in process")
    source_path: str | None = Field(default=None, description="Config source path for process")
    tools_count: int | None = Field(default=None, description="Loaded tools count")
    status: str = Field(default="unknown", description="Runtime status: ok/error")
    reason: str | None = Field(default=None, description="Error reason when status=error")
    updated_at: str | None = Field(default=None, description="Last runtime status update time")


class ConfigRuntimeStatusResponse(BaseModel):
    """Response for runtime config status observability."""

    process_name: str = Field(..., description="Current process name")
    store_version: str | None = Field(default=None, description="Current storage version")
    store_source_path: str | None = Field(default=None, description="Storage source path")
    loaded_version: str | None = Field(default=None, description="Current process loaded version")
    loaded_source_path: str | None = Field(default=None, description="Current process loaded source path")
    source_kind: str = Field(default="unknown", description="Current process loaded source kind")
    tools_count: int = Field(default=0, description="Current process loaded tools count")
    loaded_tools: list[str] = Field(default_factory=list, description="Loaded tools summary")
    last_loaded_at: str | None = Field(default=None, description="Current process last loaded timestamp")
    last_error: str | None = Field(default=None, description="Current process last load error")
    runtime_processes: dict[str, RuntimeProcessConfigStatus] = Field(default_factory=dict, description="All process runtime versions")
    is_in_sync: bool = Field(default=False, description="Whether current process is in sync with store version")
    warnings: list[str] = Field(default_factory=list, description="Runtime-level non-blocking warnings")


class ConfigSectionSchema(BaseModel):
    """Schema for a configuration section."""

    title: str = Field(..., description="Section title")
    description: str = Field(default="", description="Section description")


class ConfigSchemaResponse(BaseModel):
    """Response for configuration schema."""

    sections: dict[str, ConfigSectionSchema] = Field(default_factory=dict, description="Config sections metadata")
    order: list[str] = Field(default_factory=list, description="Recommended section order")
