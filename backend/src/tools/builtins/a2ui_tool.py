"""Builtin A2UI tool definition.

This tool is intended to be intercepted by A2UIMiddleware. The python
implementation is a safe fallback in case the middleware is disabled or the
payload is invalid and we decide to execute the tool normally.
"""

from __future__ import annotations

from langchain.tools import tool


@tool("send_a2ui_json_to_client", parse_docstring=True)
def send_a2ui_json_to_client_tool(a2ui_json: str) -> str:
    """Send A2UI JSON to the client to render an interactive UI surface.

    Use this tool when you need the user to fill a form, choose options, or
    confirm an operation in a product-friendly way, instead of asking them to
    copy/paste JSON or answer multiple text questions.

    Critical protocol rules (A2UI v0.8):
    - You MUST send ALL messages in ONE call as a JSON array, in this order:
      1) surfaceUpdate (REQUIRED)
      2) dataModelUpdate (OPTIONAL)
      3) beginRendering (REQUIRED)
    - beginRendering is mandatory. Without it, the UI will not display.
    - surfaceId must be unique per surface.
    - beginRendering.root must reference a component id defined in surfaceUpdate.

    User interaction:
    - When the user clicks a button / submits a form, the system will inject a
      synthetic `log_a2ui_event` tool call + tool result into the conversation
      history. Treat that as a real user action and continue the workflow.

    Args:
        a2ui_json: A JSON string representing an array of A2UI messages.
    """
    return (
        "A2UI payload received, but no UI was rendered. "
        "If you are seeing this message, A2UIMiddleware is likely disabled "
        "or the provided a2ui_json was invalid. Please regenerate the A2UI JSON "
        "and ensure it contains surfaceUpdate + beginRendering in the same array."
    )

