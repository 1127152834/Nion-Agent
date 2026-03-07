"""Memory recommendation system."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class MemoryRecommender:
    """Recommend memories based on usage patterns."""

    def __init__(self, memory_manager: Any, pattern_analyzer: Any = None):
        """Initialize memory recommender.

        Args:
            memory_manager: MemoryManager instance
            pattern_analyzer: AdvancedPatternAnalyzer instance (optional)
        """
        self.memory_manager = memory_manager
        self.pattern_analyzer = pattern_analyzer

    def recommend_related(
        self,
        current_memory: dict[str, Any],
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Recommend related memories.

        Args:
            current_memory: Current memory item
            top_k: Number of recommendations

        Returns:
            List of recommended memory items
        """
        try:
            content = current_memory.get("content", "")
            if not content:
                return []

            # Search for similar memories
            results = self.memory_manager.search(content, top_k=top_k + 1)

            if not results or "results" not in results:
                return []

            # Filter out the current memory itself
            current_id = current_memory.get("id")
            recommendations = [
                item for item in results["results"]
                if item.get("id") != current_id
            ]

            return recommendations[:top_k]

        except Exception as e:
            logger.error(f"Failed to recommend related memories: {e}")
            return []

    def recommend_mergeable(
        self,
        similarity_threshold: float = 0.85,
    ) -> list[tuple[dict[str, Any], dict[str, Any]]]:
        """Recommend memory pairs that could be merged.

        Args:
            similarity_threshold: Minimum similarity for merge recommendation

        Returns:
            List of (memory1, memory2) tuples
        """
        try:
            # Get all memory items
            data = self.memory_manager.get_memory_data()
            items = data.get("items", [])

            if len(items) < 2:
                return []

            mergeable = []

            # Compare each pair
            for i, item1 in enumerate(items):
                for item2 in items[i + 1:]:
                    similarity = self._calculate_similarity(item1, item2)
                    if similarity >= similarity_threshold:
                        mergeable.append((item1, item2))

            logger.debug(f"Found {len(mergeable)} mergeable pairs")
            return mergeable

        except Exception as e:
            logger.error(f"Failed to recommend mergeable memories: {e}")
            return []

    def recommend_context(
        self,
        query: str,
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        """Recommend context for a query.

        Args:
            query: Query string
            top_k: Number of recommendations

        Returns:
            List of recommended memory items
        """
        try:
            # Use pattern analyzer if available
            if self.pattern_analyzer:
                patterns = self.pattern_analyzer.analyze({"query": query})
                predicted_topics = patterns.get("likely_next_topics", [])

                recommendations = []
                for topic in predicted_topics[:top_k]:
                    results = self.memory_manager.search(topic, top_k=1)
                    if results and "results" in results:
                        recommendations.extend(results["results"])

                return recommendations[:top_k]

            # Fallback to simple search
            results = self.memory_manager.search(query, top_k=top_k)
            return results.get("results", []) if results else []

        except Exception as e:
            logger.error(f"Failed to recommend context: {e}")
            return []

    def _calculate_similarity(
        self,
        item1: dict[str, Any],
        item2: dict[str, Any],
    ) -> float:
        """Calculate similarity between two memory items.

        Args:
            item1: First memory item
            item2: Second memory item

        Returns:
            Similarity score (0-1)
        """
        # Simple similarity based on content overlap
        content1 = set(item1.get("content", "").lower().split())
        content2 = set(item2.get("content", "").lower().split())

        if not content1 or not content2:
            return 0.0

        intersection = len(content1 & content2)
        union = len(content1 | content2)

        return intersection / union if union > 0 else 0.0


__all__ = ["MemoryRecommender"]
