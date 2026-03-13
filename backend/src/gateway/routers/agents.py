"""CRUD API for custom agents."""

import json
import logging
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from src.agents.memory.governor import get_memory_governor
from src.config.agents_config import AgentConfig, list_custom_agents, load_agent_config, load_agent_soul
from src.config.default_agent import DEFAULT_AGENT_NAME, ensure_default_agent
from src.config.paths import get_paths

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["agents"])

AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")
MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024
ALLOWED_AVATAR_MIME_TO_EXT: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
ALLOWED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


class AgentResponse(BaseModel):
    """Response model for a custom agent."""

    name: str = Field(..., description="Agent name (hyphen-case)")
    display_name: str | None = Field(default=None, description="Optional display name for UI (can be non-ASCII)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    heartbeat_enabled: bool = Field(default=True, description="Whether heartbeat is enabled")
    evolution_enabled: bool = Field(default=True, description="Whether evolution is enabled")
    avatar_url: str | None = Field(default=None, description="Avatar URL for UI display")
    soul: str | None = Field(default=None, description="SOUL.md content (included on GET /{name})")


class AgentsListResponse(BaseModel):
    """Response model for listing all custom agents."""

    agents: list[AgentResponse]


class AgentCreateRequest(BaseModel):
    """Request body for creating a custom agent."""

    name: str = Field(..., description="Agent name (must match ^[A-Za-z0-9-]+$, stored as lowercase)")
    display_name: str | None = Field(default=None, description="Optional display name (can be non-ASCII)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    soul: str = Field(default="", description="SOUL.md content — agent personality and behavioral guardrails")


class AgentUpdateRequest(BaseModel):
    """Request body for updating a custom agent."""

    display_name: str | None = Field(default=None, description="Updated display name (can be non-ASCII)")
    description: str | None = Field(default=None, description="Updated description")
    model: str | None = Field(default=None, description="Updated model override")
    tool_groups: list[str] | None = Field(default=None, description="Updated tool group whitelist")
    soul: str | None = Field(default=None, description="Updated SOUL.md content")


class DefaultAgentConfigResponse(BaseModel):
    """Response model for default agent config."""

    name: str = Field(default=DEFAULT_AGENT_NAME, description="Reserved default agent name")
    description: str = Field(default="", description="Default agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    heartbeat_enabled: bool = Field(default=True, description="Whether heartbeat is enabled")
    evolution_enabled: bool = Field(default=True, description="Whether evolution is enabled")
    avatar_url: str | None = Field(default=None, description="Avatar URL for UI display")


class DefaultAgentConfigUpdateRequest(BaseModel):
    """Request body for updating default agent config."""

    description: str | None = Field(default=None, description="Updated description")
    model: str | None = Field(default=None, description="Updated model override")
    tool_groups: list[str] | None = Field(default=None, description="Updated tool group whitelist")
    heartbeat_enabled: bool | None = Field(default=None, description="Updated heartbeat switch")
    evolution_enabled: bool | None = Field(default=None, description="Updated evolution switch")


def _validate_agent_name(name: str) -> None:
    """Validate agent name against allowed pattern.

    Args:
        name: The agent name to validate.

    Raises:
        HTTPException: 422 if the name is invalid.
    """
    if not AGENT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid agent name '{name}'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).",
        )


def _normalize_agent_name(name: str) -> str:
    """Normalize agent name to lowercase for filesystem storage."""
    return name.lower()


def _is_default_agent_name(name: str) -> bool:
    """Return whether the provided name points to the reserved default agent."""
    return _normalize_agent_name(name) == DEFAULT_AGENT_NAME


def _avatar_url_for_agent(agent_name: str, avatar_path: str | None) -> str | None:
    """Return public avatar URL if avatar exists on disk."""
    if not avatar_path:
        return None
    avatar_file = _resolve_avatar_file(agent_name, avatar_path)
    if not avatar_file:
        return None
    if agent_name == DEFAULT_AGENT_NAME:
        return "/api/default-agent/avatar"
    return f"/api/agents/{agent_name}/avatar"


def _resolve_avatar_file(agent_name: str, avatar_path: str | None) -> Path | None:
    """Resolve avatar file path and ensure it stays inside agent dir."""
    if not avatar_path:
        return None

    agent_dir = get_paths().agent_dir(agent_name)
    candidate = (agent_dir / avatar_path).resolve()
    try:
        candidate.relative_to(agent_dir.resolve())
    except ValueError:
        logger.warning("Avatar path traversal blocked for %s: %s", agent_name, avatar_path)
        return None

    if not candidate.is_file():
        return None
    return candidate


def _avatar_extension_from_upload(file: UploadFile) -> str:
    """Infer and validate avatar extension from upload metadata."""
    if file.content_type in ALLOWED_AVATAR_MIME_TO_EXT:
        return ALLOWED_AVATAR_MIME_TO_EXT[file.content_type]

    ext = Path(file.filename or "").suffix.lower()
    if ext in ALLOWED_AVATAR_EXTENSIONS:
        if ext == ".jpeg":
            return ".jpg"
        return ext

    allowed = ", ".join(sorted(ALLOWED_AVATAR_MIME_TO_EXT))
    raise HTTPException(status_code=415, detail=f"Unsupported avatar type. Allowed: {allowed}")


async def _read_avatar_payload(file: UploadFile) -> bytes:
    """Read and validate avatar upload payload."""
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Avatar file is empty")
    if len(payload) > MAX_AVATAR_SIZE_BYTES:
        raise HTTPException(status_code=413, detail=f"Avatar too large. Max size: {MAX_AVATAR_SIZE_BYTES} bytes")
    return payload


def _remove_existing_agent_avatars(agent_name: str) -> None:
    """Delete existing avatar files for an agent."""
    agent_dir = get_paths().agent_dir(agent_name)
    for path in agent_dir.glob("avatar.*"):
        if path.is_file():
            path.unlink(missing_ok=True)


def _set_agent_avatar_path(agent_name: str, avatar_path: str | None) -> None:
    """Persist avatar path into agent.json."""
    config_file = get_paths().agent_config_file(agent_name)
    try:
        with open(config_file, encoding="utf-8") as f:
            config_data: dict[str, Any] = json.load(f)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found") from e
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse agent config: {e}") from e

    if avatar_path:
        config_data["avatar_path"] = avatar_path
    else:
        config_data.pop("avatar_path", None)

    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2, ensure_ascii=False)


