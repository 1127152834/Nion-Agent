from __future__ import annotations

import asyncio
import json
import logging
import os
import queue
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from src.cli.catalog import (
    CliMarketplaceCatalog,
    CliMarketplaceTool,
    default_cli_marketplace_assets_dir,
    default_cli_marketplace_catalog_file,
    load_cli_marketplace_catalog,
    repo_root_from_module,
)
from src.cli.install_jobs import (
    get_cli_install_job_snapshot,
    start_cli_install_job,
    subscribe_cli_install_job,
    unsubscribe_cli_install_job,
)
from src.cli.installer import CliInstallError, install_cli_tool, uninstall_cli_tool
from src.cli.manifests import load_cli_install_manifest
from src.config.extensions_config import CliStateConfig, ExtensionsConfig, get_extensions_config, reload_extensions_config
from src.config.paths import get_paths
from src.tools.builtins.confirmation_store import consume_confirmation_token, issue_confirmation_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["cli"])


class CliStateConfigResponse(BaseModel):
    enabled: bool = False
    source: Literal["managed", "system", "custom"] = "managed"
    exec: str | None = None
    model_config = ConfigDict(extra="allow")


class CliConfigResponse(BaseModel):
    clis: dict[str, CliStateConfigResponse] = Field(default_factory=dict)


class CliConfigUpdateRequest(BaseModel):
    clis: dict[str, CliStateConfigResponse] = Field(default_factory=dict)


class CliSetEnabledRequest(BaseModel):
    enabled: bool
    confirmation_token: str | None = None


class CliSetEnabledResponse(BaseModel):
    success: bool
    message: str
    tool_id: str
    enabled: bool
    requires_confirmation: bool = False
    confirmation_token: str | None = None


class MarketplaceCliToolListItem(BaseModel):
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
    install_kind: str | None = None
    detail_url: str


class MarketplaceCliToolListResponse(BaseModel):
    tools: list[MarketplaceCliToolListItem] = Field(default_factory=list)


class MarketplaceCliToolDetailResponse(BaseModel):
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
    platforms: list[dict[str, Any]] = Field(default_factory=list)


class CliInstallRequest(BaseModel):
    tool_id: str = Field(..., description="CLI marketplace tool id")


class CliInstallResponse(BaseModel):
    success: bool
    message: str
    tool_id: str
    enabled: bool = False
    bins: list[str] = Field(default_factory=list)


class CliInstallJobStartRequest(BaseModel):
    tool_id: str = Field(..., description="CLI marketplace tool id")


class CliInstallJobStartResponse(BaseModel):
    success: bool
    message: str
    job_id: str
    tool_id: str


class CliInstallJobStatusResponse(BaseModel):
    success: bool
    job_id: str
    tool_id: str
    status: str
    message: str
    last_log_line: str = ""
    logs_tail: list[str] = Field(default_factory=list)
    result: dict[str, Any] | None = None


class CliUninstallRequest(BaseModel):
    tool_id: str
    keep_config: bool = True


class CliUninstallResponse(BaseModel):
    success: bool
    message: str
    tool_id: str


class CliProbeResponse(BaseModel):
    success: bool
    message: str
    installed: bool = False
    tool_id: str
    bins: list[str] = Field(default_factory=list)


class DiscoveredCliBin(BaseModel):
    name: str
    path: str


class DiscoveredCliTool(BaseModel):
    tool_id: str
    bins: list[DiscoveredCliBin] = Field(default_factory=list)


class CliDiscoverResponse(BaseModel):
    tools: list[DiscoveredCliTool] = Field(default_factory=list)
    candidates: list[DiscoveredCliBin] = Field(default_factory=list)


class CliPrerequisiteStatus(BaseModel):
    available: bool
    path: str | None = None


class CliPrerequisiteResponse(BaseModel):
    commands: dict[str, CliPrerequisiteStatus] = Field(default_factory=dict)


