from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from src.cli.catalog import CliMarketplaceTool, CliMarketplaceToolPlatform
from src.cli.manifests import (
    CliInstallBinManifest,
    CliInstallManifest,
    load_cli_install_manifest,
    save_cli_install_manifest,
)
from src.config.paths import get_paths

_MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
_MAX_EXTRACT_BYTES = 500 * 1024 * 1024


class CliInstallError(RuntimeError):
    pass


def _report_progress(progress: Callable[[str], None] | None, message: str) -> None:
    if progress is None:
        return
    try:
        progress(message)
    except Exception:
        # Best-effort only; progress reporting must not break installs.
        return


def _is_windows() -> bool:
    # Avoid patching os.name in tests (it breaks pathlib on POSIX).
    return os.name == "nt"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


_MAX_SUBPROCESS_LOG_CHARS = 8000


def _truncate_text(value: str, limit: int = _MAX_SUBPROCESS_LOG_CHARS) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...(truncated, total {len(text)} chars)..."


async def _run_subprocess(args: list[str], *, env: dict[str, str] | None = None, cwd: Path | None = None) -> tuple[int, str, str]:
    def _run() -> tuple[int, str, str]:
        result = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            env=env,
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout or "", result.stderr or ""

    return await asyncio.to_thread(_run)


async def _download_to_file(url: str, target: Path) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise CliInstallError(f"Unsupported URL scheme for CLI package: {parsed.scheme!r}")

    target.parent.mkdir(parents=True, exist_ok=True)
    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
    total = 0
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, limits=limits) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with open(target, "wb") as f:
                async for chunk in resp.aiter_bytes():
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > _MAX_ARCHIVE_BYTES:
                        raise CliInstallError(f"CLI package too large (> {_MAX_ARCHIVE_BYTES} bytes)")
                    f.write(chunk)


