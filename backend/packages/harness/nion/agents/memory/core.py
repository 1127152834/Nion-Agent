from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from src.agents.memory.policy import MemorySessionPolicy


@dataclass(frozen=True, slots=True)
class MemoryReadRequest:
    agent_name: str | None = None
    state: dict[str, Any] | None = None
    runtime_context: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class MemoryWriteRequest:
    thread_id: str
    messages: list[Any]
    agent_name: str | None = None
    state: dict[str, Any] | None = None
    runtime_context: dict[str, Any] | None = None


MemoryPolicyRequest = MemoryReadRequest | MemoryWriteRequest


@runtime_checkable
class MemoryRuntime(Protocol):
    def get_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]: ...

    def reload_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]: ...

    def queue_update(self, request: MemoryWriteRequest) -> None: ...


@runtime_checkable
class MemoryProvider(Protocol):
    name: str

    def resolve_policy(self, request: MemoryPolicyRequest) -> MemorySessionPolicy: ...

    def get_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]: ...

    def reload_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]: ...

    def build_injection_context(self, request: MemoryReadRequest) -> str: ...

    def queue_conversation_update(self, request: MemoryWriteRequest) -> bool: ...
