from types import SimpleNamespace
from unittest.mock import patch

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.provider import V2CompatibleMemoryProvider


class DummyRuntime:
    def __init__(self):
        self.memory_data = {"facts": [{"content": "kept"}]}
        self.reload_data = {"facts": [{"content": "reloaded"}]}
        self.queue_calls: list[MemoryWriteRequest] = []

    def get_memory_data(self, request: MemoryReadRequest) -> dict:
        return {"agent_name": request.agent_name, **self.memory_data}

    def reload_memory_data(self, request: MemoryReadRequest) -> dict:
        return {"agent_name": request.agent_name, **self.reload_data}

    def queue_update(self, request: MemoryWriteRequest) -> None:
        self.queue_calls.append(request)


def _memory_config(enabled: bool = True, injection_enabled: bool = True, max_injection_tokens: int = 2000):
    return SimpleNamespace(
        enabled=enabled,
        injection_enabled=injection_enabled,
        max_injection_tokens=max_injection_tokens,
    )


def test_provider_delegates_memory_reads_to_runtime():
    runtime = DummyRuntime()
    provider = V2CompatibleMemoryProvider(runtime=runtime)

    assert provider.get_memory_data(MemoryReadRequest(agent_name="writer")) == {
        "agent_name": "writer",
        "facts": [{"content": "kept"}],
    }
    assert provider.reload_memory_data(MemoryReadRequest(agent_name="writer")) == {
        "agent_name": "writer",
        "facts": [{"content": "reloaded"}],
    }


@patch("src.config.memory_config.get_memory_config", return_value=_memory_config())
@patch("src.agents.memory.format_memory_for_injection", return_value="remember this")
def test_build_injection_context_formats_memory(_format_memory, _get_memory_config):
    runtime = DummyRuntime()
    provider = V2CompatibleMemoryProvider(runtime=runtime)

    result = provider.build_injection_context(MemoryReadRequest(agent_name="writer"))

    assert result == "<memory>\nremember this\n</memory>\n"


@patch("src.config.memory_config.get_memory_config", return_value=_memory_config())
def test_build_injection_context_respects_memory_read_gate(_get_memory_config):
    runtime = DummyRuntime()
    provider = V2CompatibleMemoryProvider(runtime=runtime)

    result = provider.build_injection_context(MemoryReadRequest(runtime_context={"memory_read": False}))

    assert result == ""


def test_queue_conversation_update_blocks_when_write_disabled():
    runtime = DummyRuntime()
    provider = V2CompatibleMemoryProvider(runtime=runtime)

    queued = provider.queue_conversation_update(
        MemoryWriteRequest(
            thread_id="thread-1",
            messages=["hello"],
            runtime_context={"memory_write": False},
        )
    )

    assert queued is False
    assert runtime.queue_calls == []


def test_queue_conversation_update_delegates_when_allowed():
    runtime = DummyRuntime()
    provider = V2CompatibleMemoryProvider(runtime=runtime)
    messages = ["hello", "world"]

    queued = provider.queue_conversation_update(
        MemoryWriteRequest(
            thread_id="thread-1",
            messages=messages,
            agent_name="writer",
            runtime_context={"session_mode": "temporary_chat", "memory_write": True},
        )
    )

    assert queued is True
    assert runtime.queue_calls == [
        MemoryWriteRequest(
            thread_id="thread-1",
            messages=messages,
            agent_name="writer",
            runtime_context={"session_mode": "temporary_chat", "memory_write": True},
        )
    ]


def test_build_injection_context_includes_high_confidence_key_facts():
    runtime = DummyRuntime()
    runtime.memory_data = {
        "user": {
            "personalContext": {"summary": "User prefers concise replies.", "updatedAt": "2026-03-10T00:00:00Z"}
        },
        "history": {},
        "facts": [
            {
                "content": "User likes Python",
                "category": "preference",
                "confidence": 0.95,
                "createdAt": "2026-03-10T12:00:00Z",
            },
            {
                "content": "User dislikes Java",
                "category": "preference",
                "confidence": 0.9,
                "createdAt": "2026-03-10T11:00:00Z",
            },
            {
                "content": "Low confidence item",
                "category": "context",
                "confidence": 0.4,
                "createdAt": "2026-03-10T10:00:00Z",
            },
        ],
    }
    provider = V2CompatibleMemoryProvider(runtime=runtime)

    with patch(
        "src.config.memory_config.get_memory_config",
        return_value=SimpleNamespace(
            enabled=True,
            injection_enabled=True,
            max_injection_tokens=2000,
            fact_confidence_threshold=0.7,
        ),
    ):
        result = provider.build_injection_context(MemoryReadRequest(agent_name="writer"))

    assert "Personal: User prefers concise replies." in result
    assert "Key Facts:" in result
    assert "User likes Python" in result
    assert "User dislikes Java" in result
    assert "Low confidence item" not in result



def test_build_injection_context_skips_facts_when_memory_read_disabled():
    runtime = DummyRuntime()
    runtime.memory_data = {
        "user": {},
        "history": {},
        "facts": [
            {
                "content": "User likes Python",
                "category": "preference",
                "confidence": 0.95,
                "createdAt": "2026-03-10T12:00:00Z",
            }
        ],
    }
    provider = V2CompatibleMemoryProvider(runtime=runtime)

    with patch(
        "src.config.memory_config.get_memory_config",
        return_value=SimpleNamespace(
            enabled=True,
            injection_enabled=True,
            max_injection_tokens=2000,
            fact_confidence_threshold=0.7,
        ),
    ):
        result = provider.build_injection_context(
            MemoryReadRequest(agent_name="writer", runtime_context={"memory_read": False})
        )

    assert result == ""
