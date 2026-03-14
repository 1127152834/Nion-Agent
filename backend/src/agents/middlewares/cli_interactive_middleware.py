"""Middleware for intercepting CLI commands that require interactive input."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import override

from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState
from src.cli.catalog import load_cli_catalog
from src.sandbox.tools import ensure_sandbox_initialized


class CLIInteractiveMiddleware(AgentMiddleware[AgentState]):
    """Intercepts CLI tool calls that require interactive input.

    When a CLI tool is called with a command that requires user interaction
    (e.g., xhs-cli login), this middleware:
    1. Detects the interactive command pattern
    2. Interrupts execution and presents an input prompt to the user
    3. Waits for user response
    4. Executes the CLI command with the user's input via stdin
    """

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(UTC).isoformat()

    def _detect_interactive_command(self, tool_id: str, argv: list[str]) -> dict | None:
        """Detect if a CLI command requires interactive input.

        Args:
            tool_id: CLI tool ID (e.g., "xhs-cli")
            argv: Command arguments

        Returns:
            Interactive command config if detected, None otherwise
        """
        try:
            catalog = load_cli_catalog()
            tool_def = next((t for t in catalog.get("tools", []) if t.get("id") == tool_id), None)
            if not tool_def or "interactive_commands" not in tool_def:
                return None

            # Match command pattern
            command_str = " ".join(argv)
            for interactive_cmd in tool_def["interactive_commands"]:
                pattern = interactive_cmd.get("pattern", "")
                if re.search(pattern, command_str):
                    return interactive_cmd
            return None
        except Exception:
            return None

    def _build_cli_interactive_payload(
        self,
        tool_id: str,
        argv: list[str],
        interactive_config: dict,
        tool_call_id: str | None,
    ) -> dict:
        """Build CLI interactive payload for the ToolMessage."""
        input_method = interactive_config.get("input_method", "stdin")

        # PTY mode: the UI should open a streaming terminal connected via WebSocket.
        if input_method == "pty":
            session_id = str(uuid.uuid4())
            return {
                "status": "awaiting_terminal",
                "tool_id": tool_id,
                # Prefer argv going forward; keep legacy `command` for backward compatibility.
                "argv": argv,
                "command": argv,
                "interactive_type": interactive_config.get("type", "input"),
                "prompt": interactive_config.get("prompt", "该命令需要交互终端"),
                "input_method": "pty",
                "session_id": session_id,
                "websocket_url": f"/api/cli/sessions/{session_id}/stream",
                "tool_call_id": tool_call_id,
                "asked_at": self._now_iso(),
                "resolved_at": None,
                "resolved_by_message_id": None,
            }

        return {
            "status": "awaiting_input",
            "tool_id": tool_id,
            "argv": argv,
            "command": argv,
            "interactive_type": interactive_config.get("type", "input"),
            "prompt": interactive_config.get("prompt", "请输入内容"),
            "input_method": input_method,
            "tool_call_id": tool_call_id,
            "asked_at": self._now_iso(),
            "resolved_at": None,
            "resolved_by_message_id": None,
        }

    def _handle_cli_interactive(self, request: ToolCallRequest) -> Command:
        """Handle CLI interactive request and return command to interrupt execution."""
        tool_name = request.tool_call.get("name", "")
        args = request.tool_call.get("args", {})
        argv = args.get("argv", [])

        # Extract tool_id from tool_name (cli_xhs-cli -> xhs-cli)
        tool_id = tool_name.replace("cli_", "").replace("_", "-")

        # Detect interactive command
        interactive_config = self._detect_interactive_command(tool_id, argv)
        if not interactive_config:
            # Not an interactive command, should not reach here
            return Command()

        print(f"[CLIInteractiveMiddleware] Intercepted interactive CLI: {tool_id} {' '.join(argv)}")

        # Build payload
        tool_call_id = request.tool_call.get("id")
        cli_interactive_payload = self._build_cli_interactive_payload(
            tool_id, argv, interactive_config, tool_call_id
        )

        # Format message
        prompt = interactive_config.get("prompt", "请输入内容")
        if interactive_config.get("input_method") == "pty":
            formatted_message = (
                "🧪 CLI 工具需要交互终端\n\n"
                f"工具: {tool_id}\n命令: {' '.join(argv)}\n\n"
                f"{prompt}"
            )
        else:
            formatted_message = f"🔐 CLI 工具需要交互输入\n\n工具: {tool_id}\n命令: {' '.join(argv)}\n\n{prompt}"

        # Create ToolMessage
        tool_message = ToolMessage(
            content=formatted_message,
            tool_call_id=tool_call_id or "",
            name=tool_name,
            additional_kwargs={"cli_interactive": cli_interactive_payload},
        )

        # Interrupt execution
        return Command(
            update={"messages": [tool_message]},
            goto=END,
        )

    @override
    def before_agent(
        self,
        state: AgentState,
        runtime: Runtime,
    ) -> dict | None:
        """Resolve CLI interactive input when user responds."""
        messages = state.get("messages", [])
        if not messages:
            return None

        # Find last CLI interactive message
        last_cli_msg = None
        for msg in reversed(messages):
            if isinstance(msg, ToolMessage) and msg.additional_kwargs.get("cli_interactive"):
                last_cli_msg = msg
                break

        if not last_cli_msg:
            return None

        cli_payload = last_cli_msg.additional_kwargs["cli_interactive"]
        if cli_payload.get("status") != "awaiting_input":
            return None

        # Check if user has responded
        last_human_msg = next(
            (m for m in reversed(messages) if isinstance(m, HumanMessage)),
            None,
        )

        if not last_human_msg or last_human_msg.id == cli_payload.get("resolved_by_message_id"):
            return None

        # User has responded, execute CLI command with input
        user_input = last_human_msg.content
        tool_id = cli_payload["tool_id"]
        argv = cli_payload["command"]
        input_method = cli_payload["input_method"]

        print(f"[CLIInteractiveMiddleware] Executing CLI with user input: {tool_id}")

        try:
            sandbox = ensure_sandbox_initialized(runtime)

            # Build command based on input method
            if input_method == "stdin":
                # Use echo to pipe input to CLI
                command = f'echo "{user_input}" | {tool_id} {" ".join(argv)}'
            elif input_method == "env":
                # Use environment variable
                env_var = f"{tool_id.upper().replace('-', '_')}_INPUT"
                command = f'{env_var}="{user_input}" {tool_id} {" ".join(argv)}'
            elif input_method == "arg":
                # Append as argument
                command = f'{tool_id} {" ".join(argv)} "{user_input}"'
            else:
                command = f'{tool_id} {" ".join(argv)}'

            # Execute command
            result = sandbox.execute_command(command)

            # Update payload
            cli_payload["status"] = "resolved"
            cli_payload["resolved_at"] = self._now_iso()
            cli_payload["resolved_by_message_id"] = last_human_msg.id
            cli_payload["result"] = result

            # Update the ToolMessage in state
            updated_messages = []
            for msg in messages:
                if msg.id == last_cli_msg.id:
                    updated_msg = ToolMessage(
                        content=last_cli_msg.content,
                        tool_call_id=last_cli_msg.tool_call_id,
                        name=last_cli_msg.name,
                        additional_kwargs={"cli_interactive": cli_payload},
                        id=last_cli_msg.id,
                    )
                    updated_messages.append(updated_msg)
                else:
                    updated_messages.append(msg)

            return {"messages": updated_messages}

        except Exception as e:
            print(f"[CLIInteractiveMiddleware] Error executing CLI: {e}")
            cli_payload["status"] = "error"
            cli_payload["error"] = str(e)
            return None

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept CLI tool calls that require interactive input (sync version)."""
        tool_name = request.tool_call.get("name", "")

        # Only handle CLI tools
        if not tool_name.startswith("cli_"):
            return handler(request)

        # Extract tool_id and check if interactive
        tool_id = tool_name.replace("cli_", "").replace("_", "-")
        args = request.tool_call.get("args", {})
        argv = args.get("argv", [])

        interactive_config = self._detect_interactive_command(tool_id, argv)
        if not interactive_config:
            # Not interactive, execute normally
            return handler(request)

        # Interactive command detected, interrupt
        return self._handle_cli_interactive(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept CLI tool calls that require interactive input (async version)."""
        tool_name = request.tool_call.get("name", "")

        # Only handle CLI tools
        if not tool_name.startswith("cli_"):
            return await handler(request)

        # Extract tool_id and check if interactive
        tool_id = tool_name.replace("cli_", "").replace("_", "-")
        args = request.tool_call.get("args", {})
        argv = args.get("argv", [])

        interactive_config = self._detect_interactive_command(tool_id, argv)
        if not interactive_config:
            # Not interactive, execute normally
            return await handler(request)

        # Interactive command detected, interrupt
        return self._handle_cli_interactive(request)
