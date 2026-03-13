from unittest.mock import MagicMock, patch

from types import SimpleNamespace

from src.scheduler.models import AgentStep
from src.scheduler.workflow import WorkflowExecutor


def test_run_agent_sync_passes_memory_session_fields_to_nion_client():
    executor = WorkflowExecutor()
    step = AgentStep(
        agent_name="writer",
        prompt="Summarize the inputs",
        agent_config={
            "model_name": "safe-model",
            "thinking_enabled": False,
            "subagent_enabled": True,
            "plan_mode": True,
            "session_mode": "temporary_chat",
            "memory_read": True,
            "memory_write": False,
        },
    )
    mock_client = MagicMock()
    mock_client.stream.return_value = [
        SimpleNamespace(type="messages-tuple", data={"type": "ai", "content": "done"}),
        SimpleNamespace(type="values", data={"artifacts": ["out.txt"], "artifact_groups": []}),
        SimpleNamespace(type="end", data={}),
    ]

    with (
        patch("src.scheduler.workflow.NionClient", return_value=mock_client) as client_cls,
        patch.object(executor, "_inject_context", return_value="prompt"),
    ):
        result = executor._run_agent_sync(
            "task-1",
            step,
            {"source": "feed"},
            "trace-1",
            "scheduler-task-1-trace-1",
        )

    client_cls.assert_called_once_with(
        model_name="safe-model",
        thinking_enabled=False,
        subagent_enabled=True,
        plan_mode=True,
        session_mode="temporary_chat",
        memory_read=True,
        memory_write=False,
    )
    mock_client.stream.assert_called_once()
    call_args = mock_client.stream.call_args
    assert call_args.args == ("prompt",)
    assert call_args.kwargs["thread_id"] == "scheduler-task-1-trace-1"
    assert call_args.kwargs["trace_id"] == "trace-1"
    assert call_args.kwargs["agent_name"] == "writer"
    assert result["output"] == "done"
    assert result["error"] is None
    assert result["artifacts"] == ["out.txt"]


def test_run_agent_sync_keeps_missing_memory_session_fields_compatible():
    executor = WorkflowExecutor()
    step = AgentStep(
        agent_name="writer",
        prompt="Summarize the inputs",
        agent_config={
            "model_name": "safe-model",
        },
    )
    mock_client = MagicMock()
    mock_client.stream.return_value = [
        SimpleNamespace(type="messages-tuple", data={"type": "ai", "content": "done"}),
        SimpleNamespace(type="values", data={"artifacts": [], "artifact_groups": []}),
        SimpleNamespace(type="end", data={}),
    ]

    with (
        patch("src.scheduler.workflow.NionClient", return_value=mock_client) as client_cls,
        patch.object(executor, "_inject_context", return_value="prompt"),
    ):
        result = executor._run_agent_sync(
            "task-2",
            step,
            {},
            "trace-2",
            "scheduler-task-2-trace-2",
        )

    client_cls.assert_called_once_with(
        model_name="safe-model",
        thinking_enabled=True,
        subagent_enabled=False,
        plan_mode=False,
        session_mode=None,
        memory_read=None,
        memory_write=None,
    )
    assert result["output"] == "done"
    assert result["error"] is None


def test_run_agent_sync_passes_agent_name_to_nion_client_chat():
    executor = WorkflowExecutor()
    step = AgentStep(
        agent_name="writer",
        prompt="Summarize the inputs",
        agent_config={
            "model_name": "safe-model",
        },
    )
    mock_client = MagicMock()
    mock_client.stream.return_value = [
        SimpleNamespace(type="messages-tuple", data={"type": "ai", "content": "done"}),
        SimpleNamespace(type="values", data={"artifacts": [], "artifact_groups": []}),
        SimpleNamespace(type="end", data={}),
    ]

    with (
        patch("src.scheduler.workflow.NionClient", return_value=mock_client),
        patch.object(executor, "_inject_context", return_value="prompt"),
    ):
        executor._run_agent_sync(
            "task-3",
            step,
            {},
            "trace-3",
            "scheduler-task-3-trace-3",
        )

    mock_client.stream.assert_called_once()
    call_args = mock_client.stream.call_args
    assert call_args.args == ("prompt",)
    assert call_args.kwargs["agent_name"] == "writer"
    assert call_args.kwargs["thread_id"] == "scheduler-task-3-trace-3"
