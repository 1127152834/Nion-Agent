"""Build semantic links between memory items."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Any


@dataclass
class MemoryLink:
    """Semantic link between two memory items."""

    source_id: str
    target_id: str
    score: float
    link_type: str = "semantic"


class MemoryLinker:
    """Create links based on content similarity."""

    def __init__(self, similarity_threshold: float = 0.6) -> None:
        self.similarity_threshold = similarity_threshold

    def _similarity(self, text1: str, text2: str) -> float:
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        if not words1 or not words2:
            return 0.0
        return len(words1 & words2) / len(words1 | words2)

    def build_links(self, items: list[dict[str, Any]]) -> list[MemoryLink]:
        """Build bidirectional link candidates from memory item list."""
        links: list[MemoryLink] = []

        for item1, item2 in combinations(items, 2):
            id1 = str(item1.get("id", ""))
            id2 = str(item2.get("id", ""))
            if not id1 or not id2:
                continue

            score = self._similarity(
                str(item1.get("content", "")),
                str(item2.get("content", "")),
            )
            if score < self.similarity_threshold:
                continue

            links.append(MemoryLink(source_id=id1, target_id=id2, score=score))

        return links


__all__ = ["MemoryLink", "MemoryLinker"]
