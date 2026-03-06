"""Keyword-based intention prediction."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class IntentionType(Enum):
    """Supported memory intentions."""

    SEARCH_MEMORY = "search_memory"
    SUMMARIZE_MEMORY = "summarize_memory"
    UPDATE_MEMORY = "update_memory"
    UNKNOWN = "unknown"


@dataclass
class Intention:
    """Predicted user intention."""

    type: IntentionType
    confidence: float
    reason: str


class IntentionPredictor:
    """Predict intentions from query text using keyword heuristics."""

    KEYWORDS: dict[IntentionType, tuple[str, ...]] = {
        IntentionType.SEARCH_MEMORY: ("search", "find", "查", "搜索", "memory"),
        IntentionType.SUMMARIZE_MEMORY: ("summary", "summarize", "总结", "概括"),
        IntentionType.UPDATE_MEMORY: ("update", "remember", "记住", "更新"),
    }

    def predict(self, text: str, top_k: int = 3) -> list[Intention]:
        """Return ranked intentions by keyword hits."""
        lowered = text.lower()
        ranked: list[Intention] = []

        for intent_type, keywords in self.KEYWORDS.items():
            hits = sum(1 for keyword in keywords if keyword in lowered)
            if hits == 0:
                continue
            confidence = min(0.3 + hits * 0.2, 0.95)
            ranked.append(
                Intention(
                    type=intent_type,
                    confidence=confidence,
                    reason=f"Matched {hits} keyword(s)",
                )
            )

        ranked.sort(key=lambda item: item.confidence, reverse=True)
        if not ranked:
            return [
                Intention(
                    type=IntentionType.UNKNOWN,
                    confidence=0.1,
                    reason="No known intention keyword matched",
                )
            ]
        return ranked[:top_k]


__all__ = ["IntentionType", "Intention", "IntentionPredictor"]
