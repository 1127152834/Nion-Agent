"""Knowledge graph construction using networkx."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class KnowledgeGraphBuilder:
    """Build and manage knowledge graph."""

    def __init__(self):
        """Initialize knowledge graph builder."""
        self._graph = None

    def _load_networkx(self):
        """Lazy load networkx."""
        if self._graph is not None:
            return

        try:
            import networkx as nx

            self._graph = nx.DiGraph()
            self._nx = nx
            logger.info("Initialized knowledge graph")
        except ImportError:
            logger.error("networkx not installed. Run: pip install networkx")
            raise

    def add_memory_item(self, item: dict[str, Any]) -> None:
        """Add memory item to knowledge graph.

        Args:
            item: Memory item with entities and relations
        """
        self._load_networkx()

        # Add entities as nodes
        entities = item.get("entities", [])
        for entity in entities:
            if isinstance(entity, dict):
                name = entity.get("name")
                entity_type = entity.get("type", "unknown")
                mentions = entity.get("mentions", 1)
            else:
                # Handle Entity dataclass
                name = getattr(entity, "name", None)
                entity_type = getattr(entity, "type", "unknown")
                mentions = getattr(entity, "mentions", 1)

            if name:
                # Update or add node
                if self._graph.has_node(name):
                    self._graph.nodes[name]["mentions"] += mentions
                else:
                    self._graph.add_node(name, type=entity_type, mentions=mentions)

        # Add relations as edges
        relations = item.get("relations", [])
        for relation in relations:
            if isinstance(relation, dict):
                source = relation.get("source")
                target = relation.get("target")
                rel_type = relation.get("type", "related_to")
                confidence = relation.get("confidence", 1.0)
            else:
                # Handle Relation dataclass
                # Note: Relation has 'target' but no 'source', need to infer from context
                target = getattr(relation, "target", None)
                rel_type = getattr(relation, "type", "related_to")
                confidence = getattr(relation, "confidence", 1.0)
                source = None  # Need to infer from entities

            if source and target:
                self._graph.add_edge(
                    source,
                    target,
                    type=rel_type,
                    confidence=confidence,
                )

        logger.debug(f"Added item to graph: {len(entities)} entities, {len(relations)} relations")

    def query_subgraph(self, entity: str, depth: int = 2) -> Any:
        """Query subgraph around an entity.

        Args:
            entity: Entity name
            depth: Maximum distance from entity

        Returns:
            Subgraph as networkx DiGraph
        """
        self._load_networkx()

        if entity not in self._graph:
            logger.warning(f"Entity not found in graph: {entity}")
            return self._nx.DiGraph()

        try:
            # Get nodes within depth
            nodes = self._nx.single_source_shortest_path_length(
                self._graph,
                entity,
                cutoff=depth,
            )
            return self._graph.subgraph(nodes.keys()).copy()

        except Exception as e:
            logger.error(f"Failed to query subgraph: {e}")
            return self._nx.DiGraph()

    def find_path(self, source: str, target: str) -> list[str]:
        """Find shortest path between two entities.

        Args:
            source: Source entity
            target: Target entity

        Returns:
            List of entity names in path, or empty list if no path
        """
        self._load_networkx()

        if source not in self._graph or target not in self._graph:
            return []

        try:
            return self._nx.shortest_path(self._graph, source, target)
        except self._nx.NetworkXNoPath:
            return []
        except Exception as e:
            logger.error(f"Failed to find path: {e}")
            return []

    def get_neighbors(self, entity: str, relation_type: str | None = None) -> list[str]:
        """Get neighboring entities.

        Args:
            entity: Entity name
            relation_type: Filter by relation type (optional)

        Returns:
            List of neighboring entity names
        """
        self._load_networkx()

        if entity not in self._graph:
            return []

        neighbors = []
        for neighbor in self._graph.neighbors(entity):
            edge_data = self._graph[entity][neighbor]
            if relation_type is None or edge_data.get("type") == relation_type:
                neighbors.append(neighbor)

        return neighbors

    def get_statistics(self) -> dict[str, Any]:
        """Get graph statistics.

        Returns:
            Dictionary with graph statistics
        """
        self._load_networkx()

        return {
            "num_nodes": self._graph.number_of_nodes(),
            "num_edges": self._graph.number_of_edges(),
            "density": self._nx.density(self._graph) if self._graph.number_of_nodes() > 0 else 0,
        }


__all__ = ["KnowledgeGraphBuilder"]