def _avatar_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    return "application/octet-stream"


def _load_default_agent_config_dict() -> dict[str, Any]:
    """Load default agent config from disk."""
    ensure_default_agent()
    config_file = get_paths().agent_config_file(DEFAULT_AGENT_NAME)
    if not config_file.exists():
        raise HTTPException(status_code=404, detail="Default agent config not found")

    try:
        with open(config_file, encoding="utf-8") as f:
            data: dict[str, Any] = json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse default agent config: {e}") from e
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to read default agent config: {e}") from e

    avatar_path = data.get("avatar_path")
    return {
        "name": DEFAULT_AGENT_NAME,
        "description": data.get("description", ""),
        "model": data.get("model"),
        "tool_groups": data.get("tool_groups"),
        "heartbeat_enabled": bool(data.get("heartbeat_enabled", True)),
        "evolution_enabled": bool(data.get("evolution_enabled", True)),
        "avatar_url": _avatar_url_for_agent(DEFAULT_AGENT_NAME, avatar_path),
        "avatar_path": avatar_path,
    }


def _save_default_agent_config(config: dict[str, Any]) -> None:
    """Persist default agent config atomically."""
    config_file = get_paths().agent_config_file(DEFAULT_AGENT_NAME)
    config_file.parent.mkdir(parents=True, exist_ok=True)
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def _agent_config_to_response(agent_cfg: AgentConfig, include_soul: bool = False) -> AgentResponse:
    """Convert AgentConfig to AgentResponse."""
    soul: str | None = None
    if include_soul:
        soul = load_agent_soul(agent_cfg.name) or ""

    return AgentResponse(
        name=agent_cfg.name,
        display_name=agent_cfg.display_name,
        description=agent_cfg.description,
        model=agent_cfg.model,
        tool_groups=agent_cfg.tool_groups,
        heartbeat_enabled=agent_cfg.heartbeat_enabled,
        evolution_enabled=agent_cfg.evolution_enabled,
        avatar_url=_avatar_url_for_agent(agent_cfg.name, agent_cfg.avatar_path),
        soul=soul,
    )


