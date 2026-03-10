"""Memory module for DeerFlow.

This module provides a global memory mechanism that:
- Stores user context and conversation history in memory.json
- Uses LLM to summarize and extract facts from conversations
- Injects relevant memory into system prompts for personalized responses
"""

from src.agents.memory.core import MemoryProvider, MemoryReadRequest, MemoryRuntime, MemoryWriteRequest
from src.agents.memory.prompt import (
    FACT_EXTRACTION_PROMPT,
    MEMORY_UPDATE_PROMPT,
    format_conversation_for_update,
    format_memory_for_injection,
)
from src.agents.memory.provider import V2CompatibleMemoryProvider
from src.agents.memory.queue import (
    ConversationContext,
    MemoryUpdateQueue,
    get_memory_queue,
    reset_memory_queue,
)
from src.agents.memory.registry import (
    MemoryRegistry,
    get_default_memory_provider,
    get_memory_registry,
    reset_memory_registry,
)
from src.agents.memory.runtime import V2CompatibleMemoryRuntime
from src.agents.memory.updater import (
    MemoryUpdater,
    get_memory_data,
    reload_memory_data,
    update_memory_from_conversation,
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
    # Provider / registry / runtime
    "MemoryRegistry",
    "V2CompatibleMemoryProvider",
    "V2CompatibleMemoryRuntime",
    "get_default_memory_provider",
    "get_memory_registry",
    "reset_memory_registry",
    # Queue
    "ConversationContext",
    "MemoryUpdateQueue",
    "get_memory_queue",
    "reset_memory_queue",
    # Updater
    "MemoryUpdater",
    "get_memory_data",
    "reload_memory_data",
    "update_memory_from_conversation",
]
