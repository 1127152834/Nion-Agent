"""Builtin A2UI tool definition.

This tool is intended to be intercepted by A2UIMiddleware. The python
implementation is a safe fallback in case the middleware is disabled or the
payload is invalid and we decide to execute the tool normally.
"""

from __future__ import annotations

from langchain.tools import tool


@tool("send_a2ui_json_to_client", parse_docstring=True)
def send_a2ui_json_to_client_tool(a2ui_json: object | None = None) -> str:
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
    - surfaceUpdate MUST use `components` (an array), not `contents`.
    - If you include dataModelUpdate, it MUST include `contents` as an array of DataEntry items:
      - { key, valueString | valueNumber | valueBoolean | valueMap }
      - Do NOT send a plain JSON object for contents (the client renderer will crash).

    Minimal example (static UI + safe data model):

    ```json
    [
      {
        "surfaceUpdate": {
          "surfaceId": "chat:THREAD:CALL",
          "components": [
            {
              "id": "root",
              "component": {
                "Column": {
                  "children": { "explicitList": ["title", "nameField", "submitBtn"] }
                }
              }
            },
            {
              "id": "title",
              "component": {
                "Text": { "text": { "literalString": "Create Task" }, "usageHint": "h2" }
              }
            },
            {
              "id": "nameField",
              "component": {
                "TextField": {
                  "label": { "literalString": "Name" },
                  "text": { "path": "/form/name" },
                  "textFieldType": "shortText"
                }
              }
            },
            {
              "id": "submitText",
              "component": { "Text": { "text": { "literalString": "Submit" } } }
            },
            {
              "id": "submitBtn",
              "component": {
                "Button": {
                  "primary": true,
                  "child": "submitText",
                  "action": {
                    "name": "submit",
                    "context": [{ "key": "name", "value": { "path": "/form/name" } }]
                  }
                }
              }
            }
          ]
        }
      },
      {
        "dataModelUpdate": {
          "surfaceId": "chat:THREAD:CALL",
          "path": "/",
          "contents": [
            { "key": "form", "valueMap": [{ "key": "name", "valueString": "" }] }
          ]
        }
      },
      { "beginRendering": { "surfaceId": "chat:THREAD:CALL", "root": "root" } }
    ]
    ```

    User interaction:
    - When the user clicks a button / submits a form, the system will inject a
      synthetic `log_a2ui_event` tool call + tool result into the conversation
      history. Treat that as a real user action and continue the workflow.

    Args:
        a2ui_json: A JSON array (recommended) OR a JSON string representing an array of A2UI messages.
    """
    return (
        "A2UI payload received, but no UI was rendered. "
        "If you are seeing this message, A2UIMiddleware is likely disabled "
        "or the provided a2ui_json was invalid. Please regenerate the A2UI JSON "
        "and ensure it contains surfaceUpdate + beginRendering in the same array."
    )