def _refresh_memory_catalog_safe() -> None:
    """Best-effort catalog refresh after agent asset/config changes."""
    try:
        get_memory_governor().refresh_agent_catalog()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Skip memory catalog refresh: %s", exc)


@router.get(
    "/agents",
    response_model=AgentsListResponse,
    summary="List Custom Agents",
    description="List all custom agents available in the agents directory.",
)
async def list_agents() -> AgentsListResponse:
    """List all custom agents.

    Returns:
        List of all custom agents with their metadata (without soul content).
    """
    try:
        agents = list_custom_agents()
        return AgentsListResponse(agents=[_agent_config_to_response(a) for a in agents])
    except Exception as e:
        logger.error(f"Failed to list agents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list agents: {str(e)}")


@router.get(
    "/agents/check",
    summary="Check Agent Name",
    description="Validate an agent name and check if it is available (case-insensitive).",
)
async def check_agent_name(name: str) -> dict:
    """Check whether an agent name is valid and not yet taken.

    Args:
        name: The agent name to check.

    Returns:
        ``{"available": true/false, "name": "<normalized>"}``

    Raises:
        HTTPException: 422 if the name is invalid.
    """
    _validate_agent_name(name)
    normalized = _normalize_agent_name(name)
    available = not get_paths().agent_dir(normalized).exists()
    return {"available": available, "name": normalized}


