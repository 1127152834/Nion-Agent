from types import SimpleNamespace
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command

from src.agents.middlewares.clarification_middleware import ClarificationMiddleware


def test_wrap_tool_call_intercepts_clarification_and_sets_structured_payload():
    middleware = ClarificationMiddleware()
    request = SimpleNamespace(
        tool_call={
            "name": "ask_clarification",
            "id": "tc-clar-1",
            "args": {
                "question": "请选择部署环境？",
                "clarification_type": "approach_choice",
                "context": "部署前需要明确目标环境",
                "options": ["development", "staging", "production"],
            },
        }
    )

    command = middleware.wrap_tool_call(
        request,  # type: ignore[arg-type]
        lambda _req: ToolMessage(content="noop", tool_call_id="noop"),
    )

    assert isinstance(command, Command)
    assert command.goto == "__end__"
    assert isinstance(command.update, dict)
    assert "messages" in command.update
    assert "clarification" in command.update

    clarification = command.update["clarification"]
    assert clarification["status"] == "awaiting_user"
    assert clarification["question"] == "请选择部署环境？"
    assert clarification["clarification_type"] == "approach_choice"
    assert clarification["options"] == ["development", "staging", "production"]
    assert clarification["requires_choice"] is True
    assert clarification["tool_call_id"] == "tc-clar-1"
    assert clarification["asked_at"]
    assert clarification["resolved_at"] is None

    tool_message = command.update["messages"][0]
    assert isinstance(tool_message, ToolMessage)
    assert tool_message.name == "ask_clarification"
    assert tool_message.additional_kwargs["clarification"]["status"] == "awaiting_user"
    assert tool_message.additional_kwargs["clarification"]["requires_choice"] is True


def test_wrap_tool_call_without_options_marks_requires_choice_false():
    middleware = ClarificationMiddleware()
    request = SimpleNamespace(
        tool_call={
            "name": "ask_clarification",
            "id": "tc-clar-2",
            "args": {
                "question": "请补充项目目标用户画像。",
                "clarification_type": "missing_info",
            },
        }
    )

    command = middleware.wrap_tool_call(
        request,  # type: ignore[arg-type]
        lambda _req: ToolMessage(content="noop", tool_call_id="noop"),
    )

    assert isinstance(command, Command)
    assert isinstance(command.update, dict)
    clarification = command.update["clarification"]
    assert clarification["status"] == "awaiting_user"
    assert clarification["options"] == []
    assert clarification["requires_choice"] is False


def test_wrap_tool_call_delegates_non_clarification_calls():
    middleware = ClarificationMiddleware()
    request = SimpleNamespace(
        tool_call={
            "name": "read_file",
            "id": "tc-2",
            "args": {"path": "/tmp/a.txt"},
        }
    )
    expected = ToolMessage(content="ok", tool_call_id="tc-2")

    result = middleware.wrap_tool_call(
        request,  # type: ignore[arg-type]
        lambda _req: expected,
    )
    assert result is expected


def test_before_agent_marks_awaiting_clarification_as_resolved_on_new_human_message():
    middleware = ClarificationMiddleware()
    state = {
        "clarification": {
            "status": "awaiting_user",
            "question": "请选择部署环境？",
            "tool_call_id": "tc-clar-1",
            "asked_at": "2026-01-01T00:00:00+00:00",
            "resolved_at": None,
            "resolved_by_message_id": None,
        },
        "messages": [
            AIMessage(content="需要你确认部署环境。"),
            ToolMessage(content="❓ 请选择部署环境？", tool_call_id="tc-clar-1", name="ask_clarification"),
            HumanMessage(content="staging", id="hm-1"),
        ],
    }

    result = middleware.before_agent(state, runtime=MagicMock())
    assert isinstance(result, dict)
    assert "clarification" in result
    clarification = result["clarification"]
    assert clarification["status"] == "resolved"
    assert clarification["resolved_at"]
    assert clarification["resolved_by_message_id"] == "hm-1"


def test_before_agent_keeps_awaiting_status_without_new_human_message():
    middleware = ClarificationMiddleware()
    state = {
        "clarification": {
            "status": "awaiting_user",
            "question": "请选择部署环境？",
        },
        "messages": [
            AIMessage(content="需要你确认部署环境。"),
            ToolMessage(content="❓ 请选择部署环境？", tool_call_id="tc-clar-1", name="ask_clarification"),
        ],
    }

    result = middleware.before_agent(state, runtime=MagicMock())
    assert result is None
