from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

from langchain_core.messages import AIMessage, HumanMessage

from src.agents.middlewares.memory_middleware import MemoryMiddleware
from src.agents.memory.policy import resolve_memory_policy


def test_policy_defaults_to_normal_session_when_fields_missing() -> None:
    policy = resolve_memory_policy()

    assert policy.session_mode == "normal"
    assert policy.allow_read is True
    assert policy.allow_write is True


def test_policy_temporary_chat_defaults_to_read_only() -> None:
    policy = resolve_memory_policy(runtime_context={"session_mode": "temporary_chat"})

    assert policy.session_mode == "temporary_chat"
    assert policy.allow_read is True
    assert policy.allow_write is False


def test_policy_explicit_flags_override_temporary_defaults() -> None:
    policy = resolve_memory_policy(
        runtime_context={
            "session_mode": "temporary_chat",
            "memory_read": False,
            "memory_write": True,
        }
    )

    assert policy.session_mode == "temporary_chat"
    assert policy.allow_read is False
    assert policy.allow_write is True


def test_memory_middleware_skips_queue_when_writes_disabled(monkeypatch) -> None:
    middleware = MemoryMiddleware()
    queue = Mock()

    monkeypatch.setattr(
        "src.agents.middlewares.memory_middleware.get_memory_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.memory_middleware.get_memory_queue",
        lambda: queue,
    )

    state = {
        "messages": [
            HumanMessage(content="hello"),
            AIMessage(content="world"),
        ]
    }
    runtime = SimpleNamespace(context={"thread_id": "thread-1", "memory_write": False})

    result = middleware.after_agent(state, runtime)

    assert result is None
    queue.add.assert_not_called()


def test_memory_middleware_skips_queue_for_temporary_chat(monkeypatch) -> None:
    middleware = MemoryMiddleware()
    queue = Mock()

    monkeypatch.setattr(
        "src.agents.middlewares.memory_middleware.get_memory_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.memory_middleware.get_memory_queue",
        lambda: queue,
    )

    state = {
        "messages": [
            HumanMessage(content="hello"),
            AIMessage(content="world"),
        ]
    }
    runtime = SimpleNamespace(context={"thread_id": "thread-2", "session_mode": "temporary_chat"})

    result = middleware.after_agent(state, runtime)

    assert result is None
    queue.add.assert_not_called()


def test_memory_middleware_queues_normal_session(monkeypatch) -> None:
    middleware = MemoryMiddleware()
    queue = Mock()

    monkeypatch.setattr(
        "src.agents.middlewares.memory_middleware.get_memory_config",
        lambda: SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.memory_middleware.get_memory_queue",
        lambda: queue,
    )

    state = {
        "messages": [
            HumanMessage(content="hello"),
            AIMessage(content="world"),
        ]
    }
    runtime = SimpleNamespace(context={"thread_id": "thread-3"})

    result = middleware.after_agent(state, runtime)

    assert result is None
    queue.add.assert_called_once()
