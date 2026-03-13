"""Managed toolchains for MCP prerequisites (e.g., Node.js for npx-based servers).

Why this exists:
- Many MCP servers are distributed as Node packages and run via `npx`.
- Desktop users often don't have node/npx installed globally.
- We provide a safe-ish, user-initiated "one-click install" that installs Node
  into Nion's data directory (no sudo/admin needed) and returns absolute paths.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import tarfile
from pathlib import Path
from typing import Literal

import httpx

from src.config.paths import get_paths

from dataclasses import dataclass

NODE_INDEX_URL = "https://nodejs.org/dist/index.json"
NODE_DIST_BASE_URL = "https://nodejs.org/dist"

_node_install_lock = asyncio.Lock()


@dataclass(frozen=True)
class ManagedNodeToolchain:
    version: str  # e.g. "v22.3.0"
    root_dir: Path
    node_path: Path
    npm_path: Path
    npx_path: Path


def _toolchains_dir() -> Path:
    return (get_paths().base_dir / "toolchains").resolve()


def _node_toolchain_dir() -> Path:
    return (_toolchains_dir() / "node").resolve()


def _node_current_pointer_file() -> Path:
    return _node_toolchain_dir() / "current.json"


def _platform_tag() -> Literal["darwin", "linux"]:
    if os.name == "nt":
        raise ValueError("Managed Node toolchain is not supported on Windows yet")
    if platform.system().lower() == "darwin":
        return "darwin"
    return "linux"


def _arch_tag() -> Literal["x64", "arm64"]:
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "x64"
    if machine in ("arm64", "aarch64"):
        return "arm64"
    raise ValueError(f"Unsupported CPU architecture: {platform.machine()}")


def _node_tarball_name(version: str, platform_tag: str, arch_tag: str) -> str:
    # Example: node-v22.3.0-darwin-arm64.tar.gz
    return f"node-{version}-{platform_tag}-{arch_tag}.tar.gz"


def _node_dist_dir(version: str) -> str:
    # Example: https://nodejs.org/dist/v22.3.0
    return f"{NODE_DIST_BASE_URL}/{version}"


def _load_managed_node() -> ManagedNodeToolchain | None:
    pointer = _node_current_pointer_file()
    if not pointer.exists():
        return None
    try:
        payload = json.loads(pointer.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None

    version = str(payload.get("version") or "").strip()
    root_dir = str(payload.get("root_dir") or "").strip()
    if not version or not root_dir:
        return None

    root = Path(root_dir).expanduser().resolve()
    node_path = root / "bin" / "node"
    npm_path = root / "bin" / "npm"
    npx_path = root / "bin" / "npx"
    if not (node_path.exists() and npx_path.exists()):
        return None

    return ManagedNodeToolchain(
        version=version,
        root_dir=root,
        node_path=node_path,
        npm_path=npm_path,
        npx_path=npx_path,
    )


def resolve_managed_command(command: str) -> Path | None:
    """Resolve a prerequisite command from Nion-managed toolchains.

    This is used by `/api/mcp/prerequisites` so the UI can show "available"
    after a one-click install, even if the user's shell PATH hasn't been updated.
    """
    name = str(command or "").strip()
    if not name:
        return None

    node = _load_managed_node()
    if node is None:
        return None

    if name == "node":
        return node.node_path
    if name == "npm":
        return node.npm_path
    if name == "npx":
        return node.npx_path
    return None


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_extract_tar(tar: tarfile.TarFile, dest_dir: Path) -> None:
    dest_root = dest_dir.resolve()
    for member in tar.getmembers():
        member_path = (dest_root / member.name).resolve()
        try:
            member_path.relative_to(dest_root)
        except ValueError as exc:
            raise ValueError(f"Unsafe tar path detected: {member.name}") from exc
    tar.extractall(dest_root)  # noqa: S202 - guarded by path checks above


async def _pick_node_lts_version(client: httpx.AsyncClient) -> str:
    forced = str(os.getenv("NION_NODE_TOOLCHAIN_VERSION") or "").strip()
    if forced:
        return forced if forced.startswith("v") else f"v{forced}"

    resp = await client.get(NODE_INDEX_URL, timeout=15)
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, list):
        raise ValueError("Unexpected Node index payload (expected a list)")

    # Node's index is typically sorted newest-first. Prefer first LTS entry.
    for item in payload:
        if not isinstance(item, dict):
            continue
        version = str(item.get("version") or "").strip()
        lts = item.get("lts")
        if not version:
            continue
        if lts:
            return version

    # Fallback to first entry if LTS flag missing.
    first = payload[0] if payload else None
    if isinstance(first, dict):
        version = str(first.get("version") or "").strip()
        if version:
            return version

    raise ValueError("Unable to determine Node version from index.json")


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


async def ensure_node_toolchain() -> tuple[ManagedNodeToolchain, bool]:
    """Ensure a working Node toolchain (node/npm/npx) is available.

    Returns:
        (toolchain, installed_now)
    """
    async with _node_install_lock:
        existing = _load_managed_node()
        if existing is not None:
            return existing, False

        toolchain_dir = _node_toolchain_dir()
        toolchain_dir.mkdir(parents=True, exist_ok=True)

        platform_tag = _platform_tag()
        arch_tag = _arch_tag()

        async with httpx.AsyncClient(follow_redirects=True) as client:
            version = await _pick_node_lts_version(client)
            tarball = _node_tarball_name(version, platform_tag, arch_tag)
            dist_dir = _node_dist_dir(version)

            tarball_url = f"{dist_dir}/{tarball}"
            shasums_url = f"{dist_dir}/SHASUMS256.txt"

            version_dir = toolchain_dir / version
            version_dir.mkdir(parents=True, exist_ok=True)

            tarball_path = version_dir / tarball
            await _download_file(client, tarball_url, tarball_path)

            shasums_text = await _download_text(client, shasums_url)
            expected_sha = ""
            for line in shasums_text.splitlines():
                parts = line.strip().split()
                if len(parts) >= 2 and parts[1] == tarball:
                    expected_sha = parts[0]
                    break
            if not expected_sha:
                raise ValueError("Unable to find SHA256 for downloaded Node tarball")

            actual_sha = _sha256_file(tarball_path)
            if actual_sha.lower() != expected_sha.lower():
                raise ValueError("Node tarball checksum mismatch; download may be corrupted")

            # Extract into a temp dir, then atomically move the extracted root into place.
            extract_dir = version_dir / "extract"
            extract_dir.mkdir(parents=True, exist_ok=True)
            tmp_extract_dir = extract_dir / f"{tarball}.tmp"
            if tmp_extract_dir.exists():
                # Best-effort cleanup.
                for child in tmp_extract_dir.iterdir():
                    if child.is_dir():
                        import shutil

                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        try:
                            child.unlink()
                        except Exception:  # noqa: BLE001
                            pass
            tmp_extract_dir.mkdir(parents=True, exist_ok=True)

            with tarfile.open(tarball_path, "r:gz") as tar:
                _safe_extract_tar(tar, tmp_extract_dir)

            expected_root_name = tarball.removesuffix(".tar.gz")
            extracted_root = (tmp_extract_dir / expected_root_name).resolve()
            if not extracted_root.exists():
                # Fallback: pick the first directory in tmp_extract_dir.
                dirs = [p for p in tmp_extract_dir.iterdir() if p.is_dir()]
                if not dirs:
                    raise ValueError("Node tarball extraction produced no directories")
                extracted_root = dirs[0].resolve()

            final_root = version_dir / extracted_root.name
            if final_root.exists():
                # Already installed; keep as-is.
                pass
            else:
                extracted_root.rename(final_root)

            node = ManagedNodeToolchain(
                version=version,
                root_dir=final_root,
                node_path=final_root / "bin" / "node",
                npm_path=final_root / "bin" / "npm",
                npx_path=final_root / "bin" / "npx",
            )
            if not (node.node_path.exists() and node.npx_path.exists()):
                raise ValueError("Managed Node toolchain missing required binaries after install")

            _node_current_pointer_file().write_text(
                json.dumps(
                    {
                        "version": node.version,
                        "root_dir": str(node.root_dir),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )

            return node, True
