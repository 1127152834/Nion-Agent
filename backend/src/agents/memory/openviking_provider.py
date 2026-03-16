from __future__ import annotations

from typing import Any

from src.agents.memory.core import MemoryPolicyRequest, MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.policy import MemorySessionPolicy, resolve_memory_policy


class OpenVikingMemoryProvider:
    """OpenViking memory provider (single-stack)."""

    name = "openviking"

    def __init__(self, runtime):
        self._runtime = runtime

    def resolve_policy(self, request: MemoryPolicyRequest) -> MemorySessionPolicy:
        return resolve_memory_policy(state=request.state, runtime_context=request.runtime_context)

    def get_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]:
        payload = dict(self._runtime.get_memory_data(request))
        payload["storage_layout"] = "openviking"
        return payload

    def reload_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]:
        payload = dict(self._runtime.reload_memory_data(request))
        payload["storage_layout"] = "openviking"
        return payload

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

    def write_conversation_update(
        self,
        *,
        thread_id: str,
        messages: list[Any],
        agent_name: str | None = None,
        write_source: str = "auto",
        explicit_write: bool = False,
        trace_id: str | None = None,
        chat_id: str | None = None,
    ) -> dict[str, Any]:
        return self._runtime.write_memory_graph(
            thread_id=thread_id,
            messages=messages,
            agent_name=agent_name,
            write_source=write_source,
            explicit_write=explicit_write,
            trace_id=trace_id,
            chat_id=chat_id,
        )

    # ------------------------------------------------------------------
    # OpenViking helper APIs used by middleware/router/tools
    # ------------------------------------------------------------------
    def build_context_from_query(self, *, query: str, agent_name: str | None = None) -> str:
        return self._runtime.build_context(query=query, agent_name=agent_name)

    def query_memory(self, *, query: str, limit: int = 8, agent_name: str | None = None) -> list[dict[str, Any]]:
        return self._runtime.search_memory(query=query, limit=limit, agent_name=agent_name)

    def store_memory(
        self,
        *,
        content: str,
        confidence: float = 0.9,
        source: str | None = None,
        agent_name: str | None = None,
        thread_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._runtime.store_memory(
            content=content,
            confidence=confidence,
            source=source,
            agent_name=agent_name,
            thread_id=thread_id,
            metadata=metadata,
        )

    def compact_memory(self, *, ratio: float = 0.8, scope: str = "global", agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.compact_memory(ratio=ratio, scope=scope, agent_name=agent_name)

    def forget_memory(self, *, memory_id: str, scope: str = "global", agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.forget_memory(memory_id=memory_id, scope=scope, agent_name=agent_name)

    def commit_session(self, *, thread_id: str, messages: list[Any], agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.commit_session(thread_id=thread_id, messages=messages, agent_name=agent_name)

    # ------------------------------------------------------------------
    # OpenViking Context Filesystem (read-only)
    # ------------------------------------------------------------------
    def fs_find(
        self,
        *,
        query: str,
        limit: int = 10,
        target_uri: str = "",
        score_threshold: float | None = None,
        agent_name: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._runtime.fs_find(
            query=query,
            limit=limit,
            target_uri=target_uri,
            score_threshold=score_threshold,
            agent_name=agent_name,
        )

    def fs_search(
        self,
        *,
        query: str,
        limit: int = 10,
        target_uri: str = "",
        score_threshold: float | None = None,
        filter_json: dict[str, Any] | None = None,
        agent_name: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._runtime.fs_search(
            query=query,
            limit=limit,
            target_uri=target_uri,
            score_threshold=score_threshold,
            filter_json=filter_json,
            agent_name=agent_name,
        )

    def fs_overview(self, *, uri: str, agent_name: str | None = None) -> str:
        return self._runtime.fs_overview(uri=uri, agent_name=agent_name)

    def fs_read(self, *, uri: str, offset: int = 0, limit: int = -1, agent_name: str | None = None) -> str:
        return self._runtime.fs_read(uri=uri, offset=offset, limit=limit, agent_name=agent_name)

    def fs_ls(
        self,
        *,
        uri: str,
        simple: bool = True,
        recursive: bool = False,
        agent_name: str | None = None,
    ) -> list[Any]:
        return self._runtime.fs_ls(uri=uri, simple=simple, recursive=recursive, agent_name=agent_name)

    def fs_tree(self, *, uri: str, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.fs_tree(uri=uri, agent_name=agent_name)

    def fs_grep(
        self,
        *,
        uri: str,
        pattern: str,
        case_insensitive: bool = False,
        agent_name: str | None = None,
    ) -> dict[str, Any]:
        return self._runtime.fs_grep(uri=uri, pattern=pattern, case_insensitive=case_insensitive, agent_name=agent_name)

    def fs_glob(
        self,
        *,
        pattern: str,
        uri: str = "viking://",
        agent_name: str | None = None,
    ) -> dict[str, Any]:
        return self._runtime.fs_glob(pattern=pattern, uri=uri, agent_name=agent_name)

    def fs_stat(self, *, uri: str, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.fs_stat(uri=uri, agent_name=agent_name)

    def get_retrieval_status(self, *, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.get_retrieval_status(agent_name=agent_name)

    def explain_query(self, *, query: str, limit: int = 8, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.explain_query(query=query, limit=limit, agent_name=agent_name)

    def rebuild_from_manifest(self, *, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.rebuild_from_manifest(agent_name=agent_name)

    def get_manifest_revision(self, *, agent_name: str | None = None) -> int:
        return self._runtime.get_manifest_revision(agent_name=agent_name)

    def reindex_vectors(self, *, include_agents: bool = True) -> dict[str, Any]:
        return self._runtime.reindex_vectors(include_agents=include_agents)

    def query_memory_graph(
        self,
        *,
        mode: str,
        agent_name: str | None = None,
        entity: str | None = None,
        start_entity: str | None = None,
        end_entity: str | None = None,
        depth: int = 2,
        limit: int = 20,
    ) -> dict[str, Any]:
        return self._runtime.query_memory_graph(
            mode=mode,
            agent_name=agent_name,
            entity=entity,
            start_entity=start_entity,
            end_entity=end_entity,
            depth=depth,
            limit=limit,
        )

    def get_memory_items(self, *, scope: str = "global", agent_name: str | None = None) -> list[dict[str, Any]]:
        return self._runtime.get_memory_items(scope=scope, agent_name=agent_name)

    def get_governance_status(self, *, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.get_governance_status(agent_name=agent_name)

    def run_governance(self, *, agent_name: str | None = None) -> dict[str, Any]:
        return self._runtime.run_governance(agent_name=agent_name)

    def apply_governance_decision(
        self,
        *,
        decision_id: str,
        action: str,
        override_summary: str | None = None,
        decided_by: str = "user",
        agent_name: str | None = None,
    ) -> dict[str, Any]:
        return self._runtime.apply_governance_decision(
            decision_id=decision_id,
            action=action,
            override_summary=override_summary,
            decided_by=decided_by,
            agent_name=agent_name,
        )

    def get_agent_catalog(self) -> list[dict[str, Any]]:
        return self._runtime.list_agent_catalog()
