"""Self-evolving engine for memory optimization."""

from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from itertools import combinations
from typing import Any


@dataclass
class UsagePattern:
    """Usage patterns observed from retrieval behavior."""

    query_patterns: Counter[str] = field(default_factory=Counter)
    accessed_categories: Counter[str] = field(default_factory=Counter)
    time_patterns: dict[str, int] = field(default_factory=dict)
    topic_trends: list[str] = field(default_factory=list)
    avg_session_length: float = 0.0


@dataclass
class EvolutionMetrics:
    """Metrics representing current memory quality."""

    memory_efficiency: float = 0.0
    retrieval_accuracy: float = 0.0
    relevance_score: float = 0.0
    redundancy_rate: float = 0.0
    staleness_score: float = 0.0


class SelfEvolvingEngine:
    """Optimize memory structure based on usage and aging patterns."""

    def __init__(
        self,
        item_layer: Any,
        category_layer: Any,
        llm: Any,
        config: dict[str, Any] | None = None,
    ) -> None:
        self.item_layer = item_layer
        self.category_layer = category_layer
        self.llm = llm
        self.config = config or {}

        self.usage_pattern = UsagePattern()

        self.compression_threshold = int(self.config.get("compression_threshold", 10))
        self.merge_similarity_threshold = float(
            self.config.get("merge_similarity_threshold", 0.85)
        )
        self.staleness_threshold_days = int(self.config.get("staleness_threshold_days", 90))
        self.max_items_before_compress = int(self.config.get("max_items_before_compress", 200))
        self.redundancy_threshold = float(self.config.get("redundancy_threshold", 0.3))
        self.min_category_usage = int(self.config.get("min_category_usage", 3))

    def _all_items(self) -> list[dict[str, Any]]:
        if hasattr(self.item_layer, "list_items"):
            return list(self.item_layer.list_items())

        if hasattr(self.item_layer, "_items"):
            return [dict(item) for item in getattr(self.item_layer, "_items").values()]

        if hasattr(self.item_layer, "items"):
            raw = getattr(self.item_layer, "items")
            if isinstance(raw, dict):
                return [dict(item) for item in raw.values()]
            if isinstance(raw, list):
                return [dict(item) for item in raw]

        return []

    def _parse_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return datetime.now(UTC)

    def record_query(self, query: str, category: str | None = None) -> None:
        """Record query and category access patterns."""
        tokens = query.lower().split()
        if tokens:
            self.usage_pattern.query_patterns[tokens[0]] += 1

        if category:
            self.usage_pattern.accessed_categories[category] += 1

        hour = str(datetime.now(UTC).hour)
        self.usage_pattern.time_patterns[hour] = self.usage_pattern.time_patterns.get(hour, 0) + 1

    def analyze_topic_trends(self, time_window_days: int = 7) -> list[str]:
        """Analyze recent topic trends from memory item content."""
        recent_items = self._get_recent_items(time_window_days)
        terms: list[str] = []
        for item in recent_items:
            words = str(item.get("content", "")).lower().split()
            terms.extend(word for word in words if len(word) > 3)

        self.usage_pattern.topic_trends = [
            token for token, _ in Counter(terms).most_common(10)
        ]
        return self.usage_pattern.topic_trends

    def should_compress(self) -> bool:
        """Decide whether compression should run."""
        items = self._all_items()
        if len(items) > self.max_items_before_compress:
            return True

        return self._calculate_redundancy(items) > self.redundancy_threshold

    def evolve(self) -> dict[str, Any]:
        """Run one self-evolution cycle and return an evolution report."""
        report: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "actions": [],
        }

        processed_source_ids: set[str] = set()
        if self.should_compress():
            merged_actions = self._compress_memory(processed_source_ids)
            report["actions"].extend(merged_actions)
            if merged_actions:
                report["compressed"] = True
        else:
            merged_actions = self._merge_similar_items(processed_source_ids)
            report["actions"].extend(merged_actions)
        if merged_actions:
            report["merged_count"] = len(merged_actions)

        category_actions = self._optimize_categories()
        report["actions"].extend(category_actions)

        stale_actions = self._handle_stale_memories()
        report["actions"].extend(stale_actions)

        report["metrics"] = asdict(self._calculate_evolution_metrics())
        return report

    def _compress_memory(self, processed_source_ids: set[str]) -> list[dict[str, Any]]:
        """Compression step currently delegates to merge operation."""
        return self._merge_similar_items(processed_source_ids)

    def _merge_similar_items(self, processed_source_ids: set[str] | None = None) -> list[dict[str, Any]]:
        """Merge highly similar items into a compact representation."""
        items = self._all_items()
        merged_actions: list[dict[str, Any]] = []
        processed = processed_source_ids if processed_source_ids is not None else set()

        for item1, item2 in combinations(items, 2):
            id1 = str(item1.get("id", ""))
            id2 = str(item2.get("id", ""))
            if not id1 or not id2 or id1 == id2:
                continue

            source_ids_1 = self._extract_source_ids(item1)
            source_ids_2 = self._extract_source_ids(item2)
            if not source_ids_1 or not source_ids_2:
                continue

            if source_ids_1 & processed or source_ids_2 & processed:
                continue

            combined_source_ids = source_ids_1 | source_ids_2
            if combined_source_ids & processed:
                continue

            similarity = self._calculate_similarity(
                str(item1.get("content", "")),
                str(item2.get("content", "")),
            )
            if similarity < self.merge_similarity_threshold:
                continue

            merged_item = {
                "id": f"merged_{uuid.uuid4().hex[:10]}",
                "content": self._llm_merge_items([item1, item2]),
                "category": str(item1.get("category", "context")),
                "confidence": max(
                    float(item1.get("confidence", 0.0)),
                    float(item2.get("confidence", 0.0)),
                ),
                "access_count": 0,
                "created_at": datetime.now(UTC).isoformat(),
                "last_accessed": datetime.now(UTC).isoformat(),
                "aggregated_from": sorted(combined_source_ids),
            }
            self.item_layer.store(merged_item)
            if hasattr(self.category_layer, "add_item"):
                self.category_layer.add_item(merged_item)
            self._delete_item(item1)
            self._delete_item(item2)
            processed.update(combined_source_ids)
            merged_actions.append(
                {
                    "type": "merge",
                    "from": [id1, id2],
                    "to": merged_item["id"],
                }
            )

        return merged_actions

    def _extract_source_ids(self, item: dict[str, Any]) -> set[str]:
        sources: set[str] = set()
        item_id = str(item.get("id", "")).strip()
        if item_id:
            sources.add(item_id)

        aggregated = item.get("aggregated_from")
        if isinstance(aggregated, list):
            for value in aggregated:
                source_id = str(value).strip()
                if source_id:
                    sources.add(source_id)
        return sources

    def _delete_item(self, item: dict[str, Any]) -> None:
        item_id = str(item.get("id", "")).strip()
        if not item_id:
            return

        if hasattr(self.item_layer, "delete"):
            self.item_layer.delete(item_id)
        elif hasattr(self.item_layer, "_items"):
            getattr(self.item_layer, "_items").pop(item_id, None)

        category = str(item.get("category", "context"))
        if hasattr(self.category_layer, "remove_item_globally"):
            self.category_layer.remove_item_globally(item_id)
            return

        if hasattr(self.category_layer, "remove_item"):
            self.category_layer.remove_item(category, item_id)

    def _optimize_categories(self) -> list[dict[str, Any]]:
        """Move low-usage categories into active target category."""
        if not self.usage_pattern.accessed_categories:
            return []

        active_categories = {
            category
            for category, count in self.usage_pattern.accessed_categories.items()
            if count >= self.min_category_usage
        }

        target = next(iter(active_categories), "context")
        actions: list[dict[str, Any]] = []

        for item in self._all_items():
            category = str(item.get("category", "context"))
            usage_count = self.usage_pattern.accessed_categories.get(category, 0)
            if usage_count >= self.min_category_usage or category == target:
                continue

            updated = dict(item)
            updated["category"] = target
            self.item_layer.store(updated)
            actions.append(
                {
                    "type": "move_category",
                    "from": category,
                    "to": target,
                    "item_id": str(item.get("id", "")),
                }
            )

        return actions

    def _handle_stale_memories(self) -> list[dict[str, Any]]:
        """Degrade or mark stale memories based on last access time."""
        actions: list[dict[str, Any]] = []
        threshold = datetime.now(UTC) - timedelta(days=self.staleness_threshold_days)

        for item in self._all_items():
            item_id = str(item.get("id", ""))
            if not item_id:
                continue

            last_accessed = self._parse_datetime(item.get("last_accessed"))
            if last_accessed >= threshold:
                continue

            confidence = float(item.get("confidence", 0.0))
            access_count = int(item.get("access_count", 0))

            if confidence > 0.8 or access_count > 10:
                updated = dict(item)
                updated["confidence"] = round(max(confidence * 0.9, 0.0), 4)
                updated["last_accessed"] = datetime.now(UTC).isoformat()
                self.item_layer.store(updated)
                actions.append(
                    {
                        "type": "degrade",
                        "item_id": item_id,
                        "new_confidence": updated["confidence"],
                    }
                )
            else:
                actions.append(
                    {
                        "type": "mark_stale",
                        "item_id": item_id,
                    }
                )

        return actions

    def _calculate_similarity(self, text1: str, text2: str) -> float:
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        if not words1 or not words2:
            return 0.0
        return len(words1 & words2) / len(words1 | words2)

    def _calculate_redundancy(self, items: list[dict[str, Any]] | None = None) -> float:
        sample = items if items is not None else self._all_items()
        if len(sample) < 2:
            return 0.0

        redundant_pairs = 0
        total_pairs = 0
        for item1, item2 in combinations(sample, 2):
            total_pairs += 1
            if (
                self._calculate_similarity(
                    str(item1.get("content", "")),
                    str(item2.get("content", "")),
                )
                >= 0.8
            ):
                redundant_pairs += 1

        if total_pairs == 0:
            return 0.0
        return redundant_pairs / total_pairs

    def _calculate_staleness_score(self, items: list[dict[str, Any]] | None = None) -> float:
        sample = items if items is not None else self._all_items()
        if not sample:
            return 0.0

        now = datetime.now(UTC)
        total = 0.0
        for item in sample:
            days = (now - self._parse_datetime(item.get("last_accessed"))).days
            total += min(days / max(self.staleness_threshold_days, 1), 1.0)

        return total / len(sample)

    def _calculate_evolution_metrics(self) -> EvolutionMetrics:
        items = self._all_items()
        total_access = sum(int(item.get("access_count", 0)) for item in items)

        efficiency = 0.0
        if items:
            efficiency = total_access / len(items)

        return EvolutionMetrics(
            memory_efficiency=efficiency,
            retrieval_accuracy=0.0,
            relevance_score=0.0,
            redundancy_rate=self._calculate_redundancy(items),
            staleness_score=self._calculate_staleness_score(items),
        )

    def _llm_merge_items(self, items: list[dict[str, Any]]) -> str:
        if self.llm is None or not hasattr(self.llm, "invoke"):
            return " ".join(str(item.get("content", "")) for item in items)

        bullet_items = "\n".join(f"- {item.get('content', '')}" for item in items)
        prompt = (
            "Merge the following related memory statements into one concise memory:\n"
            f"{bullet_items}\n"
            "Return only the merged memory statement."
        )
        response = self.llm.invoke(prompt)
        content = str(getattr(response, "content", response)).strip()
        if content:
            return content
        return " ".join(str(item.get("content", "")) for item in items)

    def _get_recent_items(self, days: int) -> list[dict[str, Any]]:
        cutoff = datetime.now(UTC) - timedelta(days=days)
        return [
            item
            for item in self._all_items()
            if self._parse_datetime(item.get("created_at")) >= cutoff
        ]


__all__ = ["UsagePattern", "EvolutionMetrics", "SelfEvolvingEngine"]
