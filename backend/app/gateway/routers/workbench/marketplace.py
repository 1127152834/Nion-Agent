"""Workbench marketplace endpoints."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from src.gateway.routers.workbench.models import (
    MarketplacePluginDetailResponse,
    MarketplacePluginListItem,
    MarketplacePluginListResponse,
)

router = APIRouter(prefix="/api/workbench/marketplace", tags=["workbench"])


# ── Helpers ──────────────────────────────────────────────────────────────────


def _repo_root_dir() -> Path:
    return Path(__file__).resolve().parents[5]


def _marketplace_catalog_file() -> Path:
    if env_value := os.getenv("NION_WORKBENCH_MARKETPLACE_CATALOG"):
        return Path(env_value).expanduser().resolve()
    return (_repo_root_dir() / "backend" / "data" / "workbench_marketplace" / "catalog.json").resolve()


def _marketplace_assets_dir() -> Path:
    return (_repo_root_dir() / "backend" / "data" / "workbench_marketplace" / "assets").resolve()


def _safe_repo_relative_path(raw_path: str) -> Path:
    if not raw_path:
        raise HTTPException(status_code=400, detail="Empty relative path is not allowed")
    repo_root = _repo_root_dir().resolve()
    candidate = (repo_root / raw_path).resolve()
    try:
        candidate.relative_to(repo_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Path escapes repository root: {raw_path}") from exc
    return candidate


def _load_marketplace_catalog() -> list[dict[str, Any]]:
    catalog_file = _marketplace_catalog_file()
    if not catalog_file.exists():
        return []
    try:
        payload = json.loads(catalog_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid marketplace catalog JSON: {exc}") from exc
    plugins = payload.get("plugins")
    if not isinstance(plugins, list):
        raise HTTPException(status_code=500, detail="Marketplace catalog missing `plugins` list")
    normalized: list[dict[str, Any]] = []
    for item in plugins:
        if isinstance(item, dict):
            normalized.append(item)
    return normalized


def _find_marketplace_entry(plugin_id: str) -> dict[str, Any]:
    for item in _load_marketplace_catalog():
        if str(item.get("id", "")).strip() == plugin_id:
            return item
    raise HTTPException(status_code=404, detail=f"Marketplace plugin not found: {plugin_id}")


def _entry_package_path(entry: dict[str, Any]) -> Path:
    path_value = str(entry.get("package_path", "")).strip()
    if not path_value:
        raise HTTPException(status_code=500, detail=f"Marketplace plugin `{entry.get('id')}` has no package_path")
    package_path = _safe_repo_relative_path(path_value)
    if not package_path.exists() or not package_path.is_file():
        raise HTTPException(status_code=404, detail=f"Marketplace package missing: {path_value}")
    return package_path


def _entry_readme_text(entry: dict[str, Any]) -> str:
    path_value = str(entry.get("readme_path", "")).strip()
    if not path_value:
        return ""
    readme_file = _safe_repo_relative_path(path_value)
    if not readme_file.exists() or not readme_file.is_file():
        return ""
    return readme_file.read_text(encoding="utf-8")


def _entry_demo_image_urls(entry: dict[str, Any]) -> list[str]:
    demo_images_raw = entry.get("demo_images")
    if not isinstance(demo_images_raw, list):
        return []
    urls: list[str] = []
    for raw in demo_images_raw:
        asset_rel = str(raw or "").strip().lstrip("/")
        if not asset_rel:
            continue
        candidate = (_marketplace_assets_dir() / asset_rel).resolve()
        try:
            candidate.relative_to(_marketplace_assets_dir())
        except ValueError:
            continue
        if not candidate.exists() or not candidate.is_file():
            continue
        encoded = quote(asset_rel)
        urls.append(f"/api/workbench/marketplace/assets/{encoded}")
    return urls


def _marketplace_list_item(entry: dict[str, Any]) -> MarketplacePluginListItem:
    plugin_id = str(entry.get("id", "")).strip()
    if not plugin_id:
        raise HTTPException(status_code=500, detail="Marketplace catalog contains plugin with empty id")
    # Resolve package path ahead of time so list only shows installable entries.
    _entry_package_path(entry)

    readme = _entry_readme_text(entry)
    docs_summary = None
    if readme:
        first_line = next((line.strip() for line in readme.splitlines() if line.strip()), "")
        docs_summary = first_line[:180] if first_line else None

    return MarketplacePluginListItem(
        id=plugin_id,
        name=str(entry.get("name") or plugin_id),
        description=str(entry.get("description") or "No description"),
        version=str(entry.get("version") or "0.0.0"),
        maintainer=str(entry.get("maintainer") or "") or None,
        tags=[str(tag) for tag in entry.get("tags", []) if str(tag).strip()],
        updated_at=str(entry.get("updated_at") or "") or None,
        download_url=f"/api/workbench/marketplace/plugins/{plugin_id}/download",
        detail_url=f"/api/workbench/marketplace/plugins/{plugin_id}",
        docs_summary=docs_summary,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get(
    "/plugins",
    response_model=MarketplacePluginListResponse,
    summary="List available workbench marketplace plugins",
)
async def list_workbench_marketplace_plugins() -> MarketplacePluginListResponse:
    items: list[MarketplacePluginListItem] = []
    for entry in _load_marketplace_catalog():
        try:
            items.append(_marketplace_list_item(entry))
        except HTTPException:
            # Keep the list resilient: malformed entries are skipped instead of
            # breaking the whole marketplace page.
            continue
    return MarketplacePluginListResponse(plugins=items)


@router.get(
    "/plugins/{plugin_id}",
    response_model=MarketplacePluginDetailResponse,
    summary="Get workbench marketplace plugin detail",
)
async def get_workbench_marketplace_plugin_detail(plugin_id: str) -> MarketplacePluginDetailResponse:
    entry = _find_marketplace_entry(plugin_id)
    list_item = _marketplace_list_item(entry)
    readme_markdown = _entry_readme_text(entry)
    if not readme_markdown:
        readme_markdown = f"# {list_item.name}\n\n{list_item.description}\n"
    return MarketplacePluginDetailResponse(
        id=list_item.id,
        name=list_item.name,
        description=list_item.description,
        version=list_item.version,
        maintainer=list_item.maintainer,
        tags=list_item.tags,
        updated_at=list_item.updated_at,
        download_url=list_item.download_url,
        readme_markdown=readme_markdown,
        demo_image_urls=_entry_demo_image_urls(entry),
    )


@router.get(
    "/plugins/{plugin_id}/download",
    summary="Download marketplace plugin package",
)
async def download_workbench_marketplace_plugin(plugin_id: str) -> FileResponse:
    entry = _find_marketplace_entry(plugin_id)
    package_file = _entry_package_path(entry)
    filename = f"{plugin_id}.nwp"
    return FileResponse(path=package_file, filename=filename, media_type="application/zip")


@router.get(
    "/assets/{asset_path:path}",
    summary="Read marketplace documentation/demo asset",
)
async def read_workbench_marketplace_asset(asset_path: str) -> FileResponse:
    normalized = asset_path.lstrip("/")
    if not normalized:
        raise HTTPException(status_code=404, detail="Asset path is empty")
    candidate = (_marketplace_assets_dir() / normalized).resolve()
    try:
        candidate.relative_to(_marketplace_assets_dir())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid marketplace asset path") from exc
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Marketplace asset not found: {asset_path}")
    return FileResponse(path=candidate)
