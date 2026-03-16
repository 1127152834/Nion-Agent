from __future__ import annotations

from pathlib import Path
from typing import Annotated

from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from nion.agents.thread_state import ThreadState
from nion.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from nion.sandbox.sandbox_provider import get_sandbox_provider
from nion.tools.builtins.langchain_compat import InjectedToolCallId, ToolRuntime, tool

OUTPUTS_VIRTUAL_PREFIX = f"{VIRTUAL_PATH_PREFIX}/outputs"


def resolve_thread_virtual_path(thread_id: str, virtual_path: str) -> Path:
    """Compatibility wrapper for virtual-path resolution in present_files."""
    return get_paths().resolve_virtual_path(thread_id, virtual_path)


def _sandbox_file_exists(thread_id: str, virtual_path: str) -> bool:
    try:
        provider = get_sandbox_provider()
        sandbox_id = provider.acquire(thread_id)
        sandbox = provider.get(sandbox_id)
        if sandbox is None:
            return False
        # Always return 0 so provider implementations that decorate stderr/exit-code
        # do not confuse parsing.
        probe = sandbox.execute_command(
            f"test -f {virtual_path!r} && echo OK || echo MISSING",
        )
        first_line = (probe or "").strip().splitlines()[:1]
        return bool(first_line) and first_line[0].strip() == "OK"
    except Exception:
        return False


def _normalize_presented_filepath(
    runtime: ToolRuntime[ContextT, ThreadState],
    filepath: str,
) -> str:
    """Normalize a presented file path to the `/mnt/user-data/outputs/*` contract."""
    if runtime.state is None:
        raise ValueError("Thread runtime state is not available")

    thread_id = runtime.context.get("thread_id")
    if not thread_id:
        raise ValueError("Thread ID is not available in runtime context")

    thread_data = runtime.state.get("thread_data") or {}
    outputs_path = thread_data.get("outputs_path")
    if not outputs_path:
        raise ValueError("Thread outputs path is not available in runtime state")

    outputs_dir = Path(outputs_path).resolve()
    stripped = filepath.lstrip("/")
    virtual_prefix = VIRTUAL_PATH_PREFIX.lstrip("/")

    if stripped == virtual_prefix or stripped.startswith(virtual_prefix + "/"):
        normalized_virtual = filepath if filepath.startswith("/") else f"/{filepath}"
        # Enforce outputs-only contract using virtual paths first (works for remote sandboxes).
        if not (normalized_virtual == OUTPUTS_VIRTUAL_PREFIX or normalized_virtual.startswith(OUTPUTS_VIRTUAL_PREFIX + "/")):
            raise ValueError(f"Only files in {OUTPUTS_VIRTUAL_PREFIX} can be presented: {filepath}")

        actual_path = resolve_thread_virtual_path(thread_id, normalized_virtual)
    else:
        actual_path = Path(filepath).expanduser().resolve()

    if not actual_path.exists():
        # Provisioner-backed AIO sandboxes keep /mnt/user-data inside the sandbox pod
        # and the host filesystem mirror is empty. Fall back to sandbox existence.
        if stripped == virtual_prefix or stripped.startswith(virtual_prefix + "/"):
            if not _sandbox_file_exists(thread_id, normalized_virtual):
                raise ValueError(f"File not found: {filepath}")
        else:
            raise ValueError(f"File not found: {filepath}")
    if actual_path.exists() and not actual_path.is_file():
        raise ValueError(f"Path is not a file: {filepath}")

    try:
        relative_path = actual_path.relative_to(outputs_dir)
    except ValueError as exc:
        # When the host filesystem mirror is missing, rely on virtual path instead.
        if stripped == virtual_prefix or stripped.startswith(virtual_prefix + "/"):
            relative_path = Path(normalized_virtual[len(OUTPUTS_VIRTUAL_PREFIX) :].lstrip("/"))
        else:
            raise ValueError(f"Only files in {OUTPUTS_VIRTUAL_PREFIX} can be presented: {filepath}") from exc

    return f"{OUTPUTS_VIRTUAL_PREFIX}/{relative_path.as_posix()}"


def _normalize_presentable_path(path: str) -> str | None:
    candidate = path.strip()
    if not candidate:
        return None

    prefix = VIRTUAL_PATH_PREFIX.rstrip("/")
    normalized = candidate if candidate.startswith("/") else f"/{candidate}"
    if normalized == prefix or normalized.startswith(prefix + "/"):
        return normalized
    return None


@tool("present_files", parse_docstring=True)
def present_file_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    filepaths: list[str],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> Command:
    """Make files visible to the user for viewing and rendering in the client interface.

    When to use the present_files tool:

    - Making any file available for the user to view, download, or interact with
    - Presenting multiple related files at once
    - After creating files that should be presented to the user

    When NOT to use the present_files tool:
    - When you only need to read file contents for your own processing
    - For temporary or intermediate files not meant for user viewing

    Notes:
    - You should call this tool after creating files and moving them to the `/mnt/user-data/outputs` directory.
    - This tool can be safely called in parallel with other tools. State updates are handled by a reducer to prevent conflicts.

    Args:
        filepaths: List of absolute file paths to present to the user. **Only** files in `/mnt/user-data/outputs` can be presented.
    """
    has_runtime = bool(runtime is not None and getattr(runtime, "state", None) is not None and isinstance(getattr(runtime, "context", None), dict) and runtime.context.get("thread_id"))

    if has_runtime:
        try:
            normalized_paths = [_normalize_presented_filepath(runtime, filepath) for filepath in filepaths]
        except ValueError as exc:
            return Command(
                update={"messages": [ToolMessage(f"Error: {exc}", tool_call_id=tool_call_id)]},
            )
        return Command(
            update={
                "artifacts": normalized_paths,
                "messages": [ToolMessage("Successfully presented files", tool_call_id=tool_call_id)],
            },
        )

    valid_paths: list[str] = []
    ignored_count = 0
    for filepath in filepaths:
        normalized = _normalize_presentable_path(filepath)
        if normalized is None:
            ignored_count += 1
            continue
        valid_paths.append(normalized)

    message = "Successfully presented files"
    if ignored_count > 0:
        message = f"Presented allowed files only. Ignored {ignored_count} path(s) outside {VIRTUAL_PATH_PREFIX}."

    return Command(
        update={"artifacts": valid_paths, "messages": [ToolMessage(message, tool_call_id=tool_call_id)]},
    )
