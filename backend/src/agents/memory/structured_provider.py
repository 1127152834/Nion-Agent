"""Structured filesystem memory provider."""

from __future__ import annotations

from src.agents.memory.core import MemoryPolicyRequest, MemoryReadRequest, MemoryRuntime, MemoryWriteRequest
from src.agents.memory.policy import MemorySessionPolicy, resolve_memory_policy


class StructuredFsProvider:
    """Structured filesystem memory provider."""

    name = "structured-fs"

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

        # Default assistant reads the global governance layer directly.
        if not request.agent_name:
            memory_data = self.get_memory_data(request)
            memory_content = format_memory_for_injection(memory_data, max_tokens=config.max_injection_tokens)
            if not memory_content.strip():
                return ""
            return f"<memory>\n{memory_content}\n</memory>\n"

        # Custom agents read both local scoped memory and global shared memory.
        local_memory = self.get_memory_data(request)
        global_memory = self._runtime.get_memory_data(
            MemoryReadRequest(
                agent_name=None,
                state=request.state,
                runtime_context=request.runtime_context,
            )
        )
        local_content = format_memory_for_injection(local_memory, max_tokens=max(200, config.max_injection_tokens // 2))
        global_content = format_memory_for_injection(global_memory, max_tokens=max(200, config.max_injection_tokens // 2))

        catalog_lines: list[str] = []
        if hasattr(self._runtime, "get_agent_catalog_view"):
            catalog_view = self._runtime.get_agent_catalog_view(request.agent_name)
            for card in catalog_view[:8]:
                name = card.get("agent_name", "")
                capability = card.get("capability_summary", "")
                style_hint = card.get("style_hint", "")
                if name and (capability or style_hint):
                    catalog_lines.append(f"- {name}: {capability} {style_hint}".strip())

        sections: list[str] = []
        if local_content.strip():
            sections.append(f"<agent-memory>\n{local_content}\n</agent-memory>")
        if global_content.strip():
            sections.append(f"<shared-memory>\n{global_content}\n</shared-memory>")
        if catalog_lines:
            sections.append("<agent-catalog>\n" + "\n".join(catalog_lines) + "\n</agent-catalog>")

        if not sections:
            return ""
        return "<memory>\n" + "\n\n".join(sections) + "\n</memory>\n"

    def queue_conversation_update(self, request: MemoryWriteRequest) -> bool:
        policy = self.resolve_policy(request)
        if not policy.allow_write:
            return False

        self._runtime.queue_update(request)
        return True
