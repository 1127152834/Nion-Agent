"""Advanced usage pattern analysis."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class AdvancedPatternAnalyzer:
    """Advanced usage pattern analysis."""

    def __init__(self):
        """Initialize pattern analyzer."""
        self.events: list[dict[str, Any]] = []
        self.topic_graph: dict[str, list[str]] = defaultdict(list)

    def record(self, event: dict[str, Any]) -> None:
        """Record usage event.

        Args:
            event: Event dictionary with type, query, results, timestamp, etc.
        """
        if "timestamp" not in event:
            event["timestamp"] = datetime.now().isoformat()

        self.events.append(event)

        # Update topic graph
        if event.get("type") == "search" and event.get("topic"):
            topic = event["topic"]
            if len(self.events) > 1:
                prev_event = self.events[-2]
                if prev_event.get("topic"):
                    self.topic_graph[prev_event["topic"]].append(topic)

        logger.debug(f"Recorded event: {event.get('type')}")

    def analyze(self, context: dict[str, Any]) -> dict[str, Any]:
        """Analyze patterns and return insights.

        Args:
            context: Current context

        Returns:
            Dictionary with pattern insights
        """
        return {
            "frequent_topics": self._get_frequent_topics(),
            "time_patterns": self._get_time_patterns(),
            "topic_sequences": self._get_topic_sequences(),
            "likely_next_topics": self._predict_next_topics(context),
        }

    def _get_frequent_topics(self, top_k: int = 10) -> list[str]:
        """Get most frequently accessed topics.

        Args:
            top_k: Number of top topics to return

        Returns:
            List of frequent topics
        """
        topics = [
            event.get("topic")
            for event in self.events
            if event.get("type") == "search" and event.get("topic")
        ]

        if not topics:
            return []

        counter = Counter(topics)
        return [topic for topic, _ in counter.most_common(top_k)]

    def _get_time_patterns(self) -> dict[int, list[str]]:
        """Get time-based patterns.

        Returns:
            Dictionary mapping hour to common topics
        """
        time_topics: dict[int, list[str]] = defaultdict(list)

        for event in self.events:
            if event.get("type") == "search" and event.get("topic"):
                try:
                    timestamp = datetime.fromisoformat(event["timestamp"])
                    hour = timestamp.hour
                    time_topics[hour].append(event["topic"])
                except (ValueError, KeyError):
                    continue

        # Get most common topics for each hour
        patterns = {}
        for hour, topics in time_topics.items():
            counter = Counter(topics)
            patterns[hour] = [topic for topic, _ in counter.most_common(3)]

        return patterns

    def _get_topic_sequences(self, min_length: int = 2) -> list[list[str]]:
        """Get common topic sequences.

        Args:
            min_length: Minimum sequence length

        Returns:
            List of topic sequences
        """
        sequences = []
        current_sequence = []

        for event in self.events:
            if event.get("type") == "search" and event.get("topic"):
                current_sequence.append(event["topic"])

                if len(current_sequence) >= min_length:
                    sequences.append(current_sequence.copy())

                # Limit sequence length
                if len(current_sequence) > 5:
                    current_sequence.pop(0)
            else:
                # Reset sequence on non-search events
                if len(current_sequence) >= min_length:
                    sequences.append(current_sequence)
                current_sequence = []

        # Find most common sequences
        sequence_counter = Counter(tuple(seq) for seq in sequences)
        common_sequences = [
            list(seq) for seq, _ in sequence_counter.most_common(10)
        ]

        return common_sequences

    def _predict_next_topics(self, context: dict[str, Any]) -> list[str]:
        """Predict next likely topics.

        Args:
            context: Current context

        Returns:
            List of predicted topics
        """
        predicted = []

        # Use topic graph
        current_topic = context.get("current_topic")
        if current_topic and current_topic in self.topic_graph:
            next_topics = self.topic_graph[current_topic]
            counter = Counter(next_topics)
            predicted.extend([topic for topic, _ in counter.most_common(3)])

        # Add time-based predictions
        current_hour = datetime.now().hour
        time_patterns = self._get_time_patterns()
        if current_hour in time_patterns:
            predicted.extend(time_patterns[current_hour])

        # Remove duplicates
        seen = set()
        unique_predicted = []
        for topic in predicted:
            if topic not in seen:
                seen.add(topic)
                unique_predicted.append(topic)

        return unique_predicted[:5]


__all__ = ["AdvancedPatternAnalyzer"]
