"""Advanced context preloading based on usage patterns."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class SmartContextLoader:
    """Smart context preloading based on user patterns."""

    def __init__(self, memory_manager: Any, pattern_analyzer: Any = None):
        """Initialize smart context loader.

        Args:
            memory_manager: MemoryManager instance
            pattern_analyzer: AdvancedPatternAnalyzer instance (optional)
        """
        self.memory_manager = memory_manager
        self.pattern_analyzer = pattern_analyzer

    def preload(self, current_context: dict[str, Any]) -> list[dict[str, Any]]:
        """Preload relevant context based on patterns.

        Args:
            current_context: Current conversation context

        Returns:
            List of preloaded memory items
        """
        if not self.pattern_analyzer:
            return []

        try:
            # Analyze current context
            patterns = self.pattern_analyzer.analyze(current_context)

            # Predict next topics
            predicted_topics = self._predict_topics(patterns, current_context)

            # Preload relevant memories
            preloaded = []
            for topic in predicted_topics[:3]:  # Limit to top 3 topics
                results = self.memory_manager.search(topic, top_k=3)
                if results and "results" in results:
                    preloaded.extend(results["results"])

            logger.debug(f"Preloaded {len(preloaded)} memory items")
            return preloaded

        except Exception as e:
            logger.error(f"Context preloading failed: {e}")
            return []

    def _predict_topics(
        self,
        patterns: dict[str, Any],
        current_context: dict[str, Any],
    ) -> list[str]:
        """Predict next likely topics based on patterns.

        Args:
            patterns: Usage patterns from analyzer
            current_context: Current conversation context

        Returns:
            List of predicted topic strings
        """
        predicted = []

        # Get likely next topics from patterns
        likely_topics = patterns.get("likely_next_topics", [])
        predicted.extend(likely_topics)

        # Add time-based predictions
        current_hour = datetime.now().hour
        time_patterns = patterns.get("time_patterns", {})

        if current_hour in time_patterns:
            predicted.extend(time_patterns[current_hour])

        # Add topic sequence predictions
        current_topic = current_context.get("current_topic")
        if current_topic:
            topic_sequences = patterns.get("topic_sequences", [])
            for sequence in topic_sequences:
                if current_topic in sequence:
                    idx = sequence.index(current_topic)
                    if idx + 1 < len(sequence):
                        predicted.append(sequence[idx + 1])

        # Remove duplicates while preserving order
        seen = set()
        unique_predicted = []
        for topic in predicted:
            if topic not in seen:
                seen.add(topic)
                unique_predicted.append(topic)

        return unique_predicted


__all__ = ["SmartContextLoader"]
