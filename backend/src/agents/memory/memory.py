"""Memory v2 integration entrypoint with legacy compatibility."""

from __future__ import annotations

import importlib.util
import sys
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _load_local_module(module_path: Path, module_name: str) -> Any:
    loaded = sys.modules.get(module_name)
    if loaded is not None:
        return loaded

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module: {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class MemoryManager:
    """Unified memory manager for v2 layers and legacy updater compatibility."""

    def __init__(
        self,
        base_dir: str | Path | None = None,
        embedding_provider: Any = None,
        llm: Any = None,
        legacy_loader: Callable[..., dict[str, Any]] | None = None,
        legacy_updater: Callable[..., bool] | None = None,
        enable_legacy: bool = True,
        config: dict[str, Any] | None = None,
        dual_retriever: Any = None,
        evolver: Any = None,
    ) -> None:
        self.base_dir = Path(base_dir) if base_dir is not None else Path.cwd()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.llm = llm
        self.legacy_loader = legacy_loader
        self.legacy_updater = legacy_updater

        memory_root = Path(__file__).resolve().parent
        layers_dir = memory_root / "layers"
        search_dir = memory_root / "search"
        proactive_dir = memory_root / "proactive"
        evolving_dir = memory_root / "evolving"

        runtime_module = _load_local_module(
            memory_root / "config.py",
            "memory_v2_runtime_config",
        )
        payload = config or {}
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump()
        self.runtime_config = runtime_module.MemoryRuntimeConfig.from_dict(
            config=payload,
            base_dir=self.base_dir,
        )
        self.config = self.runtime_config.to_dict()
        self.enable_legacy = bool(enable_legacy and self.runtime_config.fallback_to_v1)

        embeddings_module = _load_local_module(
            search_dir / "embeddings.py",
            "memory_v2_search_embeddings",
        )
        bm25_module = _load_local_module(
            search_dir / "bm25.py",
            "memory_v2_search_bm25",
        )
        vector_module = _load_local_module(
            search_dir / "vector_store.py",
            "memory_v2_search_vector_store",
        )
        hybrid_module = _load_local_module(
            search_dir / "hybrid.py",
            "memory_v2_search_hybrid",
        )

        resource_module = _load_local_module(
            layers_dir / "resource.py",
            "memory_v2_layers_resource",
        )
        item_module = _load_local_module(
            layers_dir / "item.py",
            "memory_v2_layers_item",
        )
        category_module = _load_local_module(
            layers_dir / "category.py",
            "memory_v2_layers_category",
        )

        resolved_embedding_provider = embedding_provider or self._build_embedding_provider(
            embeddings_module=embeddings_module,
        )

        if self.runtime_config.vector_store_path:
            vector_db_path = Path(self.runtime_config.vector_store_path)
            if not vector_db_path.is_absolute():
                vector_db_path = self.base_dir / vector_db_path
        else:
            vector_db_path = self.base_dir / "memory_v2" / "vectors.db"
        vector_db_path.parent.mkdir(parents=True, exist_ok=True)

        bm25 = bm25_module.BM25(
            k1=self.runtime_config.bm25_k1,
            b=self.runtime_config.bm25_b,
        )
        vector_store = vector_module.VectorStore(str(vector_db_path))
        hybrid_search = hybrid_module.HybridSearch(
            vector_store,
            bm25,
            vector_weight=self.runtime_config.vector_weight,
            bm25_weight=self.runtime_config.bm25_weight,
        )

        self.resource_layer = resource_module.ResourceLayer(base_dir=self.base_dir)
        self.item_layer = item_module.ItemLayer(
            base_dir=self.base_dir,
            embedding_provider=resolved_embedding_provider,
            vector_store=vector_store,
            bm25=bm25,
            hybrid_search=hybrid_search,
            bm25_k1=self.runtime_config.bm25_k1,
            bm25_b=self.runtime_config.bm25_b,
            vector_weight=self.runtime_config.vector_weight,
            bm25_weight=self.runtime_config.bm25_weight,
        )
        self.category_layer = category_module.CategoryLayer(base_dir=self.base_dir)

        if dual_retriever is None and self.runtime_config.proactive_enabled:
            dual_module = _load_local_module(
                proactive_dir / "dual_mode.py",
                "memory_v2_proactive_dual_mode",
            )
            dual_retriever = dual_module.DualModeRetriever(
                hybrid_search=hybrid_search,
                llm=llm,
                fast_threshold=self.runtime_config.fast_mode_threshold,
                deep_threshold=self.runtime_config.deep_mode_threshold,
            )
        self.dual_retriever = dual_retriever

        if evolver is None and self.runtime_config.evolution_enabled:
            evolving_module = _load_local_module(
                evolving_dir / "self_evolver.py",
                "memory_v2_evolving_self_evolver",
            )
            evolver_config = {
                "compression_threshold": self.runtime_config.compression_threshold,
                "merge_similarity_threshold": self.runtime_config.merge_similarity_threshold,
                "staleness_threshold_days": self.runtime_config.staleness_threshold_days,
                "max_items_before_compress": self.runtime_config.max_items_before_compress,
                "redundancy_threshold": self.runtime_config.redundancy_threshold,
                "min_category_usage": self.runtime_config.min_category_usage,
            }
            evolver = evolving_module.SelfEvolvingEngine(
                item_layer=self.item_layer,
                category_layer=self.category_layer,
                llm=llm,
                config=evolver_config,
            )
        self.evolver = evolver

        # Initialize knowledge graph (optional)
        self.knowledge_graph_enabled = self.config.get("knowledge_graph_enabled", False)
        self.entity_recognizer = None
        self.relation_extractor = None
        self.graph_builder = None
        self.graph_query = None

        if self.knowledge_graph_enabled:
            try:
                kg_dir = memory_root / "knowledge_graph"
                entity_module = _load_local_module(
                    kg_dir / "entity_recognizer.py",
                    "memory_v2_kg_entity_recognizer",
                )
                relation_module = _load_local_module(
                    kg_dir / "relation_extractor.py",
                    "memory_v2_kg_relation_extractor",
                )
                graph_module = _load_local_module(
                    kg_dir / "graph_builder.py",
                    "memory_v2_kg_graph_builder",
                )
                query_module = _load_local_module(
                    kg_dir / "graph_query.py",
                    "memory_v2_kg_graph_query",
                )

                self.entity_recognizer = entity_module.EntityRecognizer()
                self.relation_extractor = relation_module.RelationExtractor(llm=llm)
                self.graph_builder = graph_module.KnowledgeGraphBuilder()
                self.graph_query = query_module.GraphQuery(self.graph_builder)
            except Exception as e:
                import logging
                logging.warning(f"Failed to initialize knowledge graph: {e}")
                self.knowledge_graph_enabled = False

    def _build_embedding_provider(self, embeddings_module: Any) -> Any:
        # Try to use global embedding config first
        try:
            from src.config import get_app_config

            config = get_app_config()
            if hasattr(config, "embedding") and config.embedding.enabled:
                embedding_config = config.embedding
                provider = embedding_config.provider.lower().strip()

                if provider == "local":
                    provider_config = embedding_config.local
                    return embeddings_module.SentenceTransformerEmbedding(
                        model_name=provider_config.model,
                    )
                elif provider == "openai":
                    provider_config = embedding_config.openai
                    api_key = provider_config.api_key
                    # Resolve environment variable if needed
                    if api_key and api_key.startswith("$"):
                        import os

                        api_key = os.getenv(api_key[1:])
                    return embeddings_module.OpenAIEmbedding(
                        model=provider_config.model,
                        api_key=api_key,
                    )
                elif provider == "custom":
                    provider_config = embedding_config.custom
                    api_key = provider_config.api_key or "dummy"
                    # For custom provider, create a custom OpenAI client
                    from openai import OpenAI

                    client = OpenAI(api_key=api_key, base_url=provider_config.api_base)
                    return embeddings_module.OpenAIEmbedding(
                        model=provider_config.model,
                        client=client,
                    )
        except Exception:
            pass  # Fall back to runtime_config

        # Fallback to runtime_config (backward compatibility)
        provider = self.runtime_config.embedding_provider.lower().strip()
        try:
            if provider == "openai":
                return embeddings_module.OpenAIEmbedding(
                    model=self.runtime_config.embedding_model,
                    api_key=self.runtime_config.embedding_api_key,
                )
            return embeddings_module.SentenceTransformerEmbedding(
                model_name=self.runtime_config.embedding_model,
            )
        except Exception:
            # Fallback to deterministic local embeddings in ItemLayer.
            return None

    def store_conversation(self, resource: dict[str, Any]) -> dict[str, Any]:
        """Store one raw conversation/resource in layer 1."""
        return self.resource_layer.store(resource)

    def store_item(self, item: dict[str, Any] | Any) -> dict[str, Any]:
        """Store one memory item and sync to category layer."""
        stored = self.item_layer.store(item)
        self.category_layer.add_item(stored)

        # Extract entities and relations if knowledge graph is enabled
        if self.knowledge_graph_enabled and self.entity_recognizer:
            try:
                content = stored.get("content", "")
                if content:
                    # Extract entities (synchronous)
                    entities = self.entity_recognizer.extract_entities(content)
                    stored["entities"] = entities

                    # Extract relations - use background task to avoid event loop issues
                    if self.relation_extractor and len(entities) >= 2:
                        # Schedule relation extraction as background task
                        # For now, skip async relation extraction to avoid deadlock
                        # TODO: Implement proper background task queue
                        import logging
                        logging.debug("Skipping relation extraction to avoid event loop deadlock")
                        stored["relations"] = []

                    # Add to knowledge graph
                    if self.graph_builder:
                        self.graph_builder.add_memory_item(stored)
            except Exception as e:
                import logging
                logging.warning(f"Failed to extract entities/relations: {e}")

        return stored

    def search(
        self,
        query: str,
        top_k: int = 5,
        query_embedding: list[float] | None = None,
        force_mode: Any = None,
    ) -> dict[str, Any]:
        """Search with dual-mode retriever if available, else direct hybrid search."""
        if not query.strip():
            return {"mode": "fast", "results": []}

        embedding = query_embedding
        if embedding is None and hasattr(self.item_layer, "_embed_text"):
            embedding = self.item_layer._embed_text(query)  # noqa: SLF001

        if self.dual_retriever is not None and embedding is not None:
            response = self.dual_retriever.retrieve(
                query=query,
                query_embedding=embedding,
                force_mode=force_mode,
                top_k=top_k,
            )
            self._update_access_from_results(response.get("results", []))
            return response

        results = self.item_layer.search(query=query, top_k=top_k, query_embedding=embedding)
        self._update_access_from_results(results)
        return {
            "mode": "fast",
            "results": results,
            "reasoning": "Fallback to direct item-layer search",
        }

    def evolve(self) -> dict[str, Any]:
        """Run one evolution cycle."""
        if self.evolver is None:
            return {
                "timestamp": datetime.now(UTC).isoformat(),
                "actions": [],
                "metrics": {},
            }
        return self.evolver.evolve()

    def get_memory_data(self, agent_name: str | None = None) -> dict[str, Any]:
        """Return v2 memory view and optionally include legacy payload."""
        items = self.item_layer.list_items()
        resources = self.resource_layer.search(limit=200)

        categories: dict[str, list[dict[str, Any]]] = {}
        category_keys: list[str] = []
        if hasattr(self.category_layer, "_data"):
            category_keys = sorted(getattr(self.category_layer, "_data").keys())  # noqa: SLF001

        for category in category_keys:
            categories[category] = self.category_layer.get_items(category)

        data: dict[str, Any] = {
            "version": "2.0",
            "items": items,
            "categories": categories,
            "resources": resources,
        }

        if self.enable_legacy:
            legacy_loader = self.legacy_loader or self._default_legacy_loader
            try:
                legacy_payload = legacy_loader(agent_name=agent_name)
                data["legacy"] = legacy_payload
                if isinstance(legacy_payload, dict):
                    for key in ("lastUpdated", "user", "history", "facts"):
                        if key in legacy_payload:
                            data[key] = legacy_payload[key]
            except Exception:
                data["legacy"] = {}

        return data

    def update_legacy_from_conversation(
        self,
        messages: list[Any],
        thread_id: str | None = None,
        agent_name: str | None = None,
    ) -> bool:
        """Delegate memory update to existing legacy updater."""
        updater = self.legacy_updater or self._default_legacy_updater
        try:
            return bool(updater(messages, thread_id=thread_id, agent_name=agent_name))
        except Exception:
            return False

    def _update_access_from_results(self, results: list[dict[str, Any]]) -> None:
        for item in results:
            item_id = item.get("id")
            if item_id is None:
                continue
            self.item_layer.update_access(str(item_id))

    def _default_legacy_loader(self, agent_name: str | None = None) -> dict[str, Any]:
        try:
            from src.agents.memory.updater import get_memory_data

            return get_memory_data(agent_name=agent_name)
        except Exception:
            updater_module = _load_local_module(
                Path(__file__).resolve().parent / "updater.py",
                "memory_v2_legacy_updater",
            )
            return updater_module.get_memory_data(agent_name=agent_name)

    def _default_legacy_updater(
        self,
        messages: list[Any],
        thread_id: str | None = None,
        agent_name: str | None = None,
    ) -> bool:
        try:
            from src.agents.memory.updater import update_memory_from_conversation

            return update_memory_from_conversation(
                messages=messages,
                thread_id=thread_id,
                agent_name=agent_name,
            )
        except Exception:
            updater_module = _load_local_module(
                Path(__file__).resolve().parent / "updater.py",
                "memory_v2_legacy_updater",
            )
            return updater_module.update_memory_from_conversation(
                messages=messages,
                thread_id=thread_id,
                agent_name=agent_name,
            )

    def query_knowledge_graph(self, entity: str, depth: int = 1) -> dict[str, Any]:
        """Query knowledge graph for entity context.

        Args:
            entity: Entity name
            depth: Maximum distance from entity

        Returns:
            Dictionary with entity context
        """
        if not self.knowledge_graph_enabled or not self.graph_query:
            return {
                "enabled": False,
                "message": "Knowledge graph is not enabled",
            }

        return self.graph_query.get_entity_context(entity, depth=depth)

    def get_graph_statistics(self) -> dict[str, Any]:
        """Get knowledge graph statistics.

        Returns:
            Dictionary with graph statistics
        """
        if not self.knowledge_graph_enabled or not self.graph_builder:
            return {
                "enabled": False,
                "num_nodes": 0,
                "num_edges": 0,
            }

        stats = self.graph_builder.get_statistics()
        stats["enabled"] = True
        return stats

    def close(self) -> None:
        """Close underlying resources."""
        import logging

        # Close item layer
        try:
            if hasattr(self.item_layer, "close"):
                self.item_layer.close()
        except Exception as e:
            logging.error(f"Failed to close item layer: {e}")

        # Close resource layer (if it has close method)
        try:
            if hasattr(self.resource_layer, "close"):
                self.resource_layer.close()
        except Exception as e:
            logging.error(f"Failed to close resource layer: {e}")

        # Close category layer (if it has close method)
        try:
            if hasattr(self.category_layer, "close"):
                self.category_layer.close()
        except Exception as e:
            logging.error(f"Failed to close category layer: {e}")

        # Close dual retriever (if it has close method)
        try:
            if self.dual_retriever and hasattr(self.dual_retriever, "close"):
                self.dual_retriever.close()
        except Exception as e:
            logging.error(f"Failed to close dual retriever: {e}")

        # Close evolver (if it has close method)
        try:
            if self.evolver and hasattr(self.evolver, "close"):
                self.evolver.close()
        except Exception as e:
            logging.error(f"Failed to close evolver: {e}")


_manager_registry: dict[str | None, MemoryManager] = {}
_manager_lock = threading.Lock()


def _runtime_payload_from_config() -> dict[str, Any]:
    from src.config.memory_config import get_memory_config

    config = get_memory_config()
    if hasattr(config, "model_dump"):
        return config.model_dump()
    return dict(config)


def _resolve_manager_base_dir(agent_name: str | None) -> Path:
    from src.config.paths import get_paths

    paths = get_paths()
    if agent_name:
        return paths.agent_dir(agent_name)
    return paths.base_dir


def get_memory_manager(
    agent_name: str | None = None,
    reload: bool = False,
) -> MemoryManager:
    """Get or create a singleton memory manager per agent scope."""
    with _manager_lock:
        if reload:
            existing = _manager_registry.pop(agent_name, None)
            if existing is not None:
                try:
                    existing.close()
                except Exception as e:
                    import logging
                    logging.error(f"Failed to close existing manager: {e}")

        manager = _manager_registry.get(agent_name)
        if manager is not None:
            return manager

        try:
            payload = _runtime_payload_from_config()
            manager = MemoryManager(
                base_dir=_resolve_manager_base_dir(agent_name),
                config=payload,
                enable_legacy=bool(payload.get("fallback_to_v1", True)),
            )
            _manager_registry[agent_name] = manager
            return manager
        except Exception as e:
            import logging
            logging.error(f"Failed to create memory manager: {e}")
            raise


def reload_memory_manager(agent_name: str | None = None) -> MemoryManager:
    """Force recreate manager for one scope."""
    return get_memory_manager(agent_name=agent_name, reload=True)


def get_memory_data(agent_name: str | None = None) -> dict[str, Any]:
    """Read memory data through v2 manager."""
    return get_memory_manager(agent_name=agent_name).get_memory_data(agent_name=agent_name)


def reload_memory_data(agent_name: str | None = None) -> dict[str, Any]:
    """Reload memory manager and return fresh data."""
    return reload_memory_manager(agent_name=agent_name).get_memory_data(agent_name=agent_name)


def update_memory_fact(
    fact_id: str,
    updates: dict[str, Any],
    agent_name: str | None = None,
) -> dict[str, Any] | None:
    """Update one legacy fact entry."""
    try:
        from src.agents.memory.updater import update_fact

        return update_fact(fact_id=fact_id, updates=updates, agent_name=agent_name)
    except Exception:
        updater_module = _load_local_module(
            Path(__file__).resolve().parent / "updater.py",
            "memory_v2_legacy_updater",
        )
        return updater_module.update_fact(
            fact_id=fact_id,
            updates=updates,
            agent_name=agent_name,
        )


def pin_memory_fact(
    fact_id: str,
    pinned: bool | None = None,
    agent_name: str | None = None,
) -> dict[str, Any] | None:
    """Set or toggle pinned state for one legacy fact entry."""
    try:
        from src.agents.memory.updater import pin_fact

        return pin_fact(fact_id=fact_id, pinned=pinned, agent_name=agent_name)
    except Exception:
        updater_module = _load_local_module(
            Path(__file__).resolve().parent / "updater.py",
            "memory_v2_legacy_updater",
        )
        return updater_module.pin_fact(
            fact_id=fact_id,
            pinned=pinned,
            agent_name=agent_name,
        )


def delete_memory_fact(fact_id: str, agent_name: str | None = None) -> bool:
    """Delete one legacy fact entry."""
    try:
        from src.agents.memory.updater import delete_fact

        return bool(delete_fact(fact_id=fact_id, agent_name=agent_name))
    except Exception:
        updater_module = _load_local_module(
            Path(__file__).resolve().parent / "updater.py",
            "memory_v2_legacy_updater",
        )
        return bool(
            updater_module.delete_fact(
                fact_id=fact_id,
                agent_name=agent_name,
            )
        )


def update_memory_from_conversation(
    messages: list[Any],
    thread_id: str | None = None,
    agent_name: str | None = None,
) -> bool:
    """Update memory through v2 manager path."""
    from src.agents.memory.prompt import format_conversation_for_update

    manager = get_memory_manager(agent_name=agent_name)
    conversation_text = format_conversation_for_update(messages)
    if conversation_text:
        manager.store_conversation(
            {
                "id": f"conv_{thread_id or 'global'}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
                "type": "conversation",
                "content": conversation_text,
                "metadata": {
                    "thread_id": thread_id,
                    "message_count": len(messages),
                    "agent_name": agent_name,
                },
            }
        )
    return manager.update_legacy_from_conversation(
        messages=messages,
        thread_id=thread_id,
        agent_name=agent_name,
    )


__all__ = [
    "MemoryManager",
    "get_memory_manager",
    "reload_memory_manager",
    "get_memory_data",
    "reload_memory_data",
    "update_memory_fact",
    "pin_memory_fact",
    "delete_memory_fact",
    "update_memory_from_conversation",
]