@router.get(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Get Custom Agent",
    description="Retrieve details and SOUL.md content for a specific custom agent.",
)
async def get_agent(name: str) -> AgentResponse:
    """Get a specific custom agent by name.

    Args:
        name: The agent name.

    Returns:
        Agent details including SOUL.md content.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        agent_cfg = load_agent_config(name)
        return _agent_config_to_response(agent_cfg, include_soul=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    except Exception as e:
        logger.error(f"Failed to get agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get agent: {str(e)}")


@router.get(
    "/agents/{name}/avatar",
    summary="Get Agent Avatar",
    description="Read avatar image for a custom agent.",
)
async def get_agent_avatar(name: str) -> FileResponse:
    """Get avatar image for a custom agent."""
    _validate_agent_name(name)
    normalized_name = _normalize_agent_name(name)
    try:
        agent_cfg = load_agent_config(normalized_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"Agent '{normalized_name}' not found") from e

    avatar_file = _resolve_avatar_file(normalized_name, agent_cfg.avatar_path)
    if avatar_file is None:
        raise HTTPException(status_code=404, detail=f"Avatar not found for agent '{normalized_name}'")
    return FileResponse(
        path=avatar_file,
        media_type=_avatar_media_type(avatar_file),
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/agents/{name}/avatar",
    response_model=AgentResponse,
    summary="Upload Agent Avatar",
    description="Upload avatar image for a custom agent.",
)
async def upload_agent_avatar(name: str, file: UploadFile = File(...)) -> AgentResponse:
    """Upload avatar image for a custom agent."""
    _validate_agent_name(name)
    normalized_name = _normalize_agent_name(name)
    try:
        load_agent_config(normalized_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"Agent '{normalized_name}' not found") from e

    ext = _avatar_extension_from_upload(file)
    payload = await _read_avatar_payload(file)
    _remove_existing_agent_avatars(normalized_name)

    avatar_file = get_paths().agent_dir(normalized_name) / f"avatar{ext}"
    avatar_file.write_bytes(payload)
    _set_agent_avatar_path(normalized_name, avatar_file.name)
    _refresh_memory_catalog_safe()

    refreshed_cfg = load_agent_config(normalized_name)
    return _agent_config_to_response(refreshed_cfg, include_soul=False)


@router.delete(
    "/agents/{name}/avatar",
    response_model=AgentResponse,
    summary="Delete Agent Avatar",
    description="Delete avatar image for a custom agent.",
)
async def delete_agent_avatar(name: str) -> AgentResponse:
    """Delete avatar image for a custom agent."""
    _validate_agent_name(name)
    normalized_name = _normalize_agent_name(name)
    try:
        load_agent_config(normalized_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"Agent '{normalized_name}' not found") from e

    _remove_existing_agent_avatars(normalized_name)
    _set_agent_avatar_path(normalized_name, None)
    _refresh_memory_catalog_safe()

    refreshed_cfg = load_agent_config(normalized_name)
    return _agent_config_to_response(refreshed_cfg, include_soul=False)


@router.post(
    "/agents",
    response_model=AgentResponse,
    status_code=201,
    summary="Create Custom Agent",
    description="Create a new custom agent with its config and SOUL.md.",
)
async def create_agent_endpoint(request: AgentCreateRequest) -> AgentResponse:
    """Create a new custom agent.

    Args:
        request: The agent creation request.

    Returns:
        The created agent details.

    Raises:
        HTTPException: 409 if agent already exists, 422 if name is invalid.
    """
    _validate_agent_name(request.name)
    normalized_name = _normalize_agent_name(request.name)

    agent_dir = get_paths().agent_dir(normalized_name)

    if agent_dir.exists():
        raise HTTPException(status_code=409, detail=f"Agent '{normalized_name}' already exists")

    try:
        agent_dir.mkdir(parents=True, exist_ok=True)

        # Write agent.json
        config_data: dict = {
            "name": normalized_name,
            "display_name": request.display_name.strip() if request.display_name and request.display_name.strip() else None,
            "description": request.description,
            "heartbeat_enabled": True,
            "evolution_enabled": True,
        }
        if config_data.get("display_name") is None:
            config_data.pop("display_name", None)
        if request.model is not None:
            config_data["model"] = request.model
        if request.tool_groups is not None:
            config_data["tool_groups"] = request.tool_groups

        config_file = get_paths().agent_config_file(normalized_name)
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        # Write SOUL.md
        soul_file = agent_dir / "SOUL.md"
        soul_file.write_text(request.soul, encoding="utf-8")

        logger.info(f"Created agent '{normalized_name}' at {agent_dir}")
        _refresh_memory_catalog_safe()

        agent_cfg = load_agent_config(normalized_name)
        return _agent_config_to_response(agent_cfg, include_soul=True)

    except HTTPException:
        raise
    except Exception as e:
        # Clean up on failure
        if agent_dir.exists():
            shutil.rmtree(agent_dir)
        logger.error(f"Failed to create agent '{request.name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create agent: {str(e)}")


@router.put(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Update Custom Agent",
    description="Update an existing custom agent's config and/or SOUL.md.",
)
async def update_agent(name: str, request: AgentUpdateRequest) -> AgentResponse:
    """Update an existing custom agent.

    Args:
        name: The agent name.
        request: The update request (all fields optional).

    Returns:
        The updated agent details.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        agent_cfg = load_agent_config(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    agent_dir = get_paths().agent_dir(name)

    try:
        # Update config if any config fields changed
        config_changed = any(v is not None for v in [request.display_name, request.description, request.model, request.tool_groups])

        if config_changed:
            updated: dict = {
                "name": agent_cfg.name,
                "display_name": agent_cfg.display_name,
                "description": request.description if request.description is not None else agent_cfg.description,
                "heartbeat_enabled": agent_cfg.heartbeat_enabled,
                "evolution_enabled": agent_cfg.evolution_enabled,
            }
            next_display_name = request.display_name if request.display_name is not None else agent_cfg.display_name
            if next_display_name and str(next_display_name).strip():
                updated["display_name"] = str(next_display_name).strip()
            else:
                updated.pop("display_name", None)
            new_model = request.model if request.model is not None else agent_cfg.model
            if new_model is not None:
                updated["model"] = new_model

            new_tool_groups = request.tool_groups if request.tool_groups is not None else agent_cfg.tool_groups
            if new_tool_groups is not None:
                updated["tool_groups"] = new_tool_groups
            if agent_cfg.avatar_path is not None:
                updated["avatar_path"] = agent_cfg.avatar_path

            config_file = get_paths().agent_config_file(name)
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(updated, f, indent=2, ensure_ascii=False)

        # Update SOUL.md if provided
        if request.soul is not None:
            soul_path = agent_dir / "SOUL.md"
            soul_path.write_text(request.soul, encoding="utf-8")

        logger.info(f"Updated agent '{name}'")
        _refresh_memory_catalog_safe()

        refreshed_cfg = load_agent_config(name)
        return _agent_config_to_response(refreshed_cfg, include_soul=True)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update agent: {str(e)}")


class UserProfileResponse(BaseModel):
    """Response model for the global user profile (USER.md)."""

    content: str | None = Field(default=None, description="USER.md content, or null if not yet created")


class UserProfileUpdateRequest(BaseModel):
    """Request body for setting the global user profile."""

    content: str = Field(default="", description="USER.md content — describes the user's background and preferences")


@router.get(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Get User Profile",
    description="Read the global USER.md file that is injected into all custom agents.",
)
async def get_user_profile() -> UserProfileResponse:
    """Return the current USER.md content.

    Returns:
        UserProfileResponse with content=None if USER.md does not exist yet.
    """
    try:
        user_md_path = get_paths().user_md_file
        if not user_md_path.exists():
            return UserProfileResponse(content=None)
        raw = user_md_path.read_text(encoding="utf-8").strip()
        return UserProfileResponse(content=raw or None)
    except Exception as e:
        logger.error(f"Failed to read user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read user profile: {str(e)}")


@router.put(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Update User Profile",
    description="Write the global USER.md file that is injected into all custom agents.",
)
async def update_user_profile(request: UserProfileUpdateRequest) -> UserProfileResponse:
    """Create or overwrite the global USER.md.

    Args:
        request: The update request with the new USER.md content.

    Returns:
        UserProfileResponse with the saved content.
    """
    try:
        paths = get_paths()
        paths.base_dir.mkdir(parents=True, exist_ok=True)
        paths.user_md_file.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated USER.md at {paths.user_md_file}")
        return UserProfileResponse(content=request.content or None)
    except Exception as e:
        logger.error(f"Failed to update user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update user profile: {str(e)}")


@router.get(
    "/default-agent/config",
    response_model=DefaultAgentConfigResponse,
    summary="Get Default Agent Config",
    description="Read default agent config fields from agent.json.",
)
async def get_default_agent_config() -> DefaultAgentConfigResponse:
    """Get default agent editable config."""
    return DefaultAgentConfigResponse(**_load_default_agent_config_dict())


@router.put(
    "/default-agent/config",
    response_model=DefaultAgentConfigResponse,
    summary="Update Default Agent Config",
    description="Update editable fields of default agent config.",
)
async def update_default_agent_config(request: DefaultAgentConfigUpdateRequest) -> DefaultAgentConfigResponse:
    """Update default agent config while keeping its reserved name immutable."""
    current = _load_default_agent_config_dict()
    updated = {
        "name": DEFAULT_AGENT_NAME,
        "description": request.description if request.description is not None else current["description"],
        "heartbeat_enabled": request.heartbeat_enabled if request.heartbeat_enabled is not None else current["heartbeat_enabled"],
        "evolution_enabled": request.evolution_enabled if request.evolution_enabled is not None else current["evolution_enabled"],
    }

    model_value = request.model if request.model is not None else current["model"]
    if model_value is not None:
        updated["model"] = model_value

    tool_groups_value = request.tool_groups if request.tool_groups is not None else current["tool_groups"]
    if tool_groups_value is not None:
        updated["tool_groups"] = tool_groups_value
    if current.get("avatar_path") is not None:
        updated["avatar_path"] = current["avatar_path"]

    _save_default_agent_config(updated)
    _refresh_memory_catalog_safe()
    return DefaultAgentConfigResponse(**_load_default_agent_config_dict())


@router.get(
    "/default-agent/avatar",
    summary="Get Default Agent Avatar",
    description="Read avatar image for the default agent.",
)
async def get_default_agent_avatar() -> FileResponse:
    """Get avatar image for the default agent."""
    current = _load_default_agent_config_dict()
    avatar_file = _resolve_avatar_file(DEFAULT_AGENT_NAME, current.get("avatar_path"))
    if avatar_file is None:
        raise HTTPException(status_code=404, detail="Default agent avatar not found")
    return FileResponse(
        path=avatar_file,
        media_type=_avatar_media_type(avatar_file),
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/default-agent/avatar",
    response_model=DefaultAgentConfigResponse,
    summary="Upload Default Agent Avatar",
    description="Upload avatar image for the default agent.",
)
async def upload_default_agent_avatar(file: UploadFile = File(...)) -> DefaultAgentConfigResponse:
    """Upload avatar image for the default agent."""
    ensure_default_agent()
    ext = _avatar_extension_from_upload(file)
    payload = await _read_avatar_payload(file)
    _remove_existing_agent_avatars(DEFAULT_AGENT_NAME)

    avatar_file = get_paths().agent_dir(DEFAULT_AGENT_NAME) / f"avatar{ext}"
    avatar_file.write_bytes(payload)

    current = _load_default_agent_config_dict()
    updated = {
        "name": DEFAULT_AGENT_NAME,
        "description": current["description"],
        "heartbeat_enabled": current["heartbeat_enabled"],
        "evolution_enabled": current["evolution_enabled"],
        "avatar_path": avatar_file.name,
    }
    if current["model"] is not None:
        updated["model"] = current["model"]
    if current["tool_groups"] is not None:
        updated["tool_groups"] = current["tool_groups"]

    _save_default_agent_config(updated)
    _refresh_memory_catalog_safe()
    return DefaultAgentConfigResponse(**_load_default_agent_config_dict())


@router.delete(
    "/default-agent/avatar",
    response_model=DefaultAgentConfigResponse,
    summary="Delete Default Agent Avatar",
    description="Delete avatar image for the default agent.",
)
async def delete_default_agent_avatar() -> DefaultAgentConfigResponse:
    """Delete avatar image for the default agent."""
    ensure_default_agent()
    _remove_existing_agent_avatars(DEFAULT_AGENT_NAME)

    current = _load_default_agent_config_dict()
    updated = {
        "name": DEFAULT_AGENT_NAME,
        "description": current["description"],
        "heartbeat_enabled": current["heartbeat_enabled"],
        "evolution_enabled": current["evolution_enabled"],
    }
    if current["model"] is not None:
        updated["model"] = current["model"]
    if current["tool_groups"] is not None:
        updated["tool_groups"] = current["tool_groups"]

    _save_default_agent_config(updated)
    _refresh_memory_catalog_safe()
    return DefaultAgentConfigResponse(**_load_default_agent_config_dict())


@router.delete(
    "/agents/{name}",
    status_code=204,
    summary="Delete Custom Agent",
    description="Delete a custom agent and all its files (config, SOUL.md, memory).",
)
async def delete_agent(name: str) -> None:
    """Delete a custom agent.

    Args:
        name: The agent name.

    Raises:
        HTTPException: 404 if agent not found.
    """
    if _is_default_agent_name(name):
        raise HTTPException(status_code=403, detail="Default agent cannot be deleted")

    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    agent_dir = get_paths().agent_dir(name)

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    try:
        shutil.rmtree(agent_dir)
        logger.info(f"Deleted agent '{name}' from {agent_dir}")
        _refresh_memory_catalog_safe()
    except Exception as e:
        logger.error(f"Failed to delete agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete agent: {str(e)}")


# ── Default Agent Soul/Identity Endpoints ────────────────────────────────


class DefaultAgentAssetResponse(BaseModel):
    """Response model for default agent soul/identity assets."""

    content: str | None = Field(default=None, description="Asset content, or null if not yet created")


class DefaultAgentAssetUpdateRequest(BaseModel):
    """Request body for updating default agent soul/identity assets."""

    content: str = Field(default="", description="Asset content")


@router.get(
    "/default-agent/soul",
    response_model=DefaultAgentAssetResponse,
    summary="Get Default Agent Soul",
    description="Read the default agent SOUL.md file.",
)
async def get_default_agent_soul() -> DefaultAgentAssetResponse:
    """Return the default agent SOUL.md content.

    Returns:
        DefaultAgentAssetResponse with content=None if SOUL.md does not exist yet.
    """
    try:
        soul_path = get_paths().agent_soul_file("_default")
        if not soul_path.exists():
            return DefaultAgentAssetResponse(content=None)
        raw = soul_path.read_text(encoding="utf-8").strip()
        return DefaultAgentAssetResponse(content=raw or None)
    except Exception as e:
        logger.error(f"Failed to read default agent soul: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read default agent soul: {str(e)}")


@router.put(
    "/default-agent/soul",
    response_model=DefaultAgentAssetResponse,
    summary="Update Default Agent Soul",
    description="Write the default agent SOUL.md file.",
)
async def update_default_agent_soul(request: DefaultAgentAssetUpdateRequest) -> DefaultAgentAssetResponse:
    """Create or overwrite the default agent SOUL.md.

    Args:
        request: The update request with the new SOUL.md content.

    Returns:
        DefaultAgentAssetResponse with the saved content.
    """
    try:
        ensure_default_agent()
        paths = get_paths()
        soul_path = paths.agent_soul_file("_default")
        soul_path.parent.mkdir(parents=True, exist_ok=True)
        soul_path.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated default agent SOUL.md at {soul_path}")
        _refresh_memory_catalog_safe()
        return DefaultAgentAssetResponse(content=request.content or None)
    except Exception as e:
        logger.error(f"Failed to update default agent soul: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update default agent soul: {str(e)}")


@router.get(
    "/default-agent/identity",
    response_model=DefaultAgentAssetResponse,
    summary="Get Default Agent Identity",
    description="Read the default agent IDENTITY.md file.",
)
async def get_default_agent_identity() -> DefaultAgentAssetResponse:
    """Return the default agent IDENTITY.md content.

    Returns:
        DefaultAgentAssetResponse with content=None if IDENTITY.md does not exist yet.
    """
    try:
        identity_path = get_paths().agent_identity_file("_default")
        if not identity_path.exists():
            return DefaultAgentAssetResponse(content=None)
        raw = identity_path.read_text(encoding="utf-8").strip()
        return DefaultAgentAssetResponse(content=raw or None)
    except Exception as e:
        logger.error(f"Failed to read default agent identity: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read default agent identity: {str(e)}")


@router.put(
    "/default-agent/identity",
    response_model=DefaultAgentAssetResponse,
    summary="Update Default Agent Identity",
    description="Write the default agent IDENTITY.md file.",
)
async def update_default_agent_identity(request: DefaultAgentAssetUpdateRequest) -> DefaultAgentAssetResponse:
    """Create or overwrite the default agent IDENTITY.md.

    Args:
        request: The update request with the new IDENTITY.md content.

    Returns:
        DefaultAgentAssetResponse with the saved content.
    """
    try:
        ensure_default_agent()
        paths = get_paths()
        identity_path = paths.agent_identity_file("_default")
        identity_path.parent.mkdir(parents=True, exist_ok=True)
        identity_path.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated default agent IDENTITY.md at {identity_path}")
        _refresh_memory_catalog_safe()
        return DefaultAgentAssetResponse(content=request.content or None)
    except Exception as e:
        logger.error(f"Failed to update default agent identity: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update default agent identity: {str(e)}")


@router.get(
    "/soul/default",
    response_model=DefaultAgentAssetResponse,
    summary="Get Default Soul (Alias)",
    description="Alias of GET /api/default-agent/soul for docs compatibility.",
)
async def get_default_soul_alias() -> DefaultAgentAssetResponse:
    return await get_default_agent_soul()


@router.put(
    "/soul/default",
    response_model=DefaultAgentAssetResponse,
    summary="Update Default Soul (Alias)",
    description="Alias of PUT /api/default-agent/soul for docs compatibility.",
)
async def update_default_soul_alias(request: DefaultAgentAssetUpdateRequest) -> DefaultAgentAssetResponse:
    return await update_default_agent_soul(request)


@router.get(
    "/soul/identity",
    response_model=DefaultAgentAssetResponse,
    summary="Get Default Identity (Alias)",
    description="Alias of GET /api/default-agent/identity for docs compatibility.",
)
async def get_default_identity_alias() -> DefaultAgentAssetResponse:
    return await get_default_agent_identity()


@router.put(
    "/soul/identity",
    response_model=DefaultAgentAssetResponse,
    summary="Update Default Identity (Alias)",
    description="Alias of PUT /api/default-agent/identity for docs compatibility.",
)
async def update_default_identity_alias(request: DefaultAgentAssetUpdateRequest) -> DefaultAgentAssetResponse:
    return await update_default_agent_identity(request)


# ── Custom Agent Identity Endpoints ───────────────────────────────────────


class AgentIdentityResponse(BaseModel):
    """Response model for agent identity content."""

    content: str = Field(default="", description="IDENTITY.md content")


class AgentIdentityUpdateRequest(BaseModel):
    """Request body for updating agent identity content."""

    content: str = Field(default="", description="IDENTITY.md content")


@router.get(
    "/agents/{name}/identity",
    response_model=AgentIdentityResponse,
    summary="Get Agent Identity",
    description="Read the agent's IDENTITY.md file.",
)
async def get_agent_identity(name: str) -> AgentIdentityResponse:
    """Return the agent's IDENTITY.md content.

    Args:
        name: The agent name.

    Returns:
        AgentIdentityResponse with the IDENTITY.md content (empty string if not exists).

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        # Verify agent exists
        load_agent_config(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    try:
        identity_path = get_paths().agent_identity_file(name)
        if not identity_path.exists():
            return AgentIdentityResponse(content="")
        raw = identity_path.read_text(encoding="utf-8")
        return AgentIdentityResponse(content=raw)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read agent identity '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read agent identity: {str(e)}")


@router.put(
    "/agents/{name}/identity",
    response_model=AgentIdentityResponse,
    summary="Update Agent Identity",
    description="Write the agent's IDENTITY.md file.",
)
async def update_agent_identity(name: str, request: AgentIdentityUpdateRequest) -> AgentIdentityResponse:
    """Create or overwrite the agent's IDENTITY.md.

    Args:
        name: The agent name.
        request: The update request with the new IDENTITY.md content.

    Returns:
        AgentIdentityResponse with the saved content.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        # Verify agent exists
        load_agent_config(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    try:
        paths = get_paths()
        identity_path = paths.agent_identity_file(name)
        identity_path.parent.mkdir(parents=True, exist_ok=True)
        identity_path.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated agent '{name}' IDENTITY.md at {identity_path}")
        _refresh_memory_catalog_safe()
        return AgentIdentityResponse(content=request.content)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update agent identity '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update agent identity: {str(e)}")


class SoulPreviewResponse(BaseModel):
    """Response model for soul preview (debugging)."""

    soul_section: str = Field(..., description="Rendered <soul> section")
    identity_section: str = Field(..., description="Rendered <identity> section")
    user_profile_section: str = Field(..., description="Rendered <user-profile> section")
    combined: str = Field(..., description="Combined soul + identity + user_profile output")


@router.get(
    "/soul/preview",
    response_model=SoulPreviewResponse,
    summary="Preview Soul Injection",
    description="Preview how soul assets will be injected into the agent prompt (for debugging).",
)
async def preview_soul_injection(
    agent_name: str | None = None,
    session_mode: str | None = None,
    memory_read: bool | None = None,
) -> SoulPreviewResponse:
    """Preview soul injection for debugging.

    Args:
        agent_name: Optional agent name (null = default agent).
        session_mode: Optional session mode for policy enforcement.
        memory_read: Optional memory_read flag for policy enforcement.

    Returns:
        SoulPreviewResponse with rendered sections.
    """
    try:
        from src.agents.lead_agent.prompt import get_agent_soul, get_user_profile

        # Get soul (includes both SOUL.md and IDENTITY.md)
        soul_output = get_agent_soul(agent_name)

        # Parse soul output to extract sections
        soul_section = ""
        identity_section = ""
        if "<soul>" in soul_output:
            soul_section = soul_output.split("<soul>")[1].split("</soul>")[0].strip() if "</soul>" in soul_output else ""
        if "<identity>" in soul_output:
            identity_section = soul_output.split("<identity>")[1].split("</identity>")[0].strip() if "</identity>" in soul_output else ""

        # Get user profile
        user_profile_output = get_user_profile(session_mode=session_mode, memory_read=memory_read)
        user_profile_section = ""
        if "<user-profile>" in user_profile_output:
            user_profile_section = user_profile_output.split("<user-profile>")[1].split("</user-profile>")[0].strip() if "</user-profile>" in user_profile_output else ""

        # Combined output
        combined = soul_output + "\n" + user_profile_output if user_profile_output else soul_output

        return SoulPreviewResponse(
            soul_section=soul_section,
            identity_section=identity_section,
            user_profile_section=user_profile_section,
            combined=combined,
        )
    except Exception as e:
        logger.error(f"Failed to preview soul injection: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to preview soul injection: {str(e)}")
