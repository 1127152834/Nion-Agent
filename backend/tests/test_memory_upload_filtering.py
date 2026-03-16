"""Tests for upload-event filtering in MemoryMiddleware."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from src.agents.middlewares.memory_middleware import MemoryMiddleware, _filter_messages_for_memory

_UPLOAD_BLOCK = "<uploaded_files>\nThe following files have been uploaded and are available for use:\n\n- filename: secret.txt\n  path: /mnt/user-data/uploads/abc123/secret.txt\n  size: 42 bytes\n</uploaded_files>"


def _human(text: str) -> HumanMessage:
    return HumanMessage(content=text)


def _ai(text: str, tool_calls=None) -> AIMessage:
    msg = AIMessage(content=text)
    if tool_calls:
        msg.tool_calls = tool_calls
    return msg


class TestFilterMessagesForMemory:
    def test_upload_only_turn_is_excluded(self):
        msgs = [_human(_UPLOAD_BLOCK), _ai("I have read the file. It says: Hello.")]
        result = _filter_messages_for_memory(msgs)
        assert result == []

    def test_upload_with_real_question_preserves_question(self):
        combined = _UPLOAD_BLOCK + "\n\nWhat does this file contain?"
        msgs = [_human(combined), _ai("The file contains: Hello Nion.")]
        result = _filter_messages_for_memory(msgs)

        assert len(result) == 2
        human_result = result[0]
        assert "<uploaded_files>" not in human_result.content
        assert "What does this file contain?" in human_result.content
        assert result[1].content == "The file contains: Hello Nion."

    def test_tool_messages_are_excluded(self):
        msgs = [
            _human("Search for something"),
            _ai("Calling search tool", tool_calls=[{"name": "search", "id": "1", "args": {}}]),
            ToolMessage(content="Search results", tool_call_id="1"),
            _ai("Here are the results."),
        ]
        result = _filter_messages_for_memory(msgs)
        human_msgs = [m for m in result if m.type == "human"]
        ai_msgs = [m for m in result if m.type == "ai"]
        assert len(human_msgs) == 1
        assert len(ai_msgs) == 1
        assert ai_msgs[0].content == "Here are the results."


def test_memory_middleware_writes_filtered_messages_via_graph_provider():
    mem_cfg = SimpleNamespace(enabled=True)
    provider = MagicMock()
    provider.resolve_policy.return_value = SimpleNamespace(allow_write=True, session_mode="normal")

    middleware = MemoryMiddleware()
    state = {
        "messages": [
            _human(_UPLOAD_BLOCK + "\n\nSummarise the file please."),
            _ai("The file says hello."),
        ]
    }
    runtime = SimpleNamespace(context={"thread_id": "thread-1"})

    with (
        patch("src.agents.middlewares.memory_middleware.get_memory_config", return_value=mem_cfg),
        patch("src.agents.middlewares.memory_middleware.get_default_memory_provider", return_value=provider),
    ):
        result = middleware.after_agent(state, runtime)

    assert result is None
    provider.queue_conversation_update.assert_called_once()
    request = provider.queue_conversation_update.call_args.args[0]
    assert request.thread_id == "thread-1"
    assert any(getattr(msg, "type", None) == "human" for msg in request.messages)
