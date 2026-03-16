from __future__ import annotations

import json
import os
import platform as platform_module
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CliOs = Literal["macos", "linux", "windows"]
CliArch = Literal["x86_64", "arm64"]


def normalize_cli_os(raw: str) -> CliOs | None:
    value = (raw or "").strip().lower()
    if value in {"mac", "macos", "darwin", "osx"}:
        return "macos"
    if value in {"linux"}:
        return "linux"
    if value in {"win", "windows"}:
        return "windows"
    return None


def normalize_cli_arch(raw: str) -> CliArch | None:
    value = (raw or "").strip().lower()
    if value in {"x86_64", "amd64"}:
        return "x86_64"
    if value in {"arm64", "aarch64"}:
        return "arm64"
    return None


def get_current_cli_platform() -> tuple[CliOs, CliArch]:
    system = platform_module.system()
    machine = platform_module.machine()
    os_value = normalize_cli_os(system)
    arch_value = normalize_cli_arch(machine)
    if os_value is None:
        raise RuntimeError(f"Unsupported OS for CLI marketplace: {system!r}")
    if arch_value is None:
        raise RuntimeError(f"Unsupported arch for CLI marketplace: {machine!r}")
    return os_value, arch_value


class CliMarketplacePackage(BaseModel):
    kind: Literal["http", "uv", "pipx"] = "http"
    url: str | None = None
    spec: str | None = None
    sha256: str | None = None
    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _validate_kind(self):
        if self.kind == "http":
            if not isinstance(self.url, str) or not self.url.strip():
                raise ValueError("http package requires url")
            return self
        # uv / pipx
        if not isinstance(self.spec, str) or not self.spec.strip():
            raise ValueError(f"{self.kind} package requires spec")
        return self


class CliMarketplaceBin(BaseModel):
    name: str
    path_in_archive: str | None = None
    model_config = ConfigDict(extra="allow")


class CliMarketplaceToolPlatform(BaseModel):
    os: CliOs
    arch: CliArch
    package: CliMarketplacePackage
    bins: list[CliMarketplaceBin] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


class CliMarketplaceHealthcheck(BaseModel):
    argv: list[str] = Field(default_factory=list)
    expect_contains: str | None = None
    model_config = ConfigDict(extra="allow")


class CliMarketplaceTool(BaseModel):
    id: str
    name: str
    author: str | None = None
    category: str | None = None
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    verified: bool = False
    featured: bool = False
    version: str = "0.0.0"
    docs_url: str | None = None
    readme_asset: str | None = None
    platforms: list[CliMarketplaceToolPlatform] = Field(default_factory=list)
    healthcheck: CliMarketplaceHealthcheck | None = None
    model_config = ConfigDict(extra="allow")

    def platform_for_current_machine(self) -> CliMarketplaceToolPlatform | None:
        os_value, arch_value = get_current_cli_platform()
        return next(
            (p for p in self.platforms if p.os == os_value and p.arch == arch_value),
            None,
        )


class CliMarketplaceCatalog(BaseModel):
    tools: list[CliMarketplaceTool] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


def load_cli_marketplace_catalog(file_path: Path) -> CliMarketplaceCatalog:
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("CLI marketplace catalog must be an object")
    raw_tools = payload.get("tools")
    if raw_tools is None:
        # Allow empty catalog files.
        raw_tools = []
    if not isinstance(raw_tools, list):
        raise ValueError("CLI marketplace catalog missing `tools` list")
    tools: list[CliMarketplaceTool] = []
    for item in raw_tools:
        if not isinstance(item, dict):
            continue
        try:
            tools.append(CliMarketplaceTool.model_validate(item))
        except Exception:
            continue
    return CliMarketplaceCatalog(tools=tools)


def default_cli_marketplace_catalog_file(repo_root: Path) -> Path:
    if env_value := os.getenv("NION_CLI_MARKETPLACE_CATALOG"):
        return Path(env_value).expanduser().resolve()
    return (repo_root / "backend" / "data" / "cli_marketplace" / "catalog.json").resolve()


def default_cli_marketplace_assets_dir(repo_root: Path) -> Path:
    return (repo_root / "backend" / "data" / "cli_marketplace" / "assets").resolve()


def repo_root_from_module(file: str) -> Path:
    """
    Resolve the repository root from a module file path.

    This codebase expects the CLI marketplace catalog to live at:
      <repo-root>/backend/data/cli_marketplace/catalog.json

    Avoid brittle `parents[n]` indexing (worktrees, different checkout depths,
    and packaged environments can change the directory depth).
    """
    start = Path(file).resolve()
    for parent in start.parents:
        candidate = parent / "backend" / "data" / "cli_marketplace" / "catalog.json"
        if candidate.exists():
            return parent

    # Fallback: best-effort guess (repo-root/backend/src/cli/catalog.py -> parents[3]).
    return start.parents[3] if len(start.parents) > 3 else start.parent


def load_cli_catalog() -> dict[str, Any]:
    """Load CLI catalog JSON for agent/runtime use.

    This is a small compatibility layer used by agent middlewares that expect
    a dict-shaped catalog payload (e.g. containing `tools` and extra fields like
    `interactive_commands`).

    The canonical catalog source is `backend/data/cli_marketplace/catalog.json`.
    """

    repo_root = repo_root_from_module(__file__)
    catalog_file = default_cli_marketplace_catalog_file(repo_root)
    if not catalog_file.exists():
        return {"tools": []}

    payload = json.loads(catalog_file.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return {"tools": []}
    tools = payload.get("tools")
    if tools is None:
        payload["tools"] = []
    elif not isinstance(tools, list):
        payload["tools"] = []
    return payload
