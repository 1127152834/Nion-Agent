from __future__ import annotations

from src.agents.memory.core import MemoryPolicyRequest, MemoryReadRequest, MemoryRuntime, MemoryWriteRequest
from src.agents.memory.policy import MemorySessionPolicy, resolve_memory_policy


class V2CompatibleMemoryProvider:
    name = "v2-compatible"

    def __init__(self, runtime: MemoryRuntime):
        self._runtime = runtime

    def resolve_policy(self, request: MemoryPolicyRequest) -> MemorySessionPolicy:
        return resolve_memory_policy(state=request.state, runtime_context=request.runtime_context)

    def get_memory_data(self, request: MemoryReadRequest) -> dict:
        return self._runtime.get_memory_data(request)

    def reload_memory_data(self, request: MemoryReadRequest) -> dict:
        return self._runtime.reload_memory_data(request)

    def build_injection_context(self, request: MemoryReadRequest) -> str:
        policy = self.resolve_policy(request)
        if not policy.allow_read:
            return ""

        from src.agents.memory import format_memory_for_injection
        from src.config.memory_config import get_memory_config

        config = get_memory_config()
        if not config.enabled or not config.injection_enabled:
            return ""

        memory_data = self.get_memory_data(request)
        memory_content = format_memory_for_injection(memory_data, max_tokens=config.max_injection_tokens)
        if not memory_content.strip():
            return ""
        return f"<memory>\n{memory_content}\n</memory>\n"

    def queue_conversation_update(self, request: MemoryWriteRequest) -> bool:
        policy = self.resolve_policy(request)
        if not policy.allow_write:
            return False

        self._runtime.queue_update(request)
        return True
