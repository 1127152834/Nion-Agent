"""Usage pattern tracking for proactive retrieval."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any


class UsagePatternAnalyzer:
    """Track query and category patterns for lightweight prediction."""

    def __init__(self) -> None:
        self.query_counter: Counter[str] = Counter()
        self.category_counter: Counter[str] = Counter()
        self.token_category_counter: dict[str, Counter[str]] = {}
        self.last_seen: dict[str, datetime] = {}

    def record_query(
        self,
        query: str,
        category: str | None = None,
        when: datetime | None = None,
    ) -> None:
        """Record one query interaction."""
        tokens = query.lower().split()
        if not tokens:
            return

        root = tokens[0]
        self.query_counter[root] += 1
        self.last_seen[root] = when or datetime.now(UTC)

        if category:
            category_key = category.lower()
            self.category_counter[category_key] += 1
            for token in set(tokens):
                bucket = self.token_category_counter.setdefault(token, Counter())
                bucket[category_key] += 1

    def top_queries(self, n: int = 5) -> list[tuple[str, int]]:
        """Return top N query roots."""
        return self.query_counter.most_common(n)

    def predict_categories(self, query: str, top_k: int = 3) -> list[str]:
        """Predict likely categories from token/category history."""
        scores: Counter[str] = Counter()
        for token in query.lower().split():
            scores.update(self.token_category_counter.get(token, Counter()))

        if not scores:
            return [name for name, _ in self.category_counter.most_common(top_k)]

        return [name for name, _ in scores.most_common(top_k)]

    def snapshot(self) -> dict[str, Any]:
        """Return serializable pattern statistics."""
        return {
            "queries": dict(self.query_counter),
            "categories": dict(self.category_counter),
            "last_seen": {key: value.isoformat() for key, value in self.last_seen.items()},
        }


__all__ = ["UsagePatternAnalyzer"]
