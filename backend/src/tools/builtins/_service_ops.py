"""Shared service operations and API models.

This module exists to break *harness -> gateway(app)* reverse dependencies.

Rules:
- Must NOT import FastAPI or any `src.gateway.*` modules.
- Exposes Pydantic models and async functions that both:
  1) Gateway routers can wrap (HTTP adapters)
  2) Harness-layer code (tools/client) can call directly
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
import time
import zipfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from src.config.extensions_config import ExtensionsConfig, SkillStateConfig, get_extensions_config, reload_extensions_config
from src.config.paths import get_paths
from src.reflection import resolve_class
from src.runtime_profile import RuntimeProfileRepository, RuntimeProfileValidationError
from src.skills import Skill, load_skills
from src.skills.loader import get_skills_root_path
from src.skills.validation import _validate_skill_frontmatter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# MCP (extensions_config.json) service ops
# ---------------------------------------------------------------------------


class McpOAuthConfigResponse(BaseModel):
    """OAuth configuration for an MCP server."""

    enabled: bool = Field(default=True, description="Whether OAuth token injection is enabled")
    token_url: str = Field(default="", description="OAuth token endpoint URL")
    grant_type: Literal["client_credentials", "refresh_token"] = Field(default="client_credentials", description="OAuth grant type")
    client_id: str | None = Field(default=None, description="OAuth client ID")
    client_secret: str | None = Field(default=None, description="OAuth client secret")
    refresh_token: str | None = Field(default=None, description="OAuth refresh token")
    scope: str | None = Field(default=None, description="OAuth scope")
    audience: str | None = Field(default=None, description="OAuth audience")
    token_field: str = Field(default="access_token", description="Token response field containing access token")
    token_type_field: str = Field(default="token_type", description="Token response field containing token type")
    expires_in_field: str = Field(default="expires_in", description="Token response field containing expires-in seconds")
    default_token_type: str = Field(default="Bearer", description="Default token type when response omits token_type")
    refresh_skew_seconds: int = Field(default=60, description="Refresh this many seconds before expiry")
    extra_token_params: dict[str, str] = Field(default_factory=dict, description="Additional form params sent to token endpoint")
    model_config = ConfigDict(extra="allow")


class McpServerConfigResponse(BaseModel):
    """Response model for MCP server configuration."""

    enabled: bool = Field(default=True, description="Whether this MCP server is enabled")
    type: str = Field(default="stdio", description="Transport type: 'stdio', 'sse', or 'http'")
    command: str | None = Field(default=None, description="Command to execute to start the MCP server (for stdio type)")
    args: list[str] = Field(default_factory=list, description="Arguments to pass to the command (for stdio type)")
    env: dict[str, str] = Field(default_factory=dict, description="Environment variables for the MCP server")
    url: str | None = Field(default=None, description="URL of the MCP server (for sse or http type)")
    headers: dict[str, str] = Field(default_factory=dict, description="HTTP headers to send (for sse or http type)")
    oauth: McpOAuthConfigResponse | None = Field(default=None, description="OAuth configuration for MCP HTTP/SSE servers")
    description: str = Field(default="", description="Human-readable description of what this MCP server provides")
    meta: dict[str, Any] | None = Field(default=None, description="Optional metadata for UI/marketplace integration")
    model_config = ConfigDict(extra="allow")


class McpConfigResponse(BaseModel):
    """Response model for MCP configuration."""

    mcp_servers: dict[str, McpServerConfigResponse] = Field(
        default_factory=dict,
        description="Map of MCP server name to configuration",
    )


class McpConfigUpdateRequest(BaseModel):
    """Request model for updating MCP configuration."""

    mcp_servers: dict[str, McpServerConfigResponse] = Field(
        ...,
        description="Map of MCP server name to configuration",
    )


async def get_mcp_configuration() -> McpConfigResponse:
    """Get the current MCP configuration (business logic; no HTTP concerns)."""
    config = get_extensions_config()
    return McpConfigResponse(mcp_servers={name: McpServerConfigResponse(**server.model_dump()) for name, server in config.mcp_servers.items()})


async def update_mcp_configuration(request: McpConfigUpdateRequest) -> McpConfigResponse:
    """Update MCP configuration and persist it to the extensions config file.

    Raises:
        RuntimeError: When persistence/reload fails.
    """
    try:
        # NOTE: The extensions config MUST live in the Nion data dir (NION_HOME / $HOME/.nion),
        # not under the repository checkout. Desktop runtime can restart from different CWDs,
        # and the repo itself may be replaced (re-clone / history rewrite), which would make
        # installed MCP servers "disappear" if we write relative to CWD.
        config_path = Path(os.getenv("NION_EXTENSIONS_CONFIG_PATH")).expanduser().resolve() if os.getenv("NION_EXTENSIONS_CONFIG_PATH") else ExtensionsConfig.default_config_path()
        config_path.parent.mkdir(parents=True, exist_ok=True)

        # Load current config to preserve skills configuration
        current_config = get_extensions_config()

        # Convert request to dict format for JSON serialization
        config_data = {
            "mcpServers": {name: server.model_dump() for name, server in request.mcp_servers.items()},
            "skills": {name: {"enabled": skill.enabled} for name, skill in current_config.skills.items()},
            "clis": {name: cli.model_dump() for name, cli in current_config.clis.items()},
        }

        # Write atomically to avoid corrupting the config on crash/interruption.
        temp_path = config_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(config_data, indent=2, ensure_ascii=False), encoding="utf-8")
        temp_path.replace(config_path)

        logger.info("MCP configuration updated and saved to: %s", config_path)

        # Reload the configuration and update the global cache
        reloaded_config = reload_extensions_config(str(config_path))
        return McpConfigResponse(mcp_servers={name: McpServerConfigResponse(**server.model_dump()) for name, server in reloaded_config.mcp_servers.items()})
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to update MCP configuration: %s", exc, exc_info=True)
        raise RuntimeError(f"Failed to update MCP configuration: {exc}") from exc


# ---------------------------------------------------------------------------
# Skills service ops
# ---------------------------------------------------------------------------


class SkillResponse(BaseModel):
    """Response model for skill information."""

    name: str = Field(..., description="Name of the skill")
    description: str = Field(..., description="Description of what the skill does")
    license: str | None = Field(None, description="License information")
    category: str = Field(..., description="Category of the skill (public or custom)")
    enabled: bool = Field(default=True, description="Whether this skill is enabled")


class SkillsListResponse(BaseModel):
    """Response model for listing all skills."""

    skills: list[SkillResponse]


class SkillUpdateRequest(BaseModel):
    """Request model for updating a skill."""

    enabled: bool = Field(..., description="Whether to enable or disable the skill")


class SkillInstallRequest(BaseModel):
    """Request model for installing a skill from a .skill file."""

    thread_id: str = Field(..., description="The thread ID where the .skill file is located")
    path: str = Field(..., description="Virtual path to the .skill file (e.g., mnt/user-data/outputs/my-skill.skill)")


class SkillInstallResponse(BaseModel):
    """Response model for skill installation."""

    success: bool = Field(..., description="Whether the installation was successful")
    skill_name: str = Field(..., description="Name of the installed skill")
    message: str = Field(..., description="Installation result message")


def _skill_to_response(skill: Skill) -> SkillResponse:
    """Convert a Skill object to a SkillResponse."""
    return SkillResponse(
        name=skill.name,
        description=skill.description,
        license=skill.license,
        category=skill.category,
        enabled=skill.enabled,
    )


async def update_skill(skill_name: str, request: SkillUpdateRequest) -> SkillResponse:
    """Update a skill's enabled status.

    Raises:
        FileNotFoundError: If the skill does not exist.
        RuntimeError: If persisting/reloading fails unexpectedly.
    """
    # Find the skill to verify it exists
    skills = load_skills(enabled_only=False)
    skill = next((s for s in skills if s.name == skill_name), None)

    if skill is None:
        raise FileNotFoundError(f"Skill '{skill_name}' not found")

    # Persist extensions state in the Nion data dir (NION_HOME / $HOME/.nion) so it survives
    # desktop restarts and repository checkout replacement.
    config_path = Path(os.getenv("NION_EXTENSIONS_CONFIG_PATH")).expanduser().resolve() if os.getenv("NION_EXTENSIONS_CONFIG_PATH") else ExtensionsConfig.default_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # Load current configuration
    extensions_config = get_extensions_config()

    # Update the skill's enabled status
    extensions_config.skills[skill_name] = SkillStateConfig(enabled=request.enabled)

    # Convert to JSON format (preserve MCP servers config)
    config_data = {
        "mcpServers": {name: server.model_dump() for name, server in extensions_config.mcp_servers.items()},
        "skills": {name: {"enabled": skill_config.enabled} for name, skill_config in extensions_config.skills.items()},
        "clis": {name: cli.model_dump() for name, cli in extensions_config.clis.items()},
    }

    # Write atomically to avoid partial writes.
    temp_path = config_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(config_data, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(config_path)

    logger.info("Skills configuration updated and saved to: %s", config_path)

    # Reload the extensions config to update the global cache
    reload_extensions_config(str(config_path))

    # Reload the skills to get the updated status (for API response)
    skills = load_skills(enabled_only=False)
    updated_skill = next((s for s in skills if s.name == skill_name), None)

    if updated_skill is None:
        raise RuntimeError(f"Failed to reload skill '{skill_name}' after update")

    logger.info("Skill '%s' enabled status updated to %s", skill_name, request.enabled)
    return _skill_to_response(updated_skill)


def _resolve_thread_virtual_path(thread_id: str, virtual_path: str) -> Path:
    """Resolve a thread virtual path to a filesystem path.

    This is a FastAPI-free equivalent of `src.gateway.path_utils.resolve_thread_virtual_path`,
    suitable for harness-layer usage.

    Raises:
        ValueError: Invalid path contract.
        PermissionError: Access denied / traversal detected.
    """
    repository = RuntimeProfileRepository()
    profile = repository.read(thread_id)

    try:
        if profile["execution_mode"] == "host" and profile["host_workdir"]:
            return repository.resolve_host_virtual_path(virtual_path, profile["host_workdir"])
        return get_paths().resolve_virtual_path(thread_id, virtual_path)
    except (RuntimeProfileValidationError, ValueError) as exc:
        message = str(exc)
        if "traversal" in message:
            raise PermissionError(message) from exc
        raise ValueError(message) from exc


async def install_skill(request: SkillInstallRequest) -> SkillInstallResponse:
    """Install a skill from a .skill file (ZIP archive).

    Raises:
        ValueError: Invalid request/path or invalid archive structure.
        PermissionError: Access denied (path traversal).
        FileNotFoundError: Skill archive does not exist.
        FileExistsError: Skill already exists.
        RuntimeError: Unexpected failure during install.
    """
    try:
        # Resolve the virtual path to actual file path
        skill_file_path = _resolve_thread_virtual_path(request.thread_id, request.path)

        # Check if file exists
        if not skill_file_path.exists():
            raise FileNotFoundError(f"Skill file not found: {request.path}")

        # Check if it's a file
        if not skill_file_path.is_file():
            raise ValueError(f"Path is not a file: {request.path}")

        # Check file extension
        if not skill_file_path.suffix == ".skill":
            raise ValueError("File must have .skill extension")

        # Verify it's a valid ZIP file
        if not zipfile.is_zipfile(skill_file_path):
            raise ValueError("File is not a valid ZIP archive")

        # Get the custom skills directory
        skills_root = get_skills_root_path()
        custom_skills_dir = skills_root / "custom"

        # Create custom directory if it doesn't exist
        custom_skills_dir.mkdir(parents=True, exist_ok=True)

        # Extract to a temporary directory first for validation
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Extract the .skill file
            with zipfile.ZipFile(skill_file_path, "r") as zip_ref:
                zip_ref.extractall(temp_path)

            # Find the skill directory (should be the only top-level directory)
            extracted_items = list(temp_path.iterdir())
            if len(extracted_items) == 0:
                raise ValueError("Skill archive is empty")

            # Handle both cases: single directory or files directly in root
            if len(extracted_items) == 1 and extracted_items[0].is_dir():
                skill_dir = extracted_items[0]
            else:
                # Files are directly in the archive root
                skill_dir = temp_path

            # Validate the skill
            is_valid, message, skill_name = _validate_skill_frontmatter(skill_dir)
            if not is_valid:
                raise ValueError(f"Invalid skill: {message}")

            if not skill_name:
                raise ValueError("Could not determine skill name")

            # Check if skill already exists
            target_dir = custom_skills_dir / skill_name
            if target_dir.exists():
                raise FileExistsError(f"Skill '{skill_name}' already exists. Please remove it first or use a different name.")

            # Move the skill directory to the custom skills directory
            shutil.copytree(skill_dir, target_dir)

        logger.info("Skill '%s' installed successfully to %s", skill_name, target_dir)
        return SkillInstallResponse(success=True, skill_name=skill_name, message=f"Skill '{skill_name}' installed successfully")

    except (ValueError, PermissionError, FileNotFoundError, FileExistsError):
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to install skill: %s", exc, exc_info=True)
        raise RuntimeError(f"Failed to install skill: {exc}") from exc


# ---------------------------------------------------------------------------
# Models service ops (connection test + gateway-conformance models)
# ---------------------------------------------------------------------------


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    supports_vision: bool = Field(default=False, description="Whether model supports vision/image inputs")
    supports_video: bool = Field(default=False, description="Whether model supports video inputs")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]


class ModelConnectionTestRequest(BaseModel):
    """Request model for testing model provider connection."""

    use: str = Field(..., min_length=1, description="Provider class path")
    model: str | None = Field(
        default=None,
        description="Provider model id (optional; when omitted, test connectivity without model invocation)",
    )
    api_key: str | None = Field(default=None, description="Provider API key")
    api_base: str | None = Field(default=None, description="Provider API base URL")
    provider_protocol: Literal["auto", "openai-compatible", "anthropic-compatible"] | None = Field(
        default="auto",
        description="Provider protocol type: auto, openai-compatible, or anthropic-compatible",
    )
    timeout_seconds: float = Field(default=12.0, ge=1.0, le=60.0, description="Request timeout in seconds")
    probe_message: str = Field(default="Hello", min_length=1, description="Probe message used for test invocation")


class ModelConnectionTestResponse(BaseModel):
    """Response model for model provider connection test."""

    success: bool = Field(..., description="Whether test connection is successful")
    message: str = Field(..., description="Result message")
    latency_ms: int | None = Field(default=None, description="Latency in milliseconds when successful")
    response_preview: str | None = Field(
        default=None,
        description="Short preview from model response when successful",
    )


class ProviderModelListUnsupportedError(Exception):
    """Raised when provider endpoint does not expose a model listing API."""


def _strip_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _resolve_env_placeholder(value: str | None) -> str | None:
    stripped = _strip_optional(value)
    if stripped is None:
        return None
    if stripped.startswith("$"):
        return os.getenv(stripped[1:], stripped)
    return stripped


def _sanitize_error_message(raw_message: str, secrets: Sequence[str | None] | None = None) -> str:
    message = raw_message.strip() or "Unknown error"
    for secret in secrets or []:
        if secret:
            message = message.replace(secret, "***")
    return message


def _extract_text_preview(response: Any, max_len: int = 180) -> str | None:
    content = getattr(response, "content", response)
    if content is None:
        return None

    if isinstance(content, str):
        text = content.strip()
    elif isinstance(content, Sequence):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        text = " ".join(part.strip() for part in parts if part.strip())
    else:
        text = str(content).strip()

    if not text:
        return None
    if len(text) <= max_len:
        return text
    return f"{text[:max_len].rstrip()}..."


def _normalize_provider_protocol(
    provider_protocol: str | None,
) -> Literal["auto", "openai-compatible", "anthropic-compatible"]:
    normalized = (_strip_optional(provider_protocol) or "auto").lower()
    if normalized in ("openai", "openai-compatible"):
        return "openai-compatible"
    if normalized in ("anthropic", "anthropic-compatible"):
        return "anthropic-compatible"
    return "auto"


def _normalize_anthropic_api_base(api_base: str | None) -> str | None:
    raw = _strip_optional(api_base)
    if raw is None:
        return None

    parsed = urlsplit(raw)
    if not parsed.scheme or not parsed.netloc:
        return raw.rstrip("/")

    host = parsed.netloc.lower()
    path = (parsed.path or "").rstrip("/")
    if path.lower() == "/v1":
        path = ""

    if path == "" and ("minimax" in host or "minimaxi" in host):
        path = "/anthropic"

    normalized = urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))
    return normalized.rstrip("/")


def _detect_provider_type(
    use: str,
    api_base: str | None,
    provider_protocol: str | None = None,
) -> str:
    explicit_protocol = _normalize_provider_protocol(provider_protocol)
    if explicit_protocol != "auto":
        return explicit_protocol

    use_lower = use.lower()
    api_base_lower = (api_base or "").lower()
    if "anthropic" in use_lower:
        return "anthropic-compatible"
    if any(keyword in use_lower for keyword in ("openai", "deepseek", "moonshot")):
        return "openai-compatible"
    if _strip_optional(api_base):
        if "anthropic" in api_base_lower:
            return "anthropic-compatible"
        return "openai-compatible"
    return "unknown"


def _build_provider_init_kwargs(
    use: str,
    model: str,
    api_key: str | None,
    api_base: str | None,
    provider_protocol: str | None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"model": model}
    use_lower = use.lower()
    provider_type = _detect_provider_type(use=use, api_base=api_base, provider_protocol=provider_protocol)

    if provider_type == "anthropic-compatible" or "anthropic" in use_lower:
        normalized_anthropic_base = _normalize_anthropic_api_base(api_base)
        if api_key is not None:
            kwargs["anthropic_api_key"] = api_key
        if normalized_anthropic_base is not None:
            kwargs["anthropic_api_url"] = normalized_anthropic_base
        return kwargs

    if "langchain_openai" in use_lower:
        if api_key is not None:
            kwargs["openai_api_key"] = api_key
        if api_base is not None:
            kwargs["base_url"] = api_base
        return kwargs

    # DeepSeek / custom OpenAI-compatible wrappers often accept api_key/api_base.
    if api_key is not None:
        kwargs["api_key"] = api_key
    if api_base is not None:
        kwargs["api_base"] = api_base
    return kwargs


async def _fetch_provider_models_openai_compatible(
    api_base: str | None,
    api_key: str | None,
    timeout_seconds: float,
) -> list[dict[str, str]]:
    base = _strip_optional(api_base) or "https://api.openai.com/v1"
    base = base.rstrip("/")
    candidate_urls: list[str] = [f"{base}/models"]
    if not base.endswith("/v1"):
        candidate_urls.append(f"{base}/v1/models")
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        payload: Any = None
        unsupported_errors: list[str] = []
        for url in candidate_urls:
            response = await client.get(url, headers=headers or None)
            if response.status_code in {404, 405, 501}:
                unsupported_errors.append(f"{response.status_code} {url}")
                continue
            response.raise_for_status()
            payload = response.json()
            break

    if payload is None:
        detail = "; ".join(unsupported_errors) if unsupported_errors else "models endpoint unavailable"
        raise ProviderModelListUnsupportedError(detail)

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    result: list[dict[str, str]] = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id", "")).strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        name = str(item.get("name", "")).strip() or model_id
        result.append({"id": model_id, "name": name})
    return result


async def _fetch_provider_models_anthropic(
    api_base: str | None,
    api_key: str | None,
    timeout_seconds: float,
) -> list[dict[str, str]]:
    base = _normalize_anthropic_api_base(api_base) or "https://api.anthropic.com"
    base = base.rstrip("/")
    candidate_urls: list[str] = [
        f"{base}/v1/models",
        f"{base}/models",
    ]
    headers: dict[str, str] = {
        "anthropic-version": "2023-06-01",
    }
    if api_key:
        headers["x-api-key"] = api_key

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        payload: Any = None
        unsupported_errors: list[str] = []
        for url in candidate_urls:
            response = await client.get(url, headers=headers)
            if response.status_code in {404, 405, 501}:
                unsupported_errors.append(f"{response.status_code} {url}")
                continue
            response.raise_for_status()
            payload = response.json()
            break

    if payload is None:
        detail = "; ".join(unsupported_errors) if unsupported_errors else "models endpoint unavailable"
        raise ProviderModelListUnsupportedError(detail)

    candidates: list[Any] = []
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            candidates = payload["data"]
        elif isinstance(payload.get("models"), list):
            candidates = payload["models"]

    result: list[dict[str, str]] = []
    seen = set()
    for item in candidates:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id", "")).strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        display_name = str(item.get("display_name", "")).strip()
        name = display_name or str(item.get("name", "")).strip() or model_id
        result.append({"id": model_id, "name": name})
    return result


try:
    from langchain_core.language_models.chat_models import BaseChatModel
except Exception:  # pragma: no cover - compatibility fallback
    from langchain.chat_models import BaseChatModel  # type: ignore
from langchain_core.messages import HumanMessage


async def test_model_connection(
    request: ModelConnectionTestRequest,
) -> ModelConnectionTestResponse:
    """Test model provider connectivity and credentials."""
    use = request.use.strip()
    probe_model = _strip_optional(request.model)
    raw_api_key = _strip_optional(request.api_key)
    api_key = _resolve_env_placeholder(request.api_key)
    api_base = _strip_optional(request.api_base)

    if probe_model is None:
        provider_type = _detect_provider_type(
            use=use,
            api_base=api_base,
            provider_protocol=request.provider_protocol,
        )
        if provider_type == "unknown":
            return ModelConnectionTestResponse(
                success=False,
                message="Provider protocol is unknown. Please choose OpenAI-compatible or Anthropic-compatible.",
            )

        started_at = time.perf_counter()
        try:
            if provider_type == "anthropic-compatible":
                await _fetch_provider_models_anthropic(
                    api_base=api_base,
                    api_key=api_key,
                    timeout_seconds=request.timeout_seconds,
                )
            else:
                await _fetch_provider_models_openai_compatible(
                    api_base=api_base,
                    api_key=api_key,
                    timeout_seconds=request.timeout_seconds,
                )
        except ProviderModelListUnsupportedError:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            return ModelConnectionTestResponse(
                success=True,
                message=("Connection successful. Provider model list endpoint is unavailable; please add model IDs manually."),
                latency_ms=latency_ms,
            )
        except Exception as exc:  # pragma: no cover - branch tested through api behavior
            message = _sanitize_error_message(str(exc), [raw_api_key, api_key])
            return ModelConnectionTestResponse(
                success=False,
                message=f"Provider request failed: {message}",
            )

        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return ModelConnectionTestResponse(
            success=True,
            message="Connection successful",
            latency_ms=latency_ms,
        )

    provider_kwargs = _build_provider_init_kwargs(
        use=use,
        model=probe_model,
        api_key=api_key,
        api_base=api_base,
        provider_protocol=request.provider_protocol,
    )

    try:
        model_class = resolve_class(use, BaseChatModel)
        chat_model = model_class(**provider_kwargs)
    except Exception as exc:  # pragma: no cover - branch tested through api behavior
        message = _sanitize_error_message(str(exc), [raw_api_key, api_key])
        return ModelConnectionTestResponse(
            success=False,
            message=f"Failed to initialize provider: {message}",
        )

    started_at = time.perf_counter()
    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                chat_model.invoke,
                [HumanMessage(content=request.probe_message.strip())],
            ),
            timeout=request.timeout_seconds,
        )
    except TimeoutError:
        return ModelConnectionTestResponse(
            success=False,
            message=f"Connection timed out after {request.timeout_seconds:.0f}s",
        )
    except Exception as exc:  # pragma: no cover - branch tested through api behavior
        message = _sanitize_error_message(str(exc), [raw_api_key, api_key])
        return ModelConnectionTestResponse(
            success=False,
            message=f"Provider request failed: {message}",
        )

    latency_ms = int((time.perf_counter() - started_at) * 1000)
    return ModelConnectionTestResponse(
        success=True,
        message="Connection successful",
        latency_ms=latency_ms,
        response_preview=_extract_text_preview(response),
    )

