from unittest.mock import MagicMock, patch

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
    mock_client.chat.return_value = "done"

    with (
        patch("src.scheduler.workflow.NionClient", return_value=mock_client) as client_cls,
        patch.object(executor, "_inject_context", return_value="prompt"),
    ):
        result = executor._run_agent_sync("task-1", step, {"source": "feed"})

    client_cls.assert_called_once_with(
        model_name="safe-model",
        thinking_enabled=False,
        subagent_enabled=True,
        plan_mode=True,
        session_mode="temporary_chat",
        memory_read=True,
        memory_write=False,
    )
    mock_client.chat.assert_called_once()
    call_args = mock_client.chat.call_args
    assert call_args.args == ("prompt",)
    assert call_args.kwargs["thread_id"].startswith("scheduler-task-1-")
    assert result["output"] == "done"
    assert result["error"] is None


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
    mock_client.chat.return_value = "done"

    with (
        patch("src.scheduler.workflow.NionClient", return_value=mock_client) as client_cls,
        patch.object(executor, "_inject_context", return_value="prompt"),
    ):
        result = executor._run_agent_sync("task-2", step, {})

    client_cls.assert_called_once_with(
        model_name="safe-model",
        thinking_enabled=True,
        subagent_enabled=False,
        plan_mode=False,
        session_mode=None,
        memory_read=None,
        memory_write=None,
    )
    mock_client.chat.assert_called_once()
    assert result["output"] == "done"
    assert result["error"] is None
