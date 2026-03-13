"""Workspace file tree APIs for thread-scoped user data."""

from __future__ import annotations

from datetime import UTC, datetime
import shlex
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from src.gateway.path_utils import resolve_thread_virtual_path
from src.runtime_profile import RuntimeProfileRepository
from src.sandbox.sandbox_provider import get_sandbox_provider

router = APIRouter(prefix="/api/threads/{thread_id}/workspace", tags=["workspace"])

DEFAULT_ROOT = VIRTUAL_PATH_PREFIX
DEFAULT_MAX_DEPTH = 6
DEFAULT_MAX_NODES = 5000
HIDDEN_PREFIX = "."
EXCLUDED_DIR_NAMES = {
    "__pycache__",
    ".git",
    ".svn",
    "node_modules",
}


class WorkspaceDirectoryEntry(BaseModel):
    path: str
    name: str
    depth: int
    child_count: int = 0
    mtime: float | None = None


class WorkspaceFileEntry(BaseModel):
    path: str
    name: str
    depth: int
    size: int = 0
    mtime: float | None = None


class WorkspaceTreeResponse(BaseModel):
    root: str
    generated_at: str
    depth: int
    truncated: bool
    directories: list[WorkspaceDirectoryEntry] = Field(default_factory=list)
    files: list[WorkspaceFileEntry] = Field(default_factory=list)


class WorkspaceMetaResponse(BaseModel):
    thread_id: str
    root: str
    actual_root: str
    execution_mode: str
    host_workdir: str | None = None
    tree_backend: str = "host"
    watch_supported: bool = True
    generated_at: str


def _parse_sandbox_lines(output: str) -> list[str]:
    normalized = (output or "").strip()
    if not normalized:
        return []
    if normalized in {"(no output)", "(empty)"}:
        return []
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    cleaned: list[str] = []
    for line in lines:
        if line.startswith("Std Error:") or line.startswith("Exit Code:"):
            continue
        cleaned.append(line)
    return cleaned


def _workspace_tree_is_sandbox_backed(thread_id: str) -> bool:
    """Return whether /mnt/user-data should be treated as sandbox-only storage.

    In provisioner-backed AIO sandboxes, /mnt/user-data lives inside the sandbox
    pod/container and is not volume-mounted to the gateway host filesystem.
    """
    profile = RuntimeProfileRepository().read(thread_id)
    if profile["execution_mode"] == "host":
        return False

    try:
        provider = get_sandbox_provider()
    except Exception:
        return False

    backend = getattr(provider, "_backend", None)
    return backend is not None and backend.__class__.__name__ == "RemoteSandboxBackend"


def _get_sandbox_for_thread(thread_id: str):
    provider = get_sandbox_provider()
    sandbox_id = provider.acquire(thread_id)
    sandbox = provider.get(sandbox_id)
    if sandbox is None:
        raise HTTPException(status_code=502, detail="Sandbox is not available")
    return sandbox


def _sandbox_dir_exists(sandbox, path: str) -> bool:
    quoted_path = shlex.quote(path)
    probe = sandbox.execute_command(f"test -d {quoted_path} && echo OK || echo MISSING")
    lines = _parse_sandbox_lines(probe)
    return bool(lines) and lines[0] == "OK"


def _sandbox_find_paths(
    sandbox,
    *,
    root: str,
    depth: int,
    include_hidden: bool,
    file_type: str,
) -> list[str]:
    quoted_root = shlex.quote(root)
    prune_parts: list[str] = []
    if not include_hidden:
        prune_parts.append("-path '*/.*'")
    for name in sorted(EXCLUDED_DIR_NAMES):
        prune_parts.append(f"-name {shlex.quote(name)}")
    prune_expr = " -o ".join(prune_parts)
    command = (
        f"find {quoted_root} -maxdepth {depth} -mindepth 1 "
        f"\\( {prune_expr} \\) -prune -o -type {file_type} -print 2>/dev/null"
    )
    output = sandbox.execute_command(command)
    return _parse_sandbox_lines(output)



def _ensure_workspace_tree_root(thread_id: str) -> None:
    """Create sandbox thread directories so a fresh chat can browse its workdir."""
    profile = RuntimeProfileRepository().read(thread_id)
    if profile["execution_mode"] == "host":
        return
    get_paths().ensure_thread_dirs(thread_id)



def _to_virtual_path(root_virtual: str, root_actual: Path, target: Path) -> str:
    relative = target.relative_to(root_actual)
    if relative.as_posix() == ".":
        return root_virtual
    return f"{root_virtual.rstrip('/')}/{relative.as_posix()}"



def _normalize_root(root: str) -> str:
    candidate = root.strip()
    if not candidate:
        return DEFAULT_ROOT
    if not candidate.startswith("/"):
        candidate = f"/{candidate}"
    return candidate.rstrip("/") or DEFAULT_ROOT


@router.get(
    "/meta",
    response_model=WorkspaceMetaResponse,
    summary="Resolve workspace meta",
    description="Return the actual host path backing the thread workspace root.",
)
async def get_workspace_meta(
    thread_id: str,
    root: str = Query(DEFAULT_ROOT, description="Virtual root path, defaults to /mnt/user-data"),
) -> WorkspaceMetaResponse:
    virtual_root = _normalize_root(root)
    _ensure_workspace_tree_root(thread_id)
    actual_root = resolve_thread_virtual_path(thread_id, virtual_root)
    profile = RuntimeProfileRepository().read(thread_id)
    tree_backend = "sandbox" if _workspace_tree_is_sandbox_backed(thread_id) else "host"

    return WorkspaceMetaResponse(
        thread_id=thread_id,
        root=virtual_root,
        actual_root=str(actual_root),
        execution_mode=str(profile["execution_mode"]),
        host_workdir=profile["host_workdir"],
        tree_backend=tree_backend,
        watch_supported=tree_backend == "host",
        generated_at=datetime.now(UTC).isoformat(),
    )


