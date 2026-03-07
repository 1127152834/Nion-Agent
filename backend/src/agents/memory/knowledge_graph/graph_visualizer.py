"""Knowledge graph visualization."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class GraphVisualizer:
    """Visualize knowledge graph."""

    def __init__(self, graph_builder: Any):
        """Initialize graph visualizer.

        Args:
            graph_builder: KnowledgeGraphBuilder instance
        """
        self.graph_builder = graph_builder

    def export_to_json(self, subgraph: Any = None) -> dict[str, Any]:
        """Export graph to JSON format for frontend visualization.

        Args:
            subgraph: Subgraph to export (optional, defaults to full graph)

        Returns:
            Dictionary with nodes and edges in JSON format
        """
        graph = subgraph if subgraph is not None else self.graph_builder._graph

        if graph is None or graph.number_of_nodes() == 0:
            return {"nodes": [], "edges": []}

        # Export nodes
        nodes = []
        for node, data in graph.nodes(data=True):
            nodes.append({
                "id": node,
                "label": node,
                "type": data.get("type", "unknown"),
                "mentions": data.get("mentions", 1),
            })

        # Export edges
        edges = []
        for u, v, data in graph.edges(data=True):
            edges.append({
                "source": u,
                "target": v,
                "type": data.get("type", "related_to"),
                "confidence": data.get("confidence", 1.0),
            })

        return {
            "nodes": nodes,
            "edges": edges,
            "statistics": {
                "num_nodes": len(nodes),
                "num_edges": len(edges),
            },
        }

    def export_entity_subgraph(
        self,
        entity: str,
        depth: int = 2,
    ) -> dict[str, Any]:
        """Export subgraph around an entity.

        Args:
            entity: Entity name
            depth: Maximum distance from entity

        Returns:
            Dictionary with nodes and edges in JSON format
        """
        subgraph = self.graph_builder.query_subgraph(entity, depth=depth)
        return self.export_to_json(subgraph)


__all__ = ["GraphVisualizer"]
