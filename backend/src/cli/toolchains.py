"""Managed toolchains for CLI marketplace installs (uv/pipx).

Goals:
- Let desktop users install Python-distributed CLIs without requiring preinstalled uv/pipx.
- Install toolchains under Nion's data dir (no sudo/admin, no global PATH edits).
- Return absolute paths so gateway/runtime can execute them deterministically.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

import httpx

from src.cli.catalog import normalize_cli_arch, normalize_cli_os
from src.config.paths import get_paths


DEFAULT_UV_VERSION = "0.10.8"
UV_REPO = "astral-sh/uv"
UV_RELEASE_BASE_URL = f"https://github.com/{UV_REPO}/releases/download"

_uv_install_lock = asyncio.Lock()
_pipx_install_lock = asyncio.Lock()


@dataclass(frozen=True)
class ManagedUvToolchain:
    version: str
    root_dir: Path
    uv_path: Path


@dataclass(frozen=True)
class ManagedPipxToolchain:
    venv_dir: Path
    python_path: Path
    pipx_path: Path


def _toolchains_dir() -> Path:
    return (get_paths().base_dir / "toolchains").resolve()


def _uv_toolchain_dir() -> Path:
    return (_toolchains_dir() / "uv").resolve()


def _uv_current_pointer_file() -> Path:
    return _uv_toolchain_dir() / "current.json"


def _pipx_toolchain_dir() -> Path:
    return (_toolchains_dir() / "pipx").resolve()


def _pipx_current_pointer_file() -> Path:
    return _pipx_toolchain_dir() / "current.json"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _choose_content_root(extract_dir: Path) -> Path:
    entries = [p for p in extract_dir.iterdir() if p.name not in {".DS_Store"}]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return extract_dir


def _safe_extract_tar(tar: tarfile.TarFile, dest_dir: Path) -> None:
    dest_root = dest_dir.resolve()
    members = tar.getmembers()
    for member in members:
        name = member.name
        if Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError(f"Unsafe tar path detected: {name}")
        if member.issym() or member.islnk() or member.ischr() or member.isblk() or member.isfifo():
            # Skip links and special devices.
            continue
        member_path = (dest_root / name).resolve()
        try:
            member_path.relative_to(dest_root)
        except ValueError as exc:
            raise ValueError(f"Unsafe tar path detected: {name}") from exc
    safe_members = [m for m in members if not (m.issym() or m.islnk() or m.ischr() or m.isblk() or m.isfifo())]
    tar.extractall(dest_root, members=safe_members)  # noqa: S202 - guarded by path checks above


def _safe_extract_zip(zf: zipfile.ZipFile, dest_dir: Path) -> None:
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        if Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError(f"Unsafe zip path detected: {info.filename}")
    zf.extractall(dest_dir)


def _current_os_arch() -> tuple[str, str]:
    os_value = normalize_cli_os(platform.system())
    arch_value = normalize_cli_arch(platform.machine())
    if os_value is None:
        raise ValueError(f"Unsupported OS for uv toolchain: {platform.system()!r}")
    if arch_value is None:
        raise ValueError(f"Unsupported arch for uv toolchain: {platform.machine()!r}")
    return os_value, arch_value


def _uv_asset_name(*, os_value: str, arch_value: str) -> str:
    # https://github.com/astral-sh/uv/releases
    # Examples:
    # - uv-aarch64-apple-darwin.tar.gz
    # - uv-x86_64-unknown-linux-gnu.tar.gz
    # - uv-x86_64-pc-windows-msvc.zip
    if os_value == "macos":
        if arch_value == "arm64":
            return "uv-aarch64-apple-darwin.tar.gz"
        return "uv-x86_64-apple-darwin.tar.gz"
    if os_value == "linux":
        if arch_value == "arm64":
            return "uv-aarch64-unknown-linux-gnu.tar.gz"
        return "uv-x86_64-unknown-linux-gnu.tar.gz"
    # windows
    if arch_value == "arm64":
        return "uv-aarch64-pc-windows-msvc.zip"
    return "uv-x86_64-pc-windows-msvc.zip"


def _load_managed_uv() -> ManagedUvToolchain | None:
    pointer = _uv_current_pointer_file()
    if not pointer.exists():
        return None
    try:
        payload = json.loads(pointer.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None

    version = str(payload.get("version") or "").strip()
    root_dir = str(payload.get("root_dir") or "").strip()
    uv_path = str(payload.get("uv_path") or "").strip()
    if not version or not root_dir or not uv_path:
        return None
    root = Path(root_dir).expanduser().resolve()
    uv = Path(uv_path).expanduser().resolve()
    if not uv.exists():
        return None
    return ManagedUvToolchain(version=version, root_dir=root, uv_path=uv)


def _load_managed_pipx() -> ManagedPipxToolchain | None:
    pointer = _pipx_current_pointer_file()
    if not pointer.exists():
        return None
    try:
        payload = json.loads(pointer.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    venv_dir = str(payload.get("venv_dir") or "").strip()
    python_path = str(payload.get("python_path") or "").strip()
    pipx_path = str(payload.get("pipx_path") or "").strip()
    if not venv_dir or not python_path or not pipx_path:
        return None
    venv = Path(venv_dir).expanduser().resolve()
    py = Path(python_path).expanduser().resolve()
    pipx = Path(pipx_path).expanduser().resolve()
    if not pipx.exists():
        return None
    return ManagedPipxToolchain(venv_dir=venv, python_path=py, pipx_path=pipx)


def resolve_managed_command(command: str) -> Path | None:
    name = str(command or "").strip()
    if not name:
        return None
    if name == "uv":
        uv = _load_managed_uv()
        return uv.uv_path if uv else None
    if name == "pipx":
        pipx = _load_managed_pipx()
        return pipx.pipx_path if pipx else None
    return None


async def _download_text(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


async def _download_file(client: httpx.AsyncClient, url: str, dest_path: Path) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest_path.with_suffix(dest_path.suffix + ".download")
    if tmp_path.exists():
        try:
            tmp_path.unlink()
        except Exception:  # noqa: BLE001
            pass
    async with client.stream("GET", url, timeout=None) as resp:
        resp.raise_for_status()
        with open(tmp_path, "wb") as f:
            async for chunk in resp.aiter_bytes():
                if chunk:
                    f.write(chunk)
    tmp_path.rename(dest_path)


def _parse_sha256_text(text: str) -> str:
    m = re.search(r"\b[0-9a-fA-F]{64}\b", text or "")
    if not m:
        raise ValueError("Unable to parse sha256 checksum")
    return m.group(0)


def _ensure_executable(path: Path) -> None:
    if os.name == "nt":
        return
    try:
        mode = path.stat().st_mode
        os.chmod(path, mode | 0o111)
    except OSError:
        pass


def _find_uv_binary(root: Path) -> Path:
    names = ["uv.exe"] if os.name == "nt" else ["uv"]
    candidates: list[Path] = []
    for name in names:
        for p in root.rglob(name):
            try:
                if p.is_file():
                    candidates.append(p)
            except OSError:
                continue
    if not candidates:
        raise ValueError("uv binary not found in extracted toolchain")
    for p in candidates:
        if p.parent == root:
            return p
    return candidates[0]


async def ensure_uv_toolchain() -> tuple[ManagedUvToolchain, bool]:
    """Ensure uv is available (managed install under Nion's data dir)."""
    async with _uv_install_lock:
        forced = str(os.getenv("NION_UV_TOOLCHAIN_VERSION") or "").strip()
        version = forced or DEFAULT_UV_VERSION
        version = version.lstrip("v").strip()
        existing = _load_managed_uv()
        if existing is not None and existing.version == version and existing.uv_path.exists():
            return existing, False

        os_value, arch_value = _current_os_arch()
        asset = _uv_asset_name(os_value=os_value, arch_value=arch_value)
        sha_asset = f"{asset}.sha256"

        toolchain_dir = _uv_toolchain_dir()
        toolchain_dir.mkdir(parents=True, exist_ok=True)
        version_dir = (toolchain_dir / version).resolve()
        version_dir.mkdir(parents=True, exist_ok=True)

        archive_path = version_dir / asset
        root_dir = version_dir / "root"
        if root_dir.exists():
            # If the directory exists but is incomplete, wipe it.
            try:
                shutil.rmtree(root_dir)
            except OSError:
                pass

        url = f"{UV_RELEASE_BASE_URL}/{version}/{asset}"
        sha_url = f"{UV_RELEASE_BASE_URL}/{version}/{sha_asset}"

        async with httpx.AsyncClient(follow_redirects=True) as client:
            sha_text = await _download_text(client, sha_url)
            expected_sha = _parse_sha256_text(sha_text)
            await _download_file(client, url, archive_path)
            actual_sha = _sha256_file(archive_path)
            if actual_sha.lower() != expected_sha.lower():
                raise ValueError("uv toolchain checksum mismatch; download may be corrupted")

        extract_dir = version_dir / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)
        tmp_extract_dir = extract_dir / f"{asset}.tmp"
        if tmp_extract_dir.exists():
            try:
                shutil.rmtree(tmp_extract_dir)
            except OSError:
                pass
        tmp_extract_dir.mkdir(parents=True, exist_ok=True)

        if archive_path.name.lower().endswith(".zip"):
            with zipfile.ZipFile(archive_path, "r") as zf:
                _safe_extract_zip(zf, tmp_extract_dir)
        else:
            with tarfile.open(archive_path, "r:*") as tf:
                _safe_extract_tar(tf, tmp_extract_dir)

        content_root = _choose_content_root(tmp_extract_dir)
        content_root.rename(root_dir)
        try:
            if tmp_extract_dir.exists():
                shutil.rmtree(tmp_extract_dir)
        except OSError:
            pass

        uv_path = _find_uv_binary(root_dir)
        _ensure_executable(uv_path)

        pointer_payload = {
            "version": version,
            "root_dir": str(root_dir),
            "uv_path": str(uv_path),
        }
        pointer_file = _uv_current_pointer_file()
        pointer_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_pointer = pointer_file.with_suffix(".tmp")
        tmp_pointer.write_text(json.dumps(pointer_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_pointer.replace(pointer_file)

        return ManagedUvToolchain(version=version, root_dir=root_dir, uv_path=uv_path), True


def _venv_paths(venv_dir: Path) -> tuple[Path, Path]:
    if os.name == "nt":
        python = venv_dir / "Scripts" / "python.exe"
        pipx = venv_dir / "Scripts" / "pipx.exe"
        if not pipx.exists():
            pipx = venv_dir / "Scripts" / "pipx"
        return python, pipx
    return venv_dir / "bin" / "python", venv_dir / "bin" / "pipx"


async def ensure_pipx_toolchain() -> tuple[ManagedPipxToolchain, bool]:
    """Ensure pipx is available (managed venv under Nion's data dir)."""
    async with _pipx_install_lock:
        existing = _load_managed_pipx()
        if existing is not None and existing.pipx_path.exists():
            return existing, False

        toolchain_dir = _pipx_toolchain_dir()
        toolchain_dir.mkdir(parents=True, exist_ok=True)
        venv_dir = toolchain_dir / "venv"

        def _install_sync() -> ManagedPipxToolchain:
            if not venv_dir.exists():
                subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True, capture_output=True, text=True)

            python_path, pipx_path = _venv_paths(venv_dir)
            if not python_path.exists():
                raise RuntimeError("pipx venv python not found after venv creation")

            subprocess.run(
                [str(python_path), "-m", "pip", "install", "-U", "pip", "pipx"],
                check=True,
                capture_output=True,
                text=True,
            )

            # pipx may be a script without .exe on Windows depending on installation.
            python_path, pipx_path = _venv_paths(venv_dir)
            if not pipx_path.exists():
                pipx_candidates = list(venv_dir.rglob("pipx*"))
                for candidate in pipx_candidates:
                    if candidate.is_file():
                        pipx_path = candidate
                        break
            if not pipx_path.exists():
                raise RuntimeError("pipx not found in managed venv")

            return ManagedPipxToolchain(venv_dir=venv_dir.resolve(), python_path=python_path.resolve(), pipx_path=pipx_path.resolve())

        toolchain = await asyncio.to_thread(_install_sync)

        pointer_payload = {
            "venv_dir": str(toolchain.venv_dir),
            "python_path": str(toolchain.python_path),
            "pipx_path": str(toolchain.pipx_path),
        }
        pointer_file = _pipx_current_pointer_file()
        pointer_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_pointer = pointer_file.with_suffix(".tmp")
        tmp_pointer.write_text(json.dumps(pointer_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_pointer.replace(pointer_file)

        return toolchain, True