def _archive_kind_from_url(url: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith(".zip"):
        return "zip"
    if path.endswith(".tar.gz") or path.endswith(".tgz"):
        return "tar.gz"
    if path.endswith(".tar"):
        return "tar"
    raise CliInstallError("Unsupported archive format. Supported: .zip, .tar.gz/.tgz, .tar")


def _is_unsafe_member_path(member_path: str) -> bool:
    # Normalize both separators so we catch Windows-style traversal in .zip too.
    clean = str(member_path or "").replace("\\", "/")
    # Windows drive absolute paths like C:/Windows/...
    if re.match(r"^[A-Za-z]:/", clean):
        return True
    p = Path(clean)
    return p.is_absolute() or ".." in p.parts


def _strip_symlinks(root: Path) -> None:
    for p in root.rglob("*"):
        try:
            if p.is_symlink():
                p.unlink()
        except OSError:
            continue


def _extract_zip(archive_path: Path, dest_dir: Path) -> None:
    with zipfile.ZipFile(archive_path, "r") as zf:
        total_size = sum(info.file_size for info in zf.infolist())
        if total_size > _MAX_EXTRACT_BYTES:
            raise CliInstallError(f"CLI archive too large when extracted (> {_MAX_EXTRACT_BYTES} bytes)")
        for info in zf.infolist():
            if _is_unsafe_member_path(info.filename):
                raise CliInstallError(f"Unsafe path in archive: {info.filename}")
        zf.extractall(dest_dir)
    _strip_symlinks(dest_dir)


def _extract_tar(archive_path: Path, dest_dir: Path) -> None:
    extracted = 0
    with tarfile.open(archive_path, "r:*") as tf:
        members = tf.getmembers()
        for member in members:
            name = member.name
            if _is_unsafe_member_path(name):
                raise CliInstallError(f"Unsafe path in archive: {name}")
            # Skip links and special devices.
            if member.issym() or member.islnk() or member.ischr() or member.isblk() or member.isfifo():
                continue
            extracted += max(0, int(getattr(member, "size", 0) or 0))
            if extracted > _MAX_EXTRACT_BYTES:
                raise CliInstallError(f"CLI archive too large when extracted (> {_MAX_EXTRACT_BYTES} bytes)")
        tf.extractall(dest_dir, members=[m for m in members if not (m.issym() or m.islnk() or m.ischr() or m.isblk() or m.isfifo())])
    _strip_symlinks(dest_dir)


def _choose_content_root(extract_dir: Path) -> Path:
    entries = [p for p in extract_dir.iterdir() if p.name not in {".DS_Store"}]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return extract_dir


def _resolve_bin_in_content_root(content_root: Path, path_in_archive: str) -> Path:
    clean = str(path_in_archive or "").strip().lstrip("/").replace("\\", "/")
    if not clean:
        raise CliInstallError("Bin path_in_archive is empty")
    candidate = (content_root / clean).resolve()
    try:
        candidate.relative_to(content_root.resolve())
    except ValueError as exc:
        raise CliInstallError(f"Bin path escapes content root: {path_in_archive}") from exc
    if not candidate.exists() or not candidate.is_file():
        raise CliInstallError(f"Bin not found in archive: {path_in_archive}")
    return candidate


def _resolve_bin_in_store_bin_dir(store_dir: Path, name: str) -> Path:
    """Resolve installed tool bin under `<store_dir>/bin/` for uv/pipx installs."""
    base = str(name or "").strip()
    if not base:
        raise CliInstallError("Bin name is empty")
    bin_dir = store_dir / "bin"
    if _is_windows():
        candidates = [
            f"{base}.exe",
            f"{base}.cmd",
            f"{base}.bat",
            f"{base}.ps1",
            base,
        ]
    else:
        candidates = [base]

    for cand in candidates:
        candidate = bin_dir / cand
        try:
            if candidate.exists() and candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    raise CliInstallError(f"Bin not found in installed bin dir: {base}")


def _ensure_executable(path: Path) -> None:
    if _is_windows():
        return
    try:
        mode = path.stat().st_mode
        os.chmod(path, mode | 0o111)
    except OSError:
        pass


def _create_posix_shim(shim_path: Path, real_path: Path) -> None:
    shim_path.parent.mkdir(parents=True, exist_ok=True)
    # Important: create a relative shim (symlink or wrapper) so that the same
    # installed CLI works in both local and container sandboxes.
    try:
        rel_target = os.path.relpath(str(real_path), start=str(shim_path.parent))
    except Exception:
        rel_target = str(real_path)
    try:
        if shim_path.exists() or shim_path.is_symlink():
            shim_path.unlink()
        shim_path.symlink_to(Path(rel_target))
        return
    except OSError:
        # Fall back to a wrapper script.
        pass

    content = f"""#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REL={shlex_quote(rel_target)}
exec "$SCRIPT_DIR/$REL" "$@"
"""
    shim_path.write_text(content, encoding="utf-8")
    _ensure_executable(shim_path)


def _read_shebang_tokens(path: Path) -> list[str]:
    try:
        with open(path, "rb") as f:
            line = f.readline(512)
    except OSError:
        return []
    if not line.startswith(b"#!"):
        return []
    text = line[2:].decode("utf-8", errors="ignore").strip()
    if not text:
        return []
    return [part for part in text.split() if part]


def shlex_quote(value: str) -> str:
    # Inline minimal shlex.quote to keep this module dependency-light.
    if value == "":
        return "''"
    if re.fullmatch(r"[A-Za-z0-9_@%+=:,./-]+", value):
        return value
    return "'" + value.replace("'", "'\"'\"'") + "'"


def _create_posix_python_wrapper_shim(
    shim_path: Path,
    *,
    python_path: str,
    python_args: list[str],
    script_path: Path,
) -> None:
    """Create a wrapper that runs a Python console script with an explicit interpreter.

    This avoids relying on the script's shebang which may contain host-absolute paths
    that break inside container sandboxes.
    """
    shim_path.parent.mkdir(parents=True, exist_ok=True)
    if shim_path.exists() or shim_path.is_symlink():
        shim_path.unlink()

    try:
        rel_py = os.path.relpath(str(python_path), start=str(shim_path.parent))
    except Exception:
        rel_py = str(python_path)
    try:
        rel_script = os.path.relpath(str(script_path), start=str(shim_path.parent))
    except Exception:
        rel_script = str(script_path)

    extra = " ".join(shlex_quote(arg) for arg in (python_args or []) if isinstance(arg, str))
    extra = f" {extra}" if extra else ""

    content = f"""#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PY_REL={shlex_quote(rel_py)}
SCRIPT_REL={shlex_quote(rel_script)}
exec "$SCRIPT_DIR/$PY_REL"{extra} "$SCRIPT_DIR/$SCRIPT_REL" "$@"
"""
    shim_path.write_text(content, encoding="utf-8")
    _ensure_executable(shim_path)


def _create_windows_python_cmd_shim(
    shim_path: Path,
    *,
    python_path: str,
    python_args: list[str],
    script_path: Path,
) -> None:
    shim_path.parent.mkdir(parents=True, exist_ok=True)
    args_part = " ".join(str(arg) for arg in (python_args or []) if str(arg))
    args_part = f" {args_part}" if args_part else ""
    content = f"""@echo off
setlocal
\"{python_path}\"{args_part} \"{script_path}\" %*
"""
    shim_path.write_text(content, encoding="utf-8")


def _create_windows_cmd_shim(shim_path: Path, real_path: Path) -> None:
    shim_path.parent.mkdir(parents=True, exist_ok=True)
    content = f"""@echo off
setlocal
\"{real_path}\" %*
"""
    shim_path.write_text(content, encoding="utf-8")


def _ensure_shim_is_unique(shim_path: Path) -> None:
    if shim_path.exists() or shim_path.is_symlink():
        raise CliInstallError(f"CLI shim already exists: {shim_path.name}")


def _store_platform_dirname(platform: CliMarketplaceToolPlatform) -> str:
    return f"{platform.os}-{platform.arch}"


async def install_cli_tool(
    *,
    tool: CliMarketplaceTool,
    platform: CliMarketplaceToolPlatform,
    paths=None,
    progress: Callable[[str], None] | None = None,
) -> CliInstallManifest:
    paths = paths or get_paths()

    package_kind = getattr(platform.package, "kind", "http")
    if tool.verified and package_kind == "http" and not platform.package.sha256:
        raise CliInstallError("Verified CLI tool requires sha256 in catalog")

    existing = load_cli_install_manifest(tool.id, paths=paths)
    if existing is not None:
        raise CliInstallError(f"CLI tool already installed: {tool.id}")

    platform_dirname = _store_platform_dirname(platform)
    store_dir = paths.clis_store_dir / tool.id / tool.version / platform_dirname
    if store_dir.exists():
        raise CliInstallError(f"CLI store already exists: {store_dir}")

    paths.clis_store_dir.mkdir(parents=True, exist_ok=True)
    paths.clis_bin_dir.mkdir(parents=True, exist_ok=True)
    paths.clis_manifests_dir.mkdir(parents=True, exist_ok=True)

    expected_sha: str | None = None
    source_ref: str = ""
    if package_kind == "http":
        _report_progress(progress, "下载中...")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            url = str(platform.package.url or "")
            archive_kind = _archive_kind_from_url(url)
            archive_path = tmp_path / f"archive.{archive_kind.replace('.', '-')}"
            await _download_to_file(url, archive_path)

            _report_progress(progress, "校验包完整性...")
            downloaded_sha = _sha256_file(archive_path)
            expected_sha = (platform.package.sha256 or "").strip().lower() or None
            if expected_sha and downloaded_sha.lower() != expected_sha:
                raise CliInstallError("sha256 mismatch for downloaded package")

            _report_progress(progress, "解压中...")
            extract_dir = tmp_path / "extract"
            extract_dir.mkdir(parents=True, exist_ok=True)
            if archive_kind == "zip":
                _extract_zip(archive_path, extract_dir)
            else:
                _extract_tar(archive_path, extract_dir)

            content_root = _choose_content_root(extract_dir)
            temp_store_dir = tmp_path / "store"
            _report_progress(progress, "复制到管理目录...")
            shutil.copytree(content_root, temp_store_dir)

            store_dir.parent.mkdir(parents=True, exist_ok=True)
            if store_dir.exists():
                raise CliInstallError(f"CLI store already exists: {store_dir}")
            shutil.copytree(temp_store_dir, store_dir)
        source_ref = url
    elif package_kind in {"uv", "pipx"}:
        spec = str(getattr(platform.package, "spec", "") or "").strip()
        if not spec:
            raise CliInstallError(f"{package_kind} package requires spec in catalog")

        store_dir.parent.mkdir(parents=True, exist_ok=True)
        store_dir.mkdir(parents=True, exist_ok=False)
        store_bin_dir = store_dir / "bin"
        store_bin_dir.mkdir(parents=True, exist_ok=True)

        env = dict(os.environ)
        try:
            if package_kind == "uv":
                from src.cli.toolchains import ensure_uv_toolchain

                _report_progress(progress, "准备 uv 工具链...")
                toolchain, _ = await ensure_uv_toolchain()
                uv_tool_dir = store_dir / "uv" / "tools"
                uv_cache_dir = store_dir / "uv" / "cache"
                uv_tool_dir.mkdir(parents=True, exist_ok=True)
                uv_cache_dir.mkdir(parents=True, exist_ok=True)
                env["UV_TOOL_DIR"] = str(uv_tool_dir)
                env["UV_TOOL_BIN_DIR"] = str(store_bin_dir)
                env["UV_CACHE_DIR"] = str(uv_cache_dir)

                _report_progress(progress, "uv 安装中...")
                code, out, err = await _run_subprocess([str(toolchain.uv_path), "tool", "install", spec], env=env)
            else:
                from src.cli.toolchains import ensure_pipx_toolchain

                _report_progress(progress, "准备 pipx 工具链...")
                toolchain, _ = await ensure_pipx_toolchain()
                pipx_home = store_dir / "pipx" / "home"
                pipx_home.mkdir(parents=True, exist_ok=True)
                env["PIPX_HOME"] = str(pipx_home)
                env["PIPX_BIN_DIR"] = str(store_bin_dir)
                env["PIPX_DEFAULT_PYTHON"] = sys.executable

                _report_progress(progress, "pipx 安装中...")
                code, out, err = await _run_subprocess([str(toolchain.pipx_path), "install", spec], env=env)
        except Exception:
            # Best-effort cleanup on failure.
            try:
                if store_dir.exists():
                    shutil.rmtree(store_dir)
            except OSError:
                pass
            raise

        if code != 0:
            try:
                if store_dir.exists():
                    shutil.rmtree(store_dir)
            except OSError:
                pass
            raise CliInstallError(f"{package_kind} install failed (exit {code}).\nstdout:\n{_truncate_text(out)}\n\nstderr:\n{_truncate_text(err)}")

        source_ref = spec
    else:
        raise CliInstallError(f"Unsupported package kind: {package_kind}")

    _report_progress(progress, "生成入口...")
    bins: list[CliInstallBinManifest] = []
    for item in platform.bins:
        if not item.name or not item.name.strip():
            continue
        if package_kind == "http":
            if not item.path_in_archive:
                raise CliInstallError(f"Bin {item.name} missing path_in_archive for http package")
            real_path = _resolve_bin_in_content_root(store_dir, item.path_in_archive)
        else:
            real_path = _resolve_bin_in_store_bin_dir(store_dir, item.name)
        _ensure_executable(real_path)

        if _is_windows():
            shim_filename = f"{item.name}.cmd"
            shim_path = paths.clis_bin_dir / shim_filename
            _ensure_shim_is_unique(shim_path)
            if package_kind in {"uv", "pipx"}:
                tokens = _read_shebang_tokens(real_path)
                if tokens and tokens[0] and tokens[0] != "/usr/bin/env" and "python" in Path(tokens[0]).name.lower():
                    _create_windows_python_cmd_shim(
                        shim_path,
                        python_path=tokens[0],
                        python_args=tokens[1:],
                        script_path=real_path,
                    )
                else:
                    _create_windows_cmd_shim(shim_path, real_path)
            else:
                _create_windows_cmd_shim(shim_path, real_path)
        else:
            shim_filename = item.name
            shim_path = paths.clis_bin_dir / shim_filename
            _ensure_shim_is_unique(shim_path)
            if package_kind in {"uv", "pipx"}:
                tokens = _read_shebang_tokens(real_path)
                if tokens and tokens[0] and tokens[0] != "/usr/bin/env" and "python" in Path(tokens[0]).name.lower():
                    _create_posix_python_wrapper_shim(
                        shim_path,
                        python_path=tokens[0],
                        python_args=tokens[1:],
                        script_path=real_path,
                    )
                else:
                    _create_posix_shim(shim_path, real_path)
            else:
                _create_posix_shim(shim_path, real_path)

        bins.append(
            CliInstallBinManifest(
                name=item.name,
                shim_rel=str(Path("bin") / shim_filename),
                real_rel=str(real_path.relative_to(store_dir)),
            )
        )

    _report_progress(progress, "写入安装清单...")
    manifest = CliInstallManifest(
        tool_id=tool.id,
        version=tool.version,
        os=platform.os,
        arch=platform.arch,
        verified=tool.verified,
        featured=tool.featured,
        source_url=source_ref,
        sha256=expected_sha,
        bins=bins,
        healthcheck_argv=list(tool.healthcheck.argv) if tool.healthcheck else [],
        healthcheck_expect_contains=tool.healthcheck.expect_contains if tool.healthcheck else None,
    )
    save_cli_install_manifest(manifest, paths=paths)
    return manifest


def uninstall_cli_tool(*, tool_id: str, keep_config: bool = True, paths=None) -> bool:
    paths = paths or get_paths()

    manifest = load_cli_install_manifest(tool_id, paths=paths)
    if manifest is None:
        return False

    # Remove shims
    for item in manifest.bins:
        rel = Path(item.shim_rel)
        shim_path = paths.clis_root_dir / rel
        try:
            if shim_path.exists() or shim_path.is_symlink():
                shim_path.unlink()
        except OSError:
            pass

    # Remove store dir for this installed platform/version.
    store_dir = paths.clis_store_dir / tool_id / manifest.version / manifest.store_platform_dirname()
    try:
        if store_dir.exists():
            shutil.rmtree(store_dir)
    except OSError:
        pass

    # Remove empty parents (best-effort)
    for parent in [store_dir.parent, store_dir.parent.parent]:
        try:
            if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass

    # Remove manifest
    manifest_path = paths.clis_manifests_dir / f"{tool_id}.json"
    try:
        if manifest_path.exists():
            manifest_path.unlink()
    except OSError:
        pass

    if not keep_config:
        from src.config.extensions_config import ExtensionsConfig, reload_extensions_config

        config_path = ExtensionsConfig.resolve_config_path()
        if config_path is not None:
            cfg = ExtensionsConfig.from_file()
            if tool_id in cfg.clis:
                del cfg.clis[tool_id]
                payload: dict[str, Any] = {
                    "mcpServers": {name: server.model_dump() for name, server in cfg.mcp_servers.items()},
                    "skills": {name: {"enabled": skill.enabled} for name, skill in cfg.skills.items()},
                    "clis": {name: cli.model_dump() for name, cli in cfg.clis.items()},
                }
                temp_path = config_path.with_suffix(".tmp")
                temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
                temp_path.replace(config_path)
                reload_extensions_config()

    return True
