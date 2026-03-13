"""Middleware for intercepting clarification requests and presenting them to the user."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import NotRequired, cast, override

from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command


class ClarificationMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    clarification: NotRequired[dict | None]


class ClarificationMiddleware(AgentMiddleware[ClarificationMiddlewareState]):
    """Intercepts clarification tool calls and interrupts execution to present questions to the user.

    When the model calls the `ask_clarification` tool, this middleware:
    1. Intercepts the tool call before execution
    2. Extracts the clarification question and metadata
    3. Formats a user-friendly message
    4. Returns a Command that interrupts execution and presents the question
    5. Waits for user response before continuing

    This replaces the tool-based approach where clarification continued the conversation flow.
    """

    state_schema = ClarificationMiddlewareState

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _normalize_options(raw_options: object) -> list[str]:
        if not isinstance(raw_options, list):
            return []
        options: list[str] = []
        for item in raw_options:
            if isinstance(item, str):
                value = item.strip()
                if value:
                    options.append(value)
        return options

    def _build_clarification_payload(self, args: dict, tool_call_id: str | None) -> dict:
        question = str(args.get("question") or "").strip()
        clarification_type = str(args.get("clarification_type") or "missing_info").strip() or "missing_info"
        context = args.get("context")
        context_text = str(context).strip() if isinstance(context, str) and context.strip() else None
        options = self._normalize_options(args.get("options"))

        return {
            "status": "awaiting_user",
            "question": question,
            "clarification_type": clarification_type,
            "context": context_text,
            "options": options,
            "requires_choice": len(options) > 0,
            "tool_call_id": tool_call_id,
            "asked_at": self._now_iso(),
            "resolved_at": None,
            "resolved_by_message_id": None,
        }

    def _format_clarification_message(self, args: dict) -> str:
        """Format the clarification arguments into a user-friendly message.

        Args:
            args: The tool call arguments containing clarification details

        Returns:
            Formatted message string
        """
        question = args.get("question", "")
        clarification_type = args.get("clarification_type", "missing_info")
        context = args.get("context")
        options = args.get("options", [])

        # Type-specific icons
        type_icons = {
            "missing_info": "❓",
            "ambiguous_requirement": "🤔",
            "approach_choice": "🔀",
            "risk_confirmation": "⚠️",
            "suggestion": "💡",
        }

        icon = type_icons.get(clarification_type, "❓")

        # Build the message naturally
        message_parts = []

        # Add icon and question together for a more natural flow
        if context:
            # If there's context, present it first as background
            message_parts.append(f"{icon} {context}")
            message_parts.append(f"\n{question}")
        else:
            # Just the question with icon
            message_parts.append(f"{icon} {question}")

        # Add options in a cleaner format
        if options and len(options) > 0:
            message_parts.append("")  # blank line for spacing
            for i, option in enumerate(options, 1):
                message_parts.append(f"  {i}. {option}")

        return "\n".join(message_parts)

    def _handle_clarification(self, request: ToolCallRequest) -> Command:
        """Handle clarification request and return command to interrupt execution.

        Args:
            request: Tool call request

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Extract clarification arguments
        args = request.tool_call.get("args", {})
        question = args.get("question", "")

        print("[ClarificationMiddleware] Intercepted clarification request")
        print(f"[ClarificationMiddleware] Question: {question}")

        # Format the clarification message
        formatted_message = self._format_clarification_message(args)

        # Get the tool call ID
        tool_call_id = cast(str | None, request.tool_call.get("id"))
        clarification_payload = self._build_clarification_payload(args, tool_call_id)

        # Create a ToolMessage with the formatted question
        # This will be added to the message history
        tool_message = ToolMessage(
            content=formatted_message,
            tool_call_id=tool_call_id or "",
            name="ask_clarification",
            additional_kwargs={"clarification": clarification_payload},
        )

        # Return a Command that:
        # 1. Adds the formatted tool message
        # 2. Interrupts execution by going to __end__
        # Note: We don't add an extra AIMessage here - the frontend will detect
        # and display ask_clarification tool messages directly
        return Command(
            update={
                "messages": [tool_message],
                "clarification": clarification_payload,
            },
            goto=END,
        )

    @override
    def before_agent(
        self,
        state: ClarificationMiddlewareState,
        runtime: Runtime,
    ) -> dict | None:
        """Resolve awaiting clarification once a new human response arrives."""
        _ = runtime
        clarification = state.get("clarification")
        if not isinstance(clarification, dict):
            return None
        if clarification.get("status") != "awaiting_user":
            return None

        messages = state.get("messages", [])
        if not messages:
            return None

        last_message = messages[-1]
        if not isinstance(last_message, HumanMessage):
            return None

        resolved = dict(clarification)
        resolved["status"] = "resolved"
        resolved["resolved_at"] = self._now_iso()
        resolved["resolved_by_message_id"] = getattr(last_message, "id", None)
        return {"clarification": resolved}

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept ask_clarification tool calls and interrupt execution (sync version).

        Args:
            request: Tool call request
            handler: Original tool execution handler

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Check if this is an ask_clarification tool call
        if request.tool_call.get("name") != "ask_clarification":
            # Not a clarification call, execute normally
            return handler(request)

        return self._handle_clarification(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept ask_clarification tool calls and interrupt execution (async version).

        Args:
            request: Tool call request
            handler: Original tool execution handler (async)

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Check if this is an ask_clarification tool call
        if request.tool_call.get("name") != "ask_clarification":
            # Not a clarification call, execute normally
            return await handler(request)

        return self._handle_clarification(request)
