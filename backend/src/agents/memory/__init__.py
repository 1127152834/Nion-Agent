"""Memory module for Nion.

This module provides a global memory mechanism that:
- Stores user context and conversation history in memory.json
- Uses LLM to summarize and extract facts from conversations
- Injects relevant memory into system prompts for personalized responses
"""

from src.agents.memory.config import MemoryRuntimeConfig
from src.agents.memory.evolving import (
    EvolutionMetrics,
    MemoryEvolutionScheduler,
    SelfEvolvingEngine,
    UsagePattern,
)
from src.agents.memory.intention import Intention, IntentionPredictor, IntentionType
from src.agents.memory.layers import CategoryLayer, ItemLayer, ResourceLayer
from src.agents.memory.linking import MemoryLink, MemoryLinker
from src.agents.memory.memory import (
    MemoryManager,
    get_memory_data,
    get_memory_manager,
    reload_memory_data,
    reload_memory_manager,
    update_memory_from_conversation,
)
from src.agents.memory.proactive import (
    ContextPreloader,
    DualModeRetriever,
    RetrievalMode,
    UsagePatternAnalyzer,
)
from src.agents.memory.prompt import (
    FACT_EXTRACTION_PROMPT,
    MEMORY_UPDATE_PROMPT,
    format_conversation_for_update,
    format_memory_for_injection,
)
from src.agents.memory.queue import (
    ConversationContext,
    MemoryUpdateQueue,
    get_memory_queue,
    reset_memory_queue,
)
from src.agents.memory.search import (
    BM25,
    EmbeddingProvider,
    HybridSearch,
    OpenAIEmbedding,
    SentenceTransformerEmbedding,
    VectorStore,
)
from src.agents.memory.soul import (
    HeartbeatManager,
    HeartbeatTask,
    Identity,
    IdentityCascade,
    SoulResolver,
    WorkspaceFiles,
)
from src.agents.memory.storage import StorageManager
from src.agents.memory.types import (
    Entity,
    MemoryCategory,
    MemoryItem,
    RawResource,
    Relation,
)
from src.agents.memory.updater import (
    MemoryUpdater,
)

__all__ = [
    # Prompt utilities
    "MEMORY_UPDATE_PROMPT",
    "FACT_EXTRACTION_PROMPT",
    "format_memory_for_injection",
    "format_conversation_for_update",
    # Queue
    "ConversationContext",
    "MemoryUpdateQueue",
    "get_memory_queue",
    "reset_memory_queue",
    # Types
    "MemoryCategory",
    "Entity",
    "Relation",
    "RawResource",
    "MemoryItem",
    # Search
    "EmbeddingProvider",
    "SentenceTransformerEmbedding",
    "OpenAIEmbedding",
    "BM25",
    "VectorStore",
    "HybridSearch",
    # Layers
    "ResourceLayer",
    "ItemLayer",
    "CategoryLayer",
    # Proactive
    "RetrievalMode",
    "DualModeRetriever",
    "ContextPreloader",
    "UsagePatternAnalyzer",
    # Evolving
    "UsagePattern",
    "EvolutionMetrics",
    "SelfEvolvingEngine",
    "MemoryEvolutionScheduler",
    # Manager
    "MemoryManager",
    "get_memory_manager",
    "reload_memory_manager",
    # Runtime Config
    "MemoryRuntimeConfig",
    # Soul
    "WorkspaceFiles",
    "Identity",
    "IdentityCascade",
    "SoulResolver",
    "HeartbeatTask",
    "HeartbeatManager",
    # Intention
    "IntentionType",
    "Intention",
    "IntentionPredictor",
    # Linking
    "MemoryLink",
    "MemoryLinker",
    # Storage
    "StorageManager",
    # Updater
    "MemoryUpdater",
    "get_memory_data",
    "reload_memory_data",
    "update_memory_from_conversation",
]
