"""Knowledge graph query interface."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class GraphQuery:
    """Query interface for knowledge graph."""

    def __init__(self, graph_builder: Any):
        """Initialize graph query.

        Args:
            graph_builder: KnowledgeGraphBuilder instance
        """
        self.graph_builder = graph_builder

    def find_related_entities(
        self,
        entity: str,
        relation_type: str | None = None,
    ) -> list[str]:
        """Find entities related to given entity.

        Args:
            entity: Entity name
            relation_type: Filter by relation type (optional)

        Returns:
            List of related entity names
        """
        return self.graph_builder.get_neighbors(entity, relation_type)

    def get_entity_context(self, entity: str, depth: int = 1) -> dict[str, Any]:
        """Get context around an entity.

        Args:
            entity: Entity name
            depth: Maximum distance from entity

        Returns:
            Dictionary with entity context including neighbors and relations
        """
        subgraph = self.graph_builder.query_subgraph(entity, depth=depth)

        if subgraph.number_of_nodes() == 0:
            return {
                "entity": entity,
                "found": False,
                "neighbors": [],
                "relations": [],
            }

        neighbors = list(subgraph.nodes())
        relations = [
            {
                "source": u,
                "target": v,
                "type": data.get("type", "related_to"),
                "confidence": data.get("confidence", 1.0),
            }
            for u, v, data in subgraph.edges(data=True)
        ]

        return {
            "entity": entity,
            "found": True,
            "neighbors": neighbors,
            "relations": relations,
        }

    def find_connection(self, source: str, target: str) -> dict[str, Any]:
        """Find connection path between two entities.

        Args:
            source: Source entity
            target: Target entity

        Returns:
            Dictionary with path information
        """
        path = self.graph_builder.find_path(source, target)

        if not path:
            return {
                "source": source,
                "target": target,
                "connected": False,
                "path": [],
                "distance": -1,
            }

        return {
            "source": source,
            "target": target,
            "connected": True,
            "path": path,
            "distance": len(path) - 1,
        }

    def get_entity_info(self, entity: str) -> dict[str, Any]:
        """Get detailed information about an entity.

        Args:
            entity: Entity name

        Returns:
            Dictionary with entity information
        """
        graph = self.graph_builder._graph

        if graph is None or entity not in graph:
            return {
                "entity": entity,
                "found": False,
            }

        node_data = graph.nodes[entity]
        neighbors = self.graph_builder.get_neighbors(entity)

        return {
            "entity": entity,
            "found": True,
            "type": node_data.get("type", "unknown"),
            "mentions": node_data.get("mentions", 0),
            "num_neighbors": len(neighbors),
            "neighbors": neighbors,
        }


__all__ = ["GraphQuery"]
