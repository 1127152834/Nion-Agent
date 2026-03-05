"""Configuration center API router."""

import logging

import yaml
from fastapi import APIRouter, HTTPException

from src.config.config_repository import ConfigRepository, ConfigValidationError, VersionConflictError
from src.gateway.schemas import (
    ConfigReadResponse,
    ConfigSchemaResponse,
    ConfigSectionSchema,
    ConfigUpdateRequest,
    ConfigUpdateResponse,
    ConfigValidateErrorItem,
    ConfigValidateRequest,
    ConfigValidateResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["config"])


def _build_schema() -> ConfigSchemaResponse:
    """Build configuration schema with sections metadata."""
    sections = {
        "models": ConfigSectionSchema(title="Models", description="Configure available LLM models."),
        "tools": ConfigSectionSchema(title="Tools", description="Configure tools and tool groups."),
        "sandbox": ConfigSectionSchema(title="Sandbox", description="Configure sandbox provider and runtime options."),
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
    errors = [ConfigValidateErrorItem(**item) for item in repo.validate(payload)]
    if errors:
        return ConfigValidateResponse(valid=False, errors=errors)
    return ConfigValidateResponse(valid=True, errors=[], config=payload, yaml_text=_to_yaml_text(payload))


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
        new_version = repo.write(config_dict=payload, expected_version=request.version)
        config, _, source_path = repo.read()
        return ConfigUpdateResponse(
            version=new_version,
            source_path=str(source_path),
            yaml_text=_to_yaml_text(config),
            config=config,
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
            },
        ) from exc
    except Exception as exc:
        logger.error("Failed to update config: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update config") from exc
