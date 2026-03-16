"""Memory module for Nion (OpenViking single-stack)."""

from nion.agents.memory.core import MemoryProvider, MemoryReadRequest, MemoryRuntime, MemoryWriteRequest
from nion.agents.memory.prompt import (
    FACT_EXTRACTION_PROMPT,
    MEMORY_UPDATE_PROMPT,
    format_conversation_for_update,
    format_memory_for_injection,
)
from nion.agents.memory.queue import (
    ConversationContext,
    MemoryUpdateQueue,
    get_memory_queue,
    reset_memory_queue,
)
from nion.agents.memory.registry import (
    MemoryRegistry,
    get_default_memory_provider,
    get_memory_registry,
    reset_memory_registry,
)

__all__ = [
    # Core
    "MemoryProvider",
    "MemoryReadRequest",
    "MemoryRuntime",
    "MemoryWriteRequest",
    # Prompt utilities
    "MEMORY_UPDATE_PROMPT",
    "FACT_EXTRACTION_PROMPT",
    "format_memory_for_injection",
    "format_conversation_for_update",
    # Registry
    "MemoryRegistry",
    "get_default_memory_provider",
    "get_memory_registry",
    "reset_memory_registry",
    # Queue
    "ConversationContext",
    "MemoryUpdateQueue",
    "get_memory_queue",
    "reset_memory_queue",
]
