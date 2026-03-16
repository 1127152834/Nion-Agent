from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.agents.middlewares.memory_middleware import MemoryMiddleware
from src.config.memory_config import MemoryConfig, set_memory_config


def teardown_function() -> None:
    set_memory_config(MemoryConfig())


class _DummyProvider:
    def __init__(self, *, allow_write: bool):
        self._allow_write = allow_write
        self.queue_calls: list[object] = []

    def resolve_policy(self, request):  # noqa: ANN001
        return SimpleNamespace(allow_write=self._allow_write, session_mode="normal")

    def queue_conversation_update(self, request):  # noqa: ANN001
        self.queue_calls.append(request)
        return True


class _DummyQueue:
    def __init__(self):
        self.calls: list[tuple[str, list[object], str | None]] = []

    def add(self, thread_id: str, messages: list[object], agent_name: str | None = None) -> None:
        self.calls.append((thread_id, messages, agent_name))


def _state_with_meaningful_messages():
    human = SimpleNamespace(type="human", content="你好", tool_calls=None)
    ai = SimpleNamespace(type="ai", content="我能帮你做什么？", tool_calls=None)
    return {"messages": [human, ai]}


@pytest.mark.unit
def test_BE_CORE_MEM_QUEUE_401_after_agent_enqueues_session_commit_when_enabled(monkeypatch):
    set_memory_config(MemoryConfig(enabled=True, openviking_session_commit_enabled=True))

    provider = _DummyProvider(allow_write=True)
    queue = _DummyQueue()
    monkeypatch.setattr("src.agents.middlewares.memory_middleware.get_default_memory_provider", lambda: provider)
    monkeypatch.setattr("src.agents.middlewares.memory_middleware.get_memory_queue", lambda: queue)

    middleware = MemoryMiddleware(agent_name="agent-x")
    runtime = SimpleNamespace(context={"thread_id": "thread-1"}, state={})

    assert middleware.after_agent(_state_with_meaningful_messages(), runtime) is None
    assert len(provider.queue_calls) == 1
    assert queue.calls and queue.calls[0][0] == "thread-1"
    assert queue.calls[0][2] == "agent-x"


@pytest.mark.unit
def test_BE_CORE_MEM_QUEUE_402_after_agent_does_not_enqueue_session_commit_when_disabled(monkeypatch):
    set_memory_config(MemoryConfig(enabled=True, openviking_session_commit_enabled=False))

    provider = _DummyProvider(allow_write=True)
    queue = _DummyQueue()
    monkeypatch.setattr("src.agents.middlewares.memory_middleware.get_default_memory_provider", lambda: provider)
    monkeypatch.setattr("src.agents.middlewares.memory_middleware.get_memory_queue", lambda: queue)

    middleware = MemoryMiddleware(agent_name=None)
    runtime = SimpleNamespace(context={"thread_id": "thread-2"}, state={})

    assert middleware.after_agent(_state_with_meaningful_messages(), runtime) is None
    assert len(provider.queue_calls) == 1
    assert queue.calls == []


@pytest.mark.unit
def test_BE_CORE_MEM_QUEUE_403_temporary_chat_policy_blocks_enqueue_and_structured_write(monkeypatch):
    set_memory_config(MemoryConfig(enabled=True, openviking_session_commit_enabled=True))

    provider = _DummyProvider(allow_write=False)
    queue = _DummyQueue()
    monkeypatch.setattr("src.agents.middlewares.memory_middleware.get_default_memory_provider", lambda: provider)
    monkeypatch.setattr("src.agents.middlewares.memory_middleware.get_memory_queue", lambda: queue)

    middleware = MemoryMiddleware(agent_name=None)
    runtime = SimpleNamespace(context={"thread_id": "thread-3"}, state={})

    assert middleware.after_agent(_state_with_meaningful_messages(), runtime) is None
    assert provider.queue_calls == []
    assert queue.calls == []

