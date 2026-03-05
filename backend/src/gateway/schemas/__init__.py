"""Pydantic schemas for configuration center API."""

from typing import Any

from pydantic import BaseModel, Field


class ConfigValidateErrorItem(BaseModel):
    """Validation error item."""

    path: list[str] = Field(default_factory=list, description="Path to the invalid field")
    message: str = Field(..., description="Validation message")
    type: str = Field(default="validation_error", description="Validation error type")


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


class ConfigSectionSchema(BaseModel):
    """Schema for a configuration section."""

    title: str = Field(..., description="Section title")
    description: str = Field(default="", description="Section description")


class ConfigSchemaResponse(BaseModel):
    """Response for configuration schema."""

    sections: dict[str, ConfigSectionSchema] = Field(default_factory=dict, description="Config sections metadata")
    order: list[str] = Field(default_factory=list, description="Recommended section order")