class CliToolchainEnsureResponse(BaseModel):
    installed: bool
    message: str
    commands: dict[str, CliPrerequisiteStatus] = Field(default_factory=dict)


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _repo_root_dir() -> Path:
    return repo_root_from_module(__file__)


def _cli_marketplace_catalog_file() -> Path:
    return default_cli_marketplace_catalog_file(_repo_root_dir())


def _cli_marketplace_assets_dir() -> Path:
    return default_cli_marketplace_assets_dir(_repo_root_dir())


def _load_catalog() -> CliMarketplaceCatalog:
    catalog_file = _cli_marketplace_catalog_file()
    if not catalog_file.exists():
        return CliMarketplaceCatalog(tools=[])
    return load_cli_marketplace_catalog(catalog_file)


def _find_tool(tool_id: str) -> CliMarketplaceTool:
    for tool in _load_catalog().tools:
        if tool.id == tool_id:
            return tool
    raise HTTPException(status_code=404, detail=f"CLI marketplace tool not found: {tool_id}")


def _tool_readme_markdown(tool: CliMarketplaceTool) -> str:
    rel = str(tool.readme_asset or "").strip().lstrip("/")
    if not rel:
        return ""
    assets_dir = _cli_marketplace_assets_dir()
    candidate = (assets_dir / rel).resolve()
    try:
        candidate.relative_to(assets_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid marketplace asset path") from exc
    if not candidate.exists() or not candidate.is_file():
        return ""
    return candidate.read_text(encoding="utf-8")


def _supported_on_current_machine(tool: CliMarketplaceTool) -> bool:
    try:
        return tool.platform_for_current_machine() is not None
    except Exception:
        return False


def _write_extensions_config_file(config_path: Path, cfg: ExtensionsConfig) -> None:
    payload = {
        "mcpServers": {name: server.model_dump() for name, server in cfg.mcp_servers.items()},
        "skills": {name: {"enabled": skill.enabled} for name, skill in cfg.skills.items()},
        "clis": {name: cli.model_dump() for name, cli in cfg.clis.items()},
    }
    temp_path = config_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(config_path)


def _resolve_extensions_config_path() -> Path:
    # Persist extensions config under the Nion data dir by default so CLI state
    # survives restarts and does not depend on current working directory.
    if env_path := os.getenv("NION_EXTENSIONS_CONFIG_PATH"):
        return Path(env_path).expanduser().resolve()
    return ExtensionsConfig.default_config_path()


@router.get("/cli/config", response_model=CliConfigResponse, summary="Get CLI config")
async def get_cli_config() -> CliConfigResponse:
    cfg = get_extensions_config()
    return CliConfigResponse(clis={name: CliStateConfigResponse(**item.model_dump()) for name, item in cfg.clis.items()})


@router.put("/cli/config", response_model=CliConfigResponse, summary="Update CLI config")
async def update_cli_config(request: CliConfigUpdateRequest) -> CliConfigResponse:
    config_path = _resolve_extensions_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    cfg = get_extensions_config()

    next_clis: dict[str, CliStateConfig] = {}
    for name, raw in (request.clis or {}).items():
        tool_id = str(name or "").strip()
        if not tool_id:
            continue
        entry = CliStateConfig.model_validate(raw.model_dump())
        if entry.source in {"system", "custom"} and (not entry.exec or not str(entry.exec).strip()):
            raise HTTPException(status_code=400, detail=f"CLI {tool_id} requires exec when source is {entry.source}")
        next_clis[tool_id] = entry

    cfg.clis = next_clis
    _write_extensions_config_file(config_path, cfg)
    reloaded = reload_extensions_config(str(config_path))
    return CliConfigResponse(clis={name: CliStateConfigResponse(**item.model_dump()) for name, item in reloaded.clis.items()})


def _cli_needs_confirmation_on_enable(tool_id: str, entry: CliStateConfig) -> bool:
    if entry.source in {"system", "custom"}:
        return True
    manifest = load_cli_install_manifest(tool_id)
    if manifest is None:
        return True
    return not bool(manifest.verified)


@router.post("/cli/tools/{tool_id}/set-enabled", response_model=CliSetEnabledResponse, summary="Enable/disable a CLI tool")
async def set_cli_enabled(tool_id: str, request: CliSetEnabledRequest) -> CliSetEnabledResponse:
    tool_id = str(tool_id or "").strip()
    if not tool_id:
        raise HTTPException(status_code=400, detail="tool_id is required")

    config_path = _resolve_extensions_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    cfg = get_extensions_config()
    existing = cfg.clis.get(tool_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"CLI config not found: {tool_id}")

    desired = bool(request.enabled)
    if desired and not existing.enabled and _cli_needs_confirmation_on_enable(tool_id, existing):
        if not request.confirmation_token:
            token = issue_confirmation_token(action="enable", target=f"cli:{tool_id}:enable")
            return CliSetEnabledResponse(
                success=False,
                message=f"启用 CLI {tool_id} 需要二次确认（未验证来源）。",
                tool_id=tool_id,
                enabled=False,
                requires_confirmation=True,
                confirmation_token=token,
            )
        ok, reason = consume_confirmation_token(
            token=request.confirmation_token,
            action="enable",
            target=f"cli:{tool_id}:enable",
        )
        if not ok:
            return CliSetEnabledResponse(
                success=False,
                message=reason,
                tool_id=tool_id,
                enabled=existing.enabled,
            )

    existing.enabled = desired
    cfg.clis[tool_id] = existing
    _write_extensions_config_file(config_path, cfg)
    reload_extensions_config()
    return CliSetEnabledResponse(
        success=True,
        message=f"CLI {tool_id} 已{'启用' if desired else '禁用'}。",
        tool_id=tool_id,
        enabled=desired,
    )


@router.get("/cli/marketplace/tools", response_model=MarketplaceCliToolListResponse, summary="List CLI marketplace tools")
async def list_cli_marketplace_tools(all: int = 0) -> MarketplaceCliToolListResponse:
    items: list[MarketplaceCliToolListItem] = []
    for tool in _load_catalog().tools:
        if not all and not _supported_on_current_machine(tool):
            continue
        platform = None
        try:
            platform = tool.platform_for_current_machine()
        except Exception:
            platform = None
        items.append(
            MarketplaceCliToolListItem(
                id=tool.id,
                name=tool.name or tool.id,
                author=tool.author,
                category=tool.category,
                description=tool.description or "No description",
                tags=list(tool.tags or []),
                verified=bool(tool.verified),
                featured=bool(tool.featured),
                version=str(tool.version or "0.0.0"),
                docs_url=tool.docs_url,
                install_kind=(platform.package.kind if platform else None),
                detail_url=f"/api/cli/marketplace/tools/{tool.id}",
            )
        )
    return MarketplaceCliToolListResponse(tools=items)


@router.get("/cli/marketplace/tools/{tool_id}", response_model=MarketplaceCliToolDetailResponse, summary="Get CLI marketplace tool detail")
async def get_cli_marketplace_tool_detail(tool_id: str) -> MarketplaceCliToolDetailResponse:
    tool = _find_tool(tool_id)
    readme = _tool_readme_markdown(tool)
    if not readme:
        readme = f"# {tool.name or tool.id}\n\n{tool.description or ''}\n"
    return MarketplaceCliToolDetailResponse(
        id=tool.id,
        name=tool.name or tool.id,
        author=tool.author,
        category=tool.category,
        description=tool.description or "No description",
        tags=list(tool.tags or []),
        verified=bool(tool.verified),
        featured=bool(tool.featured),
        version=str(tool.version or "0.0.0"),
        docs_url=tool.docs_url,
        readme_markdown=readme,
        platforms=[p.model_dump(mode="json") for p in tool.platforms],
    )


@router.get("/cli/marketplace/assets/{asset_path:path}", summary="Read CLI marketplace asset")
async def read_cli_marketplace_asset(asset_path: str) -> FileResponse:
    normalized = asset_path.lstrip("/")
    if not normalized:
        raise HTTPException(status_code=404, detail="Asset path is empty")
    assets_dir = _cli_marketplace_assets_dir()
    candidate = (assets_dir / normalized).resolve()
    try:
        candidate.relative_to(assets_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid marketplace asset path") from exc
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Marketplace asset not found: {asset_path}")
    return FileResponse(path=candidate)


@router.post("/cli/install", response_model=CliInstallResponse, summary="Install CLI tool")
async def install_cli(request: CliInstallRequest) -> CliInstallResponse:
    tool_id = str(request.tool_id or "").strip()
    if not tool_id:
        raise HTTPException(status_code=400, detail="tool_id is required")

    tool = _find_tool(tool_id)
    platform = tool.platform_for_current_machine()
    if platform is None:
        raise HTTPException(status_code=400, detail="Tool is not available for current platform")

    try:
        manifest = await install_cli_tool(tool=tool, platform=platform, paths=get_paths())
    except CliInstallError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except httpx.HTTPError as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Download failed: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Install failed: {exc}") from exc

    # Update extensions config: verified installs are enabled by default.
    enabled_default = bool(tool.verified)
    cfg = get_extensions_config()
    cfg.clis[tool_id] = CliStateConfig(enabled=enabled_default, source="managed")
    config_path = _resolve_extensions_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    _write_extensions_config_file(config_path, cfg)
    reload_extensions_config()

    return CliInstallResponse(
        success=True,
        message="OK",
        tool_id=tool_id,
        enabled=enabled_default,
        bins=[b.name for b in manifest.bins],
    )


@router.post("/cli/install/jobs", response_model=CliInstallJobStartResponse, summary="Start CLI install job (async)")
async def start_cli_install_job_endpoint(request: CliInstallJobStartRequest) -> CliInstallJobStartResponse:
    tool_id = str(request.tool_id or "").strip()
    if not tool_id:
        raise HTTPException(status_code=400, detail="tool_id is required")

    tool = _find_tool(tool_id)
    platform = tool.platform_for_current_machine()
    if platform is None:
        raise HTTPException(status_code=400, detail="Tool is not available for current platform")

    try:
        job_id = start_cli_install_job(tool=tool, platform=platform)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to start install job: {exc}") from exc

    return CliInstallJobStartResponse(success=True, message="OK", job_id=job_id, tool_id=tool_id)


@router.get("/cli/install/jobs/{job_id}", response_model=CliInstallJobStatusResponse, summary="Get CLI install job status")
async def get_cli_install_job_status(job_id: str) -> CliInstallJobStatusResponse:
    job_id = str(job_id or "").strip()
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")

    snapshot = get_cli_install_job_snapshot(job_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Install job not found: {job_id}")

    return CliInstallJobStatusResponse(
        success=True,
        job_id=str(snapshot.get("job_id") or job_id),
        tool_id=str(snapshot.get("tool_id") or ""),
        status=str(snapshot.get("status") or ""),
        message=str(snapshot.get("message") or ""),
        last_log_line=str(snapshot.get("last_log_line") or ""),
        logs_tail=list(snapshot.get("logs_tail") or []),
        result=snapshot.get("result"),
    )


@router.get(
    "/cli/install/jobs/{job_id}/events",
    summary="Stream CLI install job events (SSE)",
)
async def stream_cli_install_job_events(job_id: str, request: Request) -> StreamingResponse:
    job_id = str(job_id or "").strip()
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")

    subscribed = subscribe_cli_install_job(job_id)
    if subscribed is None:
        raise HTTPException(status_code=404, detail=f"Install job not found: {job_id}")
    q, snapshot = subscribed

    async def event_stream() -> Any:
        try:
            yield _sse("ready", {"job_id": job_id, "timestamp": _utcnow_iso()})
            yield _sse("snapshot", {"success": True, **snapshot})
            if str(snapshot.get("status") or "") in {"succeeded", "failed"}:
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    next_snapshot = await asyncio.to_thread(q.get, True, 20)
                    if isinstance(next_snapshot, dict):
                        yield _sse("snapshot", {"success": True, **next_snapshot})
                        if str(next_snapshot.get("status") or "") in {"succeeded", "failed"}:
                            break
                except queue.Empty:
                    yield _sse("heartbeat", {"job_id": job_id, "timestamp": _utcnow_iso()})
        finally:
            unsubscribe_cli_install_job(job_id, q)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


@router.post("/cli/uninstall", response_model=CliUninstallResponse, summary="Uninstall CLI tool")
async def uninstall_cli(request: CliUninstallRequest) -> CliUninstallResponse:
    tool_id = str(request.tool_id or "").strip()
    if not tool_id:
        raise HTTPException(status_code=400, detail="tool_id is required")

    removed = uninstall_cli_tool(tool_id=tool_id, keep_config=bool(request.keep_config), paths=get_paths())
    if not removed:
        raise HTTPException(status_code=404, detail=f"CLI tool not installed: {tool_id}")
    return CliUninstallResponse(success=True, message="OK", tool_id=tool_id)


def _probe_managed(tool_id: str) -> CliProbeResponse:
    manifest = load_cli_install_manifest(tool_id)
    if manifest is None:
        return CliProbeResponse(success=False, message="Not installed", installed=False, tool_id=tool_id, bins=[])

    missing: list[str] = []
    bins: list[str] = []
    for item in manifest.bins:
        bins.append(item.name)
        shim_path = get_paths().clis_root_dir / Path(item.shim_rel)
        if not shim_path.exists():
            missing.append(str(shim_path))

    if missing:
        return CliProbeResponse(
            success=False,
            message=f"Shim missing: {missing[0]}",
            installed=False,
            tool_id=tool_id,
            bins=bins,
        )
    return CliProbeResponse(success=True, message="OK", installed=True, tool_id=tool_id, bins=bins)


@router.get("/cli/tools/{tool_id}/probe", response_model=CliProbeResponse, summary="Probe a CLI tool")
async def probe_cli(tool_id: str) -> CliProbeResponse:
    tool_id = str(tool_id or "").strip()
    if not tool_id:
        raise HTTPException(status_code=400, detail="tool_id is required")

    cfg = ExtensionsConfig.from_file()
    entry = cfg.clis.get(tool_id)
    if entry is None:
        # Probe still supports managed installs without config entry.
        return _probe_managed(tool_id)

    if entry.source == "managed":
        return _probe_managed(tool_id)

    exec_value = str(entry.exec or "").strip()
    if not exec_value:
        return CliProbeResponse(success=False, message="Missing exec", installed=False, tool_id=tool_id, bins=[])

    resolved = shutil.which(exec_value) if not os.path.isabs(exec_value) else exec_value
    if not resolved or (os.path.isabs(resolved) and not Path(resolved).exists()):
        return CliProbeResponse(success=False, message="Not found", installed=False, tool_id=tool_id, bins=[])
    return CliProbeResponse(success=True, message="OK", installed=True, tool_id=tool_id, bins=[exec_value])


def _discover_whitelist_tools() -> list[DiscoveredCliTool]:
    result: list[DiscoveredCliTool] = []
    catalog = _load_catalog()
    for tool in catalog.tools:
        platform = tool.platform_for_current_machine()
        if platform is None:
            continue
        found_bins: list[DiscoveredCliBin] = []
        for bin_item in platform.bins:
            resolved = shutil.which(bin_item.name)
            if resolved:
                found_bins.append(DiscoveredCliBin(name=bin_item.name, path=resolved))
        if found_bins:
            result.append(DiscoveredCliTool(tool_id=tool.id, bins=found_bins))
    return result


def _discover_path_candidates(limit: int = 2000) -> list[DiscoveredCliBin]:
    seen: set[str] = set()
    out: list[DiscoveredCliBin] = []
    for raw_dir in (os.getenv("PATH") or "").split(os.pathsep):
        d = Path(raw_dir).expanduser()
        if not d.exists() or not d.is_dir():
            continue
        try:
            for entry in d.iterdir():
                if len(out) >= limit:
                    return out
                name = entry.name
                if name in seen:
                    continue
                try:
                    if not entry.is_file():
                        continue
                except OSError:
                    continue
                if os.name == "nt":
                    lowered = name.lower()
                    if not lowered.endswith((".exe", ".cmd", ".bat", ".ps1")):
                        continue
                else:
                    try:
                        if not os.access(entry, os.X_OK):
                            continue
                    except OSError:
                        continue
                seen.add(name)
                out.append(DiscoveredCliBin(name=name, path=str(entry.resolve())))
        except OSError:
            continue
    return out


@router.get("/cli/discover", response_model=CliDiscoverResponse, summary="Discover CLI tools on this machine")
async def discover_clis(mode: Literal["whitelist", "full"] = "whitelist") -> CliDiscoverResponse:
    if mode == "full":
        return CliDiscoverResponse(tools=_discover_whitelist_tools(), candidates=_discover_path_candidates())
    return CliDiscoverResponse(tools=_discover_whitelist_tools(), candidates=[])


@router.get(
    "/cli/prerequisites",
    response_model=CliPrerequisiteResponse,
    summary="Check CLI tool prerequisites (uv/pipx, etc.)",
)
async def check_cli_prerequisites(commands: str | None = None) -> CliPrerequisiteResponse:
    if not commands:
        return CliPrerequisiteResponse(commands={})

    from src.cli.toolchains import resolve_managed_command

    result: dict[str, CliPrerequisiteStatus] = {}
    for raw in commands.split(","):
        name = raw.strip()
        if not name:
            continue
        resolved = shutil.which(name)
        if resolved is None:
            managed = resolve_managed_command(name)
            if managed is not None and managed.exists():
                resolved = str(managed)
        result[name] = CliPrerequisiteStatus(available=resolved is not None, path=resolved)
    return CliPrerequisiteResponse(commands=result)


@router.post(
    "/cli/toolchains/uv/ensure",
    response_model=CliToolchainEnsureResponse,
    summary="Ensure uv is installed for CLI marketplace (managed toolchain)",
)
async def ensure_cli_uv_toolchain() -> CliToolchainEnsureResponse:
    try:
        from src.cli.toolchains import ensure_uv_toolchain

        toolchain, installed_now = await ensure_uv_toolchain()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to ensure uv toolchain: {exc}") from exc

    message = f"Installed uv {toolchain.version} to {toolchain.root_dir}" if installed_now else f"uv toolchain ready ({toolchain.version})"
    return CliToolchainEnsureResponse(
        installed=installed_now,
        message=message,
        commands={
            "uv": CliPrerequisiteStatus(available=True, path=str(toolchain.uv_path)),
        },
    )


@router.post(
    "/cli/toolchains/pipx/ensure",
    response_model=CliToolchainEnsureResponse,
    summary="Ensure pipx is installed for CLI marketplace (managed toolchain)",
)
async def ensure_cli_pipx_toolchain() -> CliToolchainEnsureResponse:
    try:
        from src.cli.toolchains import ensure_pipx_toolchain

        toolchain, installed_now = await ensure_pipx_toolchain()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to ensure pipx toolchain: {exc}") from exc

    message = "Installed pipx toolchain" if installed_now else "pipx toolchain ready"
    return CliToolchainEnsureResponse(
        installed=installed_now,
        message=message,
        commands={
            "pipx": CliPrerequisiteStatus(available=True, path=str(toolchain.pipx_path)),
        },
    )
