from types import SimpleNamespace

from langchain_core.messages import ToolMessage
from langgraph.types import Command

from src.agents.middlewares.a2ui_middleware import A2UIMiddleware


def _noop_handler(_req):
    return ToolMessage(content="noop", tool_call_id="noop")


def _make_request(*, tool_call: dict, context: dict):
    # A2UIMiddleware only relies on `request.tool_call` and `request.runtime.context`.
    runtime = SimpleNamespace(context=context)
    return SimpleNamespace(tool_call=tool_call, runtime=runtime)


def test_wrap_tool_call_parse_failure_returns_internal_validation_error_and_increments_attempts():
    middleware = A2UIMiddleware()
    ctx: dict = {}

    request = _make_request(
        tool_call={
            "name": "send_a2ui_json_to_client",
            "id": "tc-a2ui-parse-1",
            "args": {"a2ui_json": "not-json"},
        },
        context=ctx,
    )

    result1 = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result1, ToolMessage)
    assert result1.name == "send_a2ui_json_to_client"
    assert result1.additional_kwargs["internal"] is True
    assert "a2ui_validation_error" in result1.additional_kwargs
    assert ctx["_a2ui_validation"]["repair_attempts"] == 1
    assert result1.additional_kwargs["a2ui_validation_error"]["repair_attempt"] == 1

    result2 = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result2, ToolMessage)
    assert result2.additional_kwargs["internal"] is True
    assert ctx["_a2ui_validation"]["repair_attempts"] == 2
    assert result2.additional_kwargs["a2ui_validation_error"]["repair_attempt"] == 2


def test_wrap_tool_call_exceeds_repair_attempts_falls_back_to_clarification_command():
    middleware = A2UIMiddleware()
    ctx: dict = {}

    request = _make_request(
        tool_call={
            "name": "send_a2ui_json_to_client",
            "id": "tc-a2ui-parse-2",
            "args": {"a2ui_json": "not-json"},
        },
        context=ctx,
    )

    result1 = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result1, ToolMessage)
    assert ctx["_a2ui_validation"]["repair_attempts"] == 1

    result2 = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result2, ToolMessage)
    assert ctx["_a2ui_validation"]["repair_attempts"] == 2

    result3 = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result3, Command)
    assert result3.goto == "__end__"
    assert isinstance(result3.update, dict)
    assert "clarification" in result3.update
    assert "messages" in result3.update
    tool_message = result3.update["messages"][0]
    assert isinstance(tool_message, ToolMessage)
    assert tool_message.name == "ask_clarification"
    clarification = tool_message.additional_kwargs["clarification"]
    assert clarification["status"] == "awaiting_user"
    assert clarification["requires_choice"] is True
    assert clarification["options"] == ["重试生成界面", "改用文字继续"]


def test_wrap_tool_call_normalization_failure_returns_internal_validation_error():
    middleware = A2UIMiddleware()
    ctx: dict = {}

    # Missing beginRendering -> should be considered invalid for first render.
    request = _make_request(
        tool_call={
            "name": "send_a2ui_json_to_client",
            "id": "tc-a2ui-norm-1",
            "args": {
                "a2ui_json": [
                    {
                        "surfaceUpdate": {
                            "surfaceId": "surface-x",
                            "components": [
                                {
                                    "id": "root",
                                    "component": {"Text": {"text": {"literalString": "hi"}}},
                                }
                            ],
                        }
                    }
                ]
            },
        },
        context=ctx,
    )

    result = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result, ToolMessage)
    assert result.additional_kwargs["internal"] is True
    details = result.additional_kwargs["a2ui_validation_error"]
    assert details["kind"] == "a2ui_validation_failed"
    assert details["repair_attempt"] == 1
    assert "v0.8" in details["error"]


def test_wrap_tool_call_valid_payload_resets_attempts_and_returns_command_with_a2ui_payload():
    middleware = A2UIMiddleware()
    ctx: dict = {}

    # First make one failure so we can verify the reset behavior.
    bad_request = _make_request(
        tool_call={
            "name": "send_a2ui_json_to_client",
            "id": "tc-a2ui-reset-1",
            "args": {"a2ui_json": "not-json"},
        },
        context=ctx,
    )
    bad = middleware.wrap_tool_call(bad_request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(bad, ToolMessage)
    assert ctx["_a2ui_validation"]["repair_attempts"] == 1

    valid_request = _make_request(
        tool_call={
            "name": "send_a2ui_json_to_client",
            "id": "tc-a2ui-ok-1",
            "args": {
                "a2ui_json": [
                    {
                        "surfaceUpdate": {
                            "surfaceId": "surface-ok",
                            "components": [
                                {
                                    "id": "root",
                                    "component": {"Text": {"text": {"literalString": "ok"}}},
                                }
                            ],
                        }
                    },
                    {"beginRendering": {"surfaceId": "surface-ok", "root": "root"}},
                ]
            },
        },
        context=ctx,
    )

    result = middleware.wrap_tool_call(valid_request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result, Command)
    assert result.goto == "__end__"
    assert ctx["_a2ui_validation"]["repair_attempts"] == 0

    tool_message = result.update["messages"][0]
    assert isinstance(tool_message, ToolMessage)
    assert tool_message.name == "send_a2ui_json_to_client"
    payload = tool_message.additional_kwargs["a2ui"]
    assert payload["status"] == "awaiting_user"
    assert payload["surface_id"] == "surface-ok"
    assert isinstance(payload["operations"], list)


def test_wrap_tool_call_accepts_multi_op_dict_envelope_and_succeeds():
    middleware = A2UIMiddleware()
    ctx: dict = {}

    # Some models emit multiple operations in a single dict; we should split it deterministically.
    request = _make_request(
        tool_call={
            "name": "send_a2ui_json_to_client",
            "id": "tc-a2ui-envelope-1",
            "args": {
                "a2ui_json": {
                    "surfaceUpdate": {
                        "surfaceId": "surface-envelope",
                        "components": [
                            {
                                "id": "root",
                                "component": {"Text": {"text": {"literalString": "ok"}}},
                            }
                        ],
                    },
                    "beginRendering": {"surfaceId": "surface-envelope", "root": "root"},
                }
            },
        },
        context=ctx,
    )

    result = middleware.wrap_tool_call(request, _noop_handler)  # type: ignore[arg-type]
    assert isinstance(result, Command)
    tool_message = result.update["messages"][0]
    assert isinstance(tool_message, ToolMessage)
    payload = tool_message.additional_kwargs["a2ui"]
    assert payload["surface_id"] == "surface-envelope"
