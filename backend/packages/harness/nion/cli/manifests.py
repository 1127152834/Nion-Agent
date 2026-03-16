from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from src.cli.catalog import CliArch, CliOs
from src.config.paths import get_paths


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


class CliInstallBinManifest(BaseModel):
    name: str
    shim_rel: str = Field(description="Path under clis/bin (relative), e.g. 'rg' or 'rg.cmd'")
    real_rel: str = Field(description="Path under store dir (relative) to the real binary")
    model_config = ConfigDict(extra="allow")


class CliInstallManifest(BaseModel):
    tool_id: str
    version: str
    os: CliOs
    arch: CliArch
    verified: bool = False
    featured: bool = False
    source_url: str = ""
    sha256: str | None = None
    installed_at: str = Field(default_factory=_utcnow_iso)
    bins: list[CliInstallBinManifest] = Field(default_factory=list)
    healthcheck_argv: list[str] = Field(default_factory=list)
    healthcheck_expect_contains: str | None = None
    model_config = ConfigDict(extra="allow")

    def store_platform_dirname(self) -> str:
        return f"{self.os}-{self.arch}"


def manifest_file_for_tool(tool_id: str, *, paths=None) -> Path:
    paths = paths or get_paths()
    return paths.clis_manifests_dir / f"{tool_id}.json"


def load_cli_install_manifest(tool_id: str, *, paths=None) -> CliInstallManifest | None:
    paths = paths or get_paths()
    file_path = manifest_file_for_tool(tool_id, paths=paths)
    if not file_path.exists():
        return None
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        return CliInstallManifest.model_validate(payload)
    except Exception:
        return None


def list_cli_install_manifests(*, paths=None) -> list[CliInstallManifest]:
    paths = paths or get_paths()
    manifests_dir = paths.clis_manifests_dir
    if not manifests_dir.exists():
        return []
    items: list[CliInstallManifest] = []
    for file_path in sorted(manifests_dir.glob("*.json")):
        tool_id = file_path.stem
        manifest = load_cli_install_manifest(tool_id, paths=paths)
        if manifest is not None:
            items.append(manifest)
    return items


def save_cli_install_manifest(manifest: CliInstallManifest, *, paths=None) -> Path:
    paths = paths or get_paths()
    paths.clis_manifests_dir.mkdir(parents=True, exist_ok=True)
    file_path = manifest_file_for_tool(manifest.tool_id, paths=paths)
    temp_path = file_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(manifest.model_dump(mode="json"), indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(file_path)
    return file_path
