from __future__ import annotations

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.queue import get_memory_queue
from src.agents.memory.updater import get_memory_data, reload_memory_data


class V2CompatibleMemoryRuntime:
    """Compatibility runtime that delegates to the current V2 memory path."""

    def get_memory_data(self, request: MemoryReadRequest) -> dict:
        return get_memory_data(request.agent_name)

    def reload_memory_data(self, request: MemoryReadRequest) -> dict:
        return reload_memory_data(request.agent_name)

    def queue_update(self, request: MemoryWriteRequest) -> None:
        get_memory_queue().add(
            thread_id=request.thread_id,
            messages=request.messages,
            agent_name=request.agent_name,
        )
