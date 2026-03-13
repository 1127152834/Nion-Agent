import json
import logging
import os
import sys
import shutil
import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from src.config.extensions_config import ExtensionsConfig, get_extensions_config, reload_extensions_config
from src.gateway.build_info import PROCESS_START_TIME

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mcp"])


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


class McpServerProbeResponse(BaseModel):
    success: bool = Field(..., description="Whether the probe succeeded")
    message: str = Field(..., description="Human-readable status message")
    tool_count: int = Field(default=0, description="Number of tools discovered from this server")
    tools: list[str] = Field(default_factory=list, description="Discovered tool names")


class McpPrerequisiteStatus(BaseModel):
    available: bool = Field(default=False, description="Whether the command is available")
    path: str | None = Field(default=None, description="Resolved path for the command, if found")


class McpPrerequisiteResponse(BaseModel):
    commands: dict[str, McpPrerequisiteStatus] = Field(default_factory=dict)


class McpToolchainEnsureResponse(BaseModel):
    installed: bool = Field(default=False, description="Whether the toolchain was installed during this request")
    message: str = Field(default="", description="Human-readable status message")
    commands: dict[str, McpPrerequisiteStatus] = Field(default_factory=dict)


class McpDebugInfoResponse(BaseModel):
    pid: int = Field(..., description="Current process ID")
    process_start_time: str = Field(..., description="Best-effort process start time (ISO 8601)")
    cwd: str = Field(..., description="Current working directory")
    python_executable: str = Field(..., description="Python executable path")
    router_file: str = Field(..., description="Loaded MCP router file path")
    router_mtime: str | None = Field(default=None, description="Router mtime (ISO 8601)")
    langchain_mcp_adapters_version: str | None = Field(default=None, description="Installed langchain-mcp-adapters version")
    nion_desktop_runtime: bool = Field(default=False, description="Whether running under Nion desktop runtime")
    app_is_packaged: bool = Field(default=False, description="Whether desktop app is packaged (best-effort)")


class MarketplaceMcpServerListItem(BaseModel):
    id: str
    name: str
    author: str | None = None
    category: str | None = None
    description: str
    tags: list[str] = Field(default_factory=list)
    verified: bool = False
    featured: bool = False
    version: str = "0.0.0"
    docs_url: str | None = None
    detail_url: str
    fingerprints: list[dict[str, Any]] = Field(default_factory=list, description="Install fingerprints for installed detection")


class MarketplaceMcpServerListResponse(BaseModel):
    servers: list[MarketplaceMcpServerListItem] = Field(default_factory=list)


class MarketplaceMcpServerDetailResponse(BaseModel):
    id: str
    name: str
    author: str | None = None
    category: str | None = None
    description: str
    tags: list[str] = Field(default_factory=list)
    verified: bool = False
    featured: bool = False
    version: str = "0.0.0"
    docs_url: str | None = None
    readme_markdown: str = ""
    demo_image_urls: list[str] = Field(default_factory=list)
    install_options: list[dict[str, Any]] = Field(default_factory=list)


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _env_truthy(value: str | None) -> bool:
    raw = str(value or "").strip().lower()
    return raw in {"1", "true", "yes", "y", "on"}


def _repo_root_dir() -> Path:
    return Path(__file__).resolve().parents[4]


def _mcp_marketplace_catalog_file() -> Path:
    if env_value := os.getenv("NION_MCP_MARKETPLACE_CATALOG"):
        return Path(env_value).expanduser().resolve()
    return (_repo_root_dir() / "backend" / "data" / "mcp_marketplace" / "catalog.json").resolve()


def _mcp_marketplace_assets_dir() -> Path:
    return (_repo_root_dir() / "backend" / "data" / "mcp_marketplace" / "assets").resolve()


