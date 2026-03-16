from __future__ import annotations

import os
import re
from pathlib import Path

from langchain.tools import BaseTool
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.cli.manifests import load_cli_install_manifest
from src.config.extensions_config import ExtensionsConfig
from src.config.paths import CLIS_VIRTUAL_ROOT
from src.sandbox.exceptions import SandboxError
from src.sandbox.tools import (
    ensure_sandbox_initialized,
    ensure_thread_directories_exist,
    get_execution_mode,
    get_thread_data,
    is_local_sandbox,
    prefix_command_with_workdir,
    replace_virtual_paths_in_command,
)
from src.tools.builtins.langchain_compat import ToolRuntime, tool

_BLOCKED_HOST_PREFIXES = ("/Users/", "/home/", "/private/", "C:\\", "D:\\", "E:\\")
_MAX_TOOL_OUTPUT_CHARS = 120_000


def _slug(value: str) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"[\s_]+", "-", raw)
    raw = re.sub(r"[^a-z0-9-]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or "tool"


def _shell_quote_posix(value: str) -> str:
    if value == "":
        return "''"
    if re.fullmatch(r"[A-Za-z0-9_@%+=:,./-]+", value):
        return value
    return "'" + value.replace("'", "'\"'\"'") + "'"


def _shell_quote_powershell(value: str) -> str:
    # Single-quote escaping: ' -> ''
    return "'" + str(value).replace("'", "''") + "'"


def _build_command(program: str, argv: list[str]) -> str:
    if os.name == "nt":
        quoted = " ".join(_shell_quote_powershell(a) for a in argv)
        return f"& {_shell_quote_powershell(program)} {quoted}".rstrip()
    quoted = " ".join(_shell_quote_posix(a) for a in argv)
    return f"{_shell_quote_posix(program)} {quoted}".rstrip()


def _inject_managed_clis_path(command: str) -> str:
    """Prepend managed CLI bin dir to PATH for this command."""
    bin_dir = f"{CLIS_VIRTUAL_ROOT}/bin"
    if os.name == "nt":
        return f"$env:PATH = {_shell_quote_powershell(bin_dir + ';')} + $env:PATH; {command}"
    return f"PATH={_shell_quote_posix(bin_dir)}:$PATH {command}"


def _truncate_output(text: str) -> str:
    if not isinstance(text, str):
        return str(text)
    if len(text) <= _MAX_TOOL_OUTPUT_CHARS:
        return text
    tail_len = 4000
    head = text[:_MAX_TOOL_OUTPUT_CHARS]
    tail = text[-tail_len:] if tail_len > 0 else ""
    return f"{head}\n...(output truncated, total {len(text)} chars)...\n{tail}"


def _sandbox_mode_rejects_host_paths(values: list[str]) -> bool:
    for value in values:
        if any(prefix in value for prefix in _BLOCKED_HOST_PREFIXES):
            return True
    return False


def _make_cli_tool(*, tool_name: str, description: str, program: str) -> BaseTool:
    @tool(tool_name, parse_docstring=False)
    def _run_cli(runtime: ToolRuntime[ContextT, ThreadState], argv: list[str], timeout_seconds: int = 600) -> str:
        """Run a managed/system CLI with argv (arguments only).

        Args:
            argv: CLI arguments (do not include the executable itself).
            timeout_seconds: Execution timeout hint (v1 uses sandbox default timeout).
        """
        _ = timeout_seconds
        if not isinstance(argv, list) or any(not isinstance(item, str) for item in argv):
            return "Error: argv must be a list of strings."

        try:
            sandbox = ensure_sandbox_initialized(runtime)
            ensure_thread_directories_exist(runtime)
            execution_mode = get_execution_mode(runtime)
            if execution_mode == "sandbox":
                values = [program, *argv]
                if _sandbox_mode_rejects_host_paths(values):
                    return "Error: Sandbox mode only allows /mnt paths. Switch to host mode for host filesystem arguments."

            command = _build_command(program, argv)
            command = _inject_managed_clis_path(command)

            if is_local_sandbox(runtime):
                thread_data = get_thread_data(runtime)
                command = replace_virtual_paths_in_command(command, thread_data)
            command = prefix_command_with_workdir(command, runtime)
            return _truncate_output(sandbox.execute_command(command))
        except SandboxError as e:
            return f"Error: {e}"
        except Exception as e:
            return f"Error: Unexpected error executing CLI: {type(e).__name__}: {e}"

    _run_cli.description = description
    return _run_cli


def _managed_program_path(shim_rel: str) -> str:
    rel = str(Path(shim_rel)).lstrip("/").replace("\\", "/")
    # shim_rel is stored as "bin/<name>" (relative to clis root)
    return f"{CLIS_VIRTUAL_ROOT}/{rel}"


def get_cli_tools(*, agent_name: str | None = None) -> list[BaseTool]:
    """Build runtime CLI tools from extensions_config.json.

    Only enabled entries are exposed. Each enabled managed CLI exposes:
    - `cli_<tool_id>` for the first bin
    - `cli_<tool_id>_<bin>` for additional bins
    """
    _ = agent_name
    config = ExtensionsConfig.from_file()
    tools: list[BaseTool] = []

    for tool_id, cli in (config.clis or {}).items():
        if not getattr(cli, "enabled", False):
            continue

        base_name = f"cli_{_slug(tool_id)}"

        if getattr(cli, "source", "managed") == "managed":
            manifest = load_cli_install_manifest(tool_id)
            if manifest is None or not manifest.bins:
                tools.append(
                    _make_cli_tool(
                        tool_name=base_name,
                        description=f"CLI {tool_id} 未安装或未暴露可执行入口。",
                        program=_managed_program_path(f"bin/{tool_id}"),
                    )
                )
                continue

            for idx, bin_item in enumerate(manifest.bins):
                suffix = "" if idx == 0 else f"_{_slug(bin_item.name)}"
                tool_name = f"{base_name}{suffix}"
                program = _managed_program_path(bin_item.shim_rel)
                tools.append(
                    _make_cli_tool(
                        tool_name=tool_name,
                        description=f"运行 CLI `{tool_id}`（{bin_item.name}），参数用 argv 传入。",
                        program=program,
                    )
                )
            continue

        # system/custom
        exec_value = getattr(cli, "exec", None)
        if not isinstance(exec_value, str) or not exec_value.strip():
            tools.append(
                _make_cli_tool(
                    tool_name=base_name,
                    description=f"CLI {tool_id} 未配置 exec（source={getattr(cli, 'source', '')}）。",
                    program="__missing__",
                )
            )
            continue

        tools.append(
            _make_cli_tool(
                tool_name=base_name,
                description=f"运行 CLI `{tool_id}`（source={getattr(cli, 'source', '')}），参数用 argv 传入。",
                program=exec_value.strip(),
            )
        )

    return tools
