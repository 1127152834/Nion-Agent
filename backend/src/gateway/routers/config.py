"""Configuration center API router."""

import logging

import yaml
from fastapi import APIRouter, HTTPException

from src.config.config_repository import ConfigRepository, ConfigValidationError, VersionConflictError
from src.gateway.schemas import (
    ConfigReadResponse,
    ConfigRuntimeStatusResponse,
    ConfigSchemaResponse,
    ConfigSectionSchema,
    ConfigUpdateRequest,
    ConfigUpdateResponse,
    ConfigValidateErrorItem,
    ConfigValidateRequest,
    ConfigValidateResponse,
    ConfigValidateWarningItem,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["config"])


def _build_schema() -> ConfigSchemaResponse:
    """Build configuration schema with sections metadata."""
    sections = {
        "models": ConfigSectionSchema(title="Models", description="Configure available LLM models."),
        "tools": ConfigSectionSchema(title="Tools", description="Configure tools and tool groups."),
        "sandbox": ConfigSectionSchema(title="Sandbox", description="Configure sandbox provider and runtime options."),
        "checkpointer": ConfigSectionSchema(title="Checkpointer", description="Configure thread state persistence backend and connection settings."),
        "title": ConfigSectionSchema(title="Title", description="Configure automatic title generation."),
        "summarization": ConfigSectionSchema(title="Summarization", description="Configure conversation summarization behavior."),
        "subagents": ConfigSectionSchema(title="Subagents", description="Configure subagent timeout defaults and overrides."),
        "memory": ConfigSectionSchema(title="Memory", description="Configure memory system behavior."),
        "skills": ConfigSectionSchema(title="Skills", description="Configure skills directory paths."),
        "advanced_yaml": ConfigSectionSchema(title="Advanced YAML", description="Directly edit raw YAML configuration."),
    }
    order = [
        "models",
        "tools",
        "sandbox",
        "checkpointer",
        "title",
        "summarization",
        "subagents",
        "memory",
        "skills",
        "advanced_yaml",
    ]
    return ConfigSchemaResponse(sections=sections, order=order)


def _to_yaml_text(config: dict) -> str:
    """Convert configuration dictionary to YAML text."""
    return yaml.safe_dump(config, sort_keys=False, allow_unicode=True)


def _resolve_config_payload(config: dict | None, yaml_text: str | None) -> dict:
    """Resolve configuration payload from either dict or YAML text.

    Args:
        config: Configuration dictionary
        yaml_text: YAML text representation

    Returns:
        Resolved configuration dictionary

    Raises:
        HTTPException: If neither config nor yaml_text provided, or YAML parsing fails
    """
    if config is not None:
        return config

    if yaml_text is None:
        raise HTTPException(status_code=400, detail="Either config or yaml_text is required")

    try:
        parsed = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="YAML root must be a mapping object")
    return parsed


@router.get(
    "/config",
    response_model=ConfigReadResponse,
    summary="Get Configuration",
    description="Retrieve configuration content with current version and resolved storage path.",
)
async def get_config() -> ConfigReadResponse:
    """Get current configuration."""
    repo = ConfigRepository()
    config, version, source_path = repo.read()
    return ConfigReadResponse(
        version=version,
        source_path=str(source_path),
        yaml_text=_to_yaml_text(config),
        config=config,
    )


@router.get(
    "/config/schema",
    response_model=ConfigSchemaResponse,
    summary="Get Configuration Schema",
    description="Retrieve metadata for rendering visual config sections in the frontend.",
)
async def get_config_schema() -> ConfigSchemaResponse:
    """Get configuration schema metadata."""
    return _build_schema()


@router.post(
    "/config/validate",
    response_model=ConfigValidateResponse,
    summary="Validate Configuration",
    description="Validate a config payload without persisting it.",
)
async def validate_config(request: ConfigValidateRequest) -> ConfigValidateResponse:
    """Validate configuration without saving."""
    repo = ConfigRepository()
    payload = _resolve_config_payload(request.config, request.yaml_text)
    errors_raw, warnings_raw = repo.validate_with_warnings(payload)
    errors = [ConfigValidateErrorItem(**item) for item in errors_raw]
    warnings = [ConfigValidateWarningItem(**item) for item in warnings_raw]
    if errors:
        return ConfigValidateResponse(valid=False, errors=errors, warnings=warnings)
    return ConfigValidateResponse(
        valid=True,
        errors=[],
        warnings=warnings,
        config=payload,
        yaml_text=_to_yaml_text(payload),
    )


@router.put(
    "/config",
    response_model=ConfigUpdateResponse,
    summary="Update Configuration",
    description="Persist configuration with optimistic lock by version and reload runtime config.",
)
async def update_config(request: ConfigUpdateRequest) -> ConfigUpdateResponse:
    """Update configuration with version control."""
    repo = ConfigRepository()
    payload = _resolve_config_payload(request.config, request.yaml_text)

    try:
        new_version, warnings_raw = repo.write_with_warnings(config_dict=payload, expected_version=request.version)
        warnings = [ConfigValidateWarningItem(**item) for item in warnings_raw]
        config, _, source_path = repo.read()
        return ConfigUpdateResponse(
            version=new_version,
            source_path=str(source_path),
            yaml_text=_to_yaml_text(config),
            config=config,
            warnings=warnings,
        )
    except VersionConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Config has been modified by another session. Refresh and retry.",
                "current_version": exc.current_version,
            },
        ) from exc
    except ConfigValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Config validation failed",
                "errors": exc.errors,
                "warnings": exc.warnings,
            },
        ) from exc
    except Exception as exc:
        logger.error("Failed to update config: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update config") from exc


@router.get(
    "/config/runtime-status",
    response_model=ConfigRuntimeStatusResponse,
    summary="Get Runtime Config Status",
    description="Retrieve runtime/store version alignment and per-process loaded config status.",
)
async def get_runtime_status() -> ConfigRuntimeStatusResponse:
    """Get runtime config status for observability and troubleshooting."""
    repo = ConfigRepository()
    status_payload = repo.get_runtime_status()
    runtime_warnings: list[str] = []

    runtime_processes = status_payload.get("runtime_processes", {})
    if isinstance(runtime_processes, dict):
        for process_name, process_info in runtime_processes.items():
            if not isinstance(process_info, dict):
                continue
            if process_info.get("status") == "error":
                reason = process_info.get("reason") or "unknown runtime load error"
                runtime_warnings.append(f"{process_name}: {reason}")

    if not status_payload.get("is_in_sync"):
        runtime_warnings.append("Current process config version is not in sync with storage version")

    status_payload["warnings"] = runtime_warnings
    return ConfigRuntimeStatusResponse(**status_payload)