def _load_mcp_marketplace_catalog() -> list[dict[str, Any]]:
    catalog_file = _mcp_marketplace_catalog_file()
    if not catalog_file.exists():
        return []
    try:
        payload = json.loads(catalog_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid MCP marketplace catalog JSON: {exc}") from exc
    servers = payload.get("servers")
    if not isinstance(servers, list):
        raise HTTPException(status_code=500, detail="MCP marketplace catalog missing `servers` list")
    normalized: list[dict[str, Any]] = []
    for item in servers:
        if isinstance(item, dict):
            normalized.append(item)
    return normalized


def _find_mcp_marketplace_entry(server_id: str) -> dict[str, Any]:
    for item in _load_mcp_marketplace_catalog():
        if str(item.get("id", "")).strip() == server_id:
            return item
    raise HTTPException(status_code=404, detail=f"MCP marketplace server not found: {server_id}")


def _entry_readme_markdown(entry: dict[str, Any]) -> str:
    asset_rel = str(entry.get("readme_asset", "")).strip().lstrip("/")
    if not asset_rel:
        return ""
    assets_dir = _mcp_marketplace_assets_dir()
    candidate = (assets_dir / asset_rel).resolve()
    try:
        candidate.relative_to(assets_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid marketplace asset path") from exc
    if not candidate.exists() or not candidate.is_file():
        return ""
    return candidate.read_text(encoding="utf-8")


def _entry_demo_image_urls(entry: dict[str, Any]) -> list[str]:
    images_raw = entry.get("demo_images")
    if not isinstance(images_raw, list):
        return []
    assets_dir = _mcp_marketplace_assets_dir()
    urls: list[str] = []
    for raw in images_raw:
        asset_rel = str(raw or "").strip().lstrip("/")
        if not asset_rel:
            continue
        candidate = (assets_dir / asset_rel).resolve()
        try:
            candidate.relative_to(assets_dir)
        except ValueError:
            continue
        if not candidate.exists() or not candidate.is_file():
            continue
        urls.append(f"/api/mcp/marketplace/assets/{quote(asset_rel)}")
    return urls


@router.get(
    "/mcp/config",
    response_model=McpConfigResponse,
    summary="Get MCP Configuration",
    description="Retrieve the current Model Context Protocol (MCP) server configurations.",
)
async def get_mcp_configuration() -> McpConfigResponse:
    """Get the current MCP configuration.

    Returns:
        The current MCP configuration with all servers.

    Example:
        ```json
        {
            "mcp_servers": {
                "github": {
                    "enabled": true,
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {"GITHUB_TOKEN": "ghp_xxx"},
                    "description": "GitHub MCP server for repository operations"
                }
            }
        }
        ```
    """
    config = get_extensions_config()

    return McpConfigResponse(mcp_servers={name: McpServerConfigResponse(**server.model_dump()) for name, server in config.mcp_servers.items()})


@router.put(
    "/mcp/config",
    response_model=McpConfigResponse,
    summary="Update MCP Configuration",
    description="Update Model Context Protocol (MCP) server configurations and save to file.",
)
async def update_mcp_configuration(request: McpConfigUpdateRequest) -> McpConfigResponse:
    """Update the MCP configuration.

    This will:
    1. Save the new configuration to the mcp_config.json file
    2. Reload the configuration cache
    3. Reset MCP tools cache to trigger reinitialization

    Args:
        request: The new MCP configuration to save.

    Returns:
        The updated MCP configuration.

    Raises:
        HTTPException: 500 if the configuration file cannot be written.

    Example Request:
        ```json
        {
            "mcp_servers": {
                "github": {
                    "enabled": true,
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"},
                    "description": "GitHub MCP server for repository operations"
                }
            }
        }
        ```
    """
    try:
        # Get the current config path (or determine where to save it)
        config_path = ExtensionsConfig.resolve_config_path()

        # If no config file exists, create one in the parent directory (project root)
        if config_path is None:
            config_path = Path.cwd().parent / "extensions_config.json"
            logger.info(f"No existing extensions config found. Creating new config at: {config_path}")

        # Load current config to preserve skills configuration
        current_config = get_extensions_config()

        # Convert request to dict format for JSON serialization
        config_data = {
            "mcpServers": {name: server.model_dump() for name, server in request.mcp_servers.items()},
            "skills": {name: {"enabled": skill.enabled} for name, skill in current_config.skills.items()},
            "clis": {name: cli.model_dump() for name, cli in current_config.clis.items()},
        }

        # Write the configuration to file
        with open(config_path, "w") as f:
            json.dump(config_data, f, indent=2)

        logger.info(f"MCP configuration updated and saved to: {config_path}")

        # NOTE: No need to reload/reset cache here - LangGraph Server (separate process)
        # will detect config file changes via mtime and reinitialize MCP tools automatically

        # Reload the configuration and update the global cache
        reloaded_config = reload_extensions_config()
        return McpConfigResponse(mcp_servers={name: McpServerConfigResponse(**server.model_dump()) for name, server in reloaded_config.mcp_servers.items()})

    except Exception as e:
        logger.error(f"Failed to update MCP configuration: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update MCP configuration: {str(e)}")


@router.get(
    "/mcp/servers/{server_name}/probe",
    response_model=McpServerProbeResponse,
    summary="Probe MCP server connection",
)
async def probe_mcp_server(server_name: str) -> McpServerProbeResponse:
    """Probe a single MCP server and return discovered tools."""
    try:
        config = ExtensionsConfig.from_file()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to load MCP config: {exc}") from exc

    server_config = config.mcp_servers.get(server_name)
    if server_config is None:
        raise HTTPException(status_code=404, detail=f"MCP server not found: {server_name}")

    if not server_config.enabled:
        return McpServerProbeResponse(success=False, message="Server is disabled", tool_count=0, tools=[])

    try:
        from src.mcp.client import build_server_params

        params = build_server_params(server_name, server_config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to prepare MCP server config: {exc}") from exc

    if server_config.type == "stdio":
        resolved_command = str(params.get("command") or "").strip()
        resolved = shutil.which(resolved_command)
        if resolved is None and resolved_command:
            raise HTTPException(
                status_code=400,
                detail=f"Command not found: {resolved_command}. Please install it and try again.",
            )

    servers_config: dict[str, dict[str, Any]] = {server_name: params}

    def _redact_probe_message(text: str) -> str:
        raw = str(text or "")
        if not raw:
            return raw

        redacted = raw

        # Redact well-known bearer patterns.
        import re

        redacted = re.sub(r"Bearer\\s+[^\\s\\\"']+", "Bearer ******", redacted, flags=re.IGNORECASE)

        # Redact configured env/header values if they accidentally appear.
        for value in (server_config.env or {}).values():
            if isinstance(value, str) and value:
                redacted = redacted.replace(value, "******")
        for value in (server_config.headers or {}).values():
            if isinstance(value, str) and value:
                redacted = redacted.replace(value, "******")

        # Redact common secret CLI arg patterns if they appear in logs/errors.
        secret_flags = {
            "--api-key",
            "--token",
            "--access-token",
            "--secret",
            "--authorization",
            "--auth",
            "--password",
            "--key",
        }
        args_list = list(server_config.args or [])
        for i, arg in enumerate(args_list):
            if not isinstance(arg, str) or not arg:
                continue
            if "=" in arg:
                flag, value = arg.split("=", 1)
                if flag in secret_flags and value:
                    redacted = redacted.replace(value, "******")
                continue
            if arg in secret_flags and i + 1 < len(args_list):
                next_value = args_list[i + 1]
                if isinstance(next_value, str) and next_value:
                    redacted = redacted.replace(next_value, "******")
        return redacted

    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient

        from src.mcp.oauth import build_oauth_tool_interceptor, get_initial_oauth_headers

        # Inject initial OAuth headers for discovery/session init.
        initial_oauth_headers = await get_initial_oauth_headers(config)
        auth_header = initial_oauth_headers.get(server_name)
        if auth_header and servers_config[server_name].get("transport") in ("sse", "streamable_http"):
            existing = dict(servers_config[server_name].get("headers", {}))
            existing["Authorization"] = auth_header
            servers_config[server_name]["headers"] = existing

        tool_interceptors: list[Any] = []
        oauth_interceptor = build_oauth_tool_interceptor(config)
        if oauth_interceptor is not None:
            tool_interceptors.append(oauth_interceptor)

        timeout_seconds = float(os.getenv("NION_MCP_PROBE_TIMEOUT_SECONDS") or "30")
        # First run of package-manager based stdio servers (e.g. npx/uvx) may
        # take longer due to dependency downloads.
        if server_config.type == "stdio":
            command_name = str(params.get("command") or "").strip().split("/")[-1]
            if command_name in ("npx", "uvx"):
                timeout_seconds = max(timeout_seconds, 60.0)
        client = MultiServerMCPClient(servers_config, tool_interceptors=tool_interceptors)
        try:
            tools = await asyncio.wait_for(
                client.get_tools(server_name=server_name),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Probe timed out after {int(timeout_seconds)}s. Please check prerequisites and try again.",
            ) from exc

        tool_names: list[str] = []
        for tool in tools or []:
            name = getattr(tool, "name", None)
            if isinstance(name, str) and name.strip():
                tool_names.append(name.strip())

        return McpServerProbeResponse(
            success=True,
            message="OK",
            tool_count=len(tool_names),
            tools=tool_names,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        message = _redact_probe_message(str(exc))
        logger.error("Failed to probe MCP server %s: %s", server_name, message)
        raise HTTPException(status_code=500, detail=f"Probe failed: {message}") from exc


@router.get(
    "/mcp/_debug",
    response_model=McpDebugInfoResponse,
    summary="MCP debug info",
    description="Return debug/runtime info for MCP endpoints to help diagnose stale builds and environment issues.",
)
async def get_mcp_debug_info() -> McpDebugInfoResponse:
    router_file = Path(__file__).resolve()
    router_mtime: str | None = None
    try:
        router_mtime = datetime.fromtimestamp(router_file.stat().st_mtime, tz=UTC).isoformat()
    except Exception:  # noqa: BLE001
        router_mtime = None

    adapters_version: str | None = None
    try:
        import importlib.metadata as importlib_metadata

        adapters_version = importlib_metadata.version("langchain-mcp-adapters")
    except Exception:  # noqa: BLE001
        adapters_version = None

    return McpDebugInfoResponse(
        pid=os.getpid(),
        process_start_time=PROCESS_START_TIME.isoformat(),
        cwd=os.getcwd(),
        python_executable=sys.executable,
        router_file=str(router_file),
        router_mtime=router_mtime,
        langchain_mcp_adapters_version=adapters_version,
        nion_desktop_runtime=_env_truthy(os.getenv("NION_DESKTOP_RUNTIME")),
        app_is_packaged=_env_truthy(os.getenv("NION_APP_IS_PACKAGED")),
    )


@router.get(
    "/mcp/marketplace/servers",
    response_model=MarketplaceMcpServerListResponse,
    summary="List MCP marketplace servers",
)
async def list_mcp_marketplace_servers() -> MarketplaceMcpServerListResponse:
    items: list[MarketplaceMcpServerListItem] = []
    for entry in _load_mcp_marketplace_catalog():
        server_id = str(entry.get("id", "")).strip()
        if not server_id:
            continue
        fingerprints: list[dict[str, Any]] = []
        install_options_raw = entry.get("install_options")
        if isinstance(install_options_raw, list):
            for opt in install_options_raw:
                if not isinstance(opt, dict):
                    continue
                transport = str(opt.get("transport") or "").strip()
                template = opt.get("template")
                if not isinstance(template, dict):
                    template = {}
                if transport == "stdio":
                    command = template.get("command")
                    args = template.get("args")
                    if isinstance(command, str) and command.strip():
                        fingerprints.append(
                            {
                                "transport": "stdio",
                                "command": command.strip(),
                                "args_prefix": [str(a) for a in (args or []) if str(a).strip()] if isinstance(args, list) else [],
                            },
                        )
                elif transport in ("http", "sse"):
                    url = template.get("url")
                    if isinstance(url, str) and url.strip():
                        fingerprints.append(
                            {
                                "transport": transport,
                                "url": url.strip(),
                            },
                        )
        try:
            items.append(
                MarketplaceMcpServerListItem(
                    id=server_id,
                    name=str(entry.get("name") or server_id),
                    author=str(entry.get("author") or "") or None,
                    category=str(entry.get("category") or "") or None,
                    description=str(entry.get("description") or "No description"),
                    tags=[str(tag) for tag in entry.get("tags", []) if str(tag).strip()],
                    verified=bool(entry.get("verified")),
                    featured=bool(entry.get("featured")),
                    version=str(entry.get("version") or "0.0.0"),
                    docs_url=str(entry.get("docs_url") or "") or None,
                    detail_url=f"/api/mcp/marketplace/servers/{server_id}",
                    fingerprints=fingerprints,
                ),
            )
        except Exception:  # noqa: BLE001
            # Keep listing resilient to malformed entries.
            continue
    return MarketplaceMcpServerListResponse(servers=items)


@router.get(
    "/mcp/prerequisites",
    response_model=McpPrerequisiteResponse,
    summary="Check MCP server prerequisites",
)
async def check_mcp_prerequisites(commands: str | None = None) -> McpPrerequisiteResponse:
    if not commands:
        return McpPrerequisiteResponse(commands={})

    from src.mcp.toolchains import resolve_managed_command

    result: dict[str, McpPrerequisiteStatus] = {}
    for raw in commands.split(","):
        name = raw.strip()
        if not name:
            continue
        resolved = shutil.which(name)
        if resolved is None:
            managed = resolve_managed_command(name)
            if managed is not None and managed.exists():
                resolved = str(managed)
        result[name] = McpPrerequisiteStatus(
            available=resolved is not None,
            path=resolved,
        )

    return McpPrerequisiteResponse(commands=result)


@router.post(
    "/mcp/toolchains/node/ensure",
    response_model=McpToolchainEnsureResponse,
    summary="Ensure Node.js toolchain (node/npm/npx) is installed",
)
async def ensure_mcp_node_toolchain() -> McpToolchainEnsureResponse:
    try:
        from src.mcp.toolchains import ensure_node_toolchain

        toolchain, installed_now = await ensure_node_toolchain()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to ensure Node toolchain: {exc}") from exc

    message = (
        f"Installed Node {toolchain.version} to {toolchain.root_dir}"
        if installed_now
        else f"Node toolchain ready ({toolchain.version})"
    )

    return McpToolchainEnsureResponse(
        installed=installed_now,
        message=message,
        commands={
            "node": McpPrerequisiteStatus(available=True, path=str(toolchain.node_path)),
            "npm": McpPrerequisiteStatus(available=True, path=str(toolchain.npm_path)),
            "npx": McpPrerequisiteStatus(available=True, path=str(toolchain.npx_path)),
        },
    )


@router.get(
    "/mcp/marketplace/servers/{server_id}",
    response_model=MarketplaceMcpServerDetailResponse,
    summary="Get MCP marketplace server detail",
)
async def get_mcp_marketplace_server_detail(server_id: str) -> MarketplaceMcpServerDetailResponse:
    entry = _find_mcp_marketplace_entry(server_id)
    readme = _entry_readme_markdown(entry)
    name = str(entry.get("name") or server_id)
    description = str(entry.get("description") or "No description")
    if not readme:
        readme = f"# {name}\n\n{description}\n"
    install_options_raw = entry.get("install_options")
    install_options: list[dict[str, Any]] = []
    if isinstance(install_options_raw, list):
        for item in install_options_raw:
            if isinstance(item, dict):
                install_options.append(item)
    return MarketplaceMcpServerDetailResponse(
        id=server_id,
        name=name,
        author=str(entry.get("author") or "") or None,
        category=str(entry.get("category") or "") or None,
        description=description,
        tags=[str(tag) for tag in entry.get("tags", []) if str(tag).strip()],
        verified=bool(entry.get("verified")),
        featured=bool(entry.get("featured")),
        version=str(entry.get("version") or "0.0.0"),
        docs_url=str(entry.get("docs_url") or "") or None,
        readme_markdown=readme,
        demo_image_urls=_entry_demo_image_urls(entry),
        install_options=install_options,
    )


@router.get(
    "/mcp/marketplace/assets/{asset_path:path}",
    summary="Read MCP marketplace asset",
)
async def read_mcp_marketplace_asset(asset_path: str) -> FileResponse:
    normalized = asset_path.lstrip("/")
    if not normalized:
        raise HTTPException(status_code=404, detail="Asset path is empty")
    assets_dir = _mcp_marketplace_assets_dir()
    candidate = (assets_dir / normalized).resolve()
    try:
        candidate.relative_to(assets_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid marketplace asset path") from exc
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Marketplace asset not found: {asset_path}")
    return FileResponse(path=candidate)