@router.get(
    "/tree",
    response_model=WorkspaceTreeResponse,
    summary="List workspace tree",
    description="List files and directories under /mnt/user-data for a thread.",
)
async def get_workspace_tree(
    thread_id: str,
    root: str = Query(DEFAULT_ROOT, description="Virtual root path, defaults to /mnt/user-data"),
    depth: int = Query(DEFAULT_MAX_DEPTH, ge=1, le=12, description="Maximum recursion depth"),
    include_hidden: bool = Query(False, description="Include hidden files and directories"),
    max_nodes: int = Query(DEFAULT_MAX_NODES, ge=100, le=20000, description="Maximum listed nodes"),
) -> WorkspaceTreeResponse:
    virtual_root = _normalize_root(root)
    _ensure_workspace_tree_root(thread_id)
    actual_root = resolve_thread_virtual_path(thread_id, virtual_root)

    if _workspace_tree_is_sandbox_backed(thread_id):
        sandbox = _get_sandbox_for_thread(thread_id)

        if not _sandbox_dir_exists(sandbox, virtual_root):
            sandbox.execute_command(f"mkdir -p {shlex.quote(virtual_root)}")
            if not _sandbox_dir_exists(sandbox, virtual_root):
                raise HTTPException(status_code=404, detail=f"Workspace path not found: {virtual_root}")

        directories: list[WorkspaceDirectoryEntry] = []
        files: list[WorkspaceFileEntry] = []
        truncated = False
        visited_nodes = 0

        root_path = Path(virtual_root)

        dir_paths = sorted(
            set(
                _sandbox_find_paths(
                    sandbox,
                    root=virtual_root,
                    depth=depth,
                    include_hidden=include_hidden,
                    file_type="d",
                ),
            ),
            key=lambda value: value.lower(),
        )
        file_paths = sorted(
            set(
                _sandbox_find_paths(
                    sandbox,
                    root=virtual_root,
                    depth=depth,
                    include_hidden=include_hidden,
                    file_type="f",
                ),
            ),
            key=lambda value: value.lower(),
        )

        for directory_path in dir_paths:
            if visited_nodes >= max_nodes:
                truncated = True
                break
            path_obj = Path(directory_path)
            try:
                relative = path_obj.relative_to(root_path)
            except ValueError:
                continue
            directories.append(
                WorkspaceDirectoryEntry(
                    path=directory_path,
                    name=path_obj.name,
                    depth=len(relative.parts),
                    child_count=0,
                    mtime=None,
                ),
            )
            visited_nodes += 1

        if not truncated:
            for file_path in file_paths:
                if visited_nodes >= max_nodes:
                    truncated = True
                    break
                path_obj = Path(file_path)
                try:
                    relative = path_obj.relative_to(root_path)
                except ValueError:
                    continue
                files.append(
                    WorkspaceFileEntry(
                        path=file_path,
                        name=path_obj.name,
                        depth=len(relative.parts),
                        size=0,
                        mtime=None,
                    ),
                )
                visited_nodes += 1

        return WorkspaceTreeResponse(
            root=virtual_root,
            generated_at=datetime.now(UTC).isoformat(),
            depth=depth,
            truncated=truncated,
            directories=directories,
            files=files,
        )

    if not actual_root.exists():
        raise HTTPException(status_code=404, detail=f"Workspace path not found: {virtual_root}")
    if not actual_root.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace path is not a directory: {virtual_root}")

    directories: list[WorkspaceDirectoryEntry] = []
    files: list[WorkspaceFileEntry] = []
    truncated = False
    visited_nodes = 0

    stack: list[tuple[Path, int]] = [(actual_root, 0)]
    while stack:
        current_dir, current_depth = stack.pop()
        if current_depth > depth:
            continue
        try:
            entries = list(current_dir.iterdir())
        except PermissionError:
            continue
        except OSError:
            continue

        dir_children: list[Path] = []
        file_children: list[Path] = []
        for child in entries:
            name = child.name
            if not include_hidden and name.startswith(HIDDEN_PREFIX):
                continue
            if child.is_dir():
                if name in EXCLUDED_DIR_NAMES:
                    continue
                dir_children.append(child)
            elif child.is_file():
                file_children.append(child)

        dir_children.sort(key=lambda p: p.name.lower())
        file_children.sort(key=lambda p: p.name.lower())

        for directory in dir_children:
            if visited_nodes >= max_nodes:
                truncated = True
                break
            try:
                stat = directory.stat()
            except OSError:
                stat = None
            directories.append(
                WorkspaceDirectoryEntry(
                    path=_to_virtual_path(virtual_root, actual_root, directory),
                    name=directory.name,
                    depth=current_depth + 1,
                    child_count=0,
                    mtime=stat.st_mtime if stat else None,
                ),
            )
            visited_nodes += 1
            if current_depth + 1 <= depth:
                stack.append((directory, current_depth + 1))
        if truncated:
            break

        for file in file_children:
            if visited_nodes >= max_nodes:
                truncated = True
                break
            try:
                stat = file.stat()
            except OSError:
                stat = None
            files.append(
                WorkspaceFileEntry(
                    path=_to_virtual_path(virtual_root, actual_root, file),
                    name=file.name,
                    depth=current_depth + 1,
                    size=stat.st_size if stat else 0,
                    mtime=stat.st_mtime if stat else None,
                ),
            )
            visited_nodes += 1
        if truncated:
            break

    return WorkspaceTreeResponse(
        root=virtual_root,
        generated_at=datetime.now(UTC).isoformat(),
        depth=depth,
        truncated=truncated,
        directories=directories,
        files=files,
    )
