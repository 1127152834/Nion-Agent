"""Workspace file tree APIs for thread-scoped user data."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from src.gateway.path_utils import resolve_thread_virtual_path
from src.runtime_profile import RuntimeProfileRepository

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
    generated_at: str



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

    return WorkspaceMetaResponse(
        thread_id=thread_id,
        root=virtual_root,
        actual_root=str(actual_root),
        execution_mode=str(profile["execution_mode"]),
        host_workdir=profile["host_workdir"],
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
