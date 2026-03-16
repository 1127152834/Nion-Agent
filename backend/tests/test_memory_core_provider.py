from types import SimpleNamespace
from unittest.mock import patch

from nion.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from nion.agents.memory.openviking_provider import OpenVikingMemoryProvider


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
    provider = OpenVikingMemoryProvider(runtime=runtime)

    payload = provider.get_memory_data(MemoryReadRequest(agent_name="writer"))
    assert payload["agent_name"] == "writer"
    assert payload["storage_layout"] == "openviking"

    payload = provider.reload_memory_data(MemoryReadRequest(agent_name="writer"))
    assert payload["agent_name"] == "writer"
    assert payload["storage_layout"] == "openviking"


@patch("nion.config.memory_config.get_memory_config", return_value=_memory_config())
@patch("nion.agents.memory.format_memory_for_injection", return_value="remember this")
def test_build_injection_context_formats_memory(_format_memory, _get_memory_config):
    runtime = DummyRuntime()
    provider = OpenVikingMemoryProvider(runtime=runtime)

    result = provider.build_injection_context(MemoryReadRequest(agent_name="writer"))

    assert result == "<memory>\nremember this\n</memory>\n"


@patch("nion.config.memory_config.get_memory_config", return_value=_memory_config())
def test_build_injection_context_respects_memory_read_gate(_get_memory_config):
    runtime = DummyRuntime()
    provider = OpenVikingMemoryProvider(runtime=runtime)

    result = provider.build_injection_context(MemoryReadRequest(runtime_context={"memory_read": False}))

    assert result == ""


def test_queue_conversation_update_blocks_when_write_disabled():
    runtime = DummyRuntime()
    provider = OpenVikingMemoryProvider(runtime=runtime)

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
    provider = OpenVikingMemoryProvider(runtime=runtime)
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
