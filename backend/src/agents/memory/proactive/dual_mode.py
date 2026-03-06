"""Dual-mode retrieval for proactive memory access."""

from __future__ import annotations

import re
import time
from enum import Enum
from typing import Any


class RetrievalMode(Enum):
    """Retrieval modes for memory queries."""

    FAST_CONTEXT = "fast"
    DEEP_REASONING = "deep"


class DualModeRetriever:
    """Choose fast or deep retrieval mode based on confidence and query complexity."""

    def __init__(
        self,
        hybrid_search: Any,
        llm: Any,
        fast_threshold: float = 0.7,
        deep_threshold: float = 0.3,
        complex_indicators: list[str] | None = None,
    ) -> None:
        self.hybrid_search = hybrid_search
        self.llm = llm
        self.fast_threshold = fast_threshold
        self.deep_threshold = deep_threshold
        self.complex_indicators = complex_indicators or [
            "why",
            "how",
            "explain",
            "reason",
            "relationship",
            "compare",
            "analyze",
        ]

    def retrieve(
        self,
        query: str,
        query_embedding: list[float],
        force_mode: RetrievalMode | str | None = None,
        top_k: int = 5,
    ) -> dict[str, Any]:
        """Retrieve memories in fast or deep mode."""
        mode = self._resolve_mode(force_mode, query, query_embedding)
        if mode == RetrievalMode.FAST_CONTEXT:
            return self._fast_context_retrieve(query, query_embedding, top_k=top_k)
        return self._deep_reasoning_retrieve(query, query_embedding, top_k=top_k)

    def _resolve_mode(
        self,
        force_mode: RetrievalMode | str | None,
        query: str,
        query_embedding: list[float],
    ) -> RetrievalMode:
        if force_mode is None:
            return self._decide_mode(query, query_embedding)
        if isinstance(force_mode, RetrievalMode):
            return force_mode
        if str(force_mode).lower() == RetrievalMode.DEEP_REASONING.value:
            return RetrievalMode.DEEP_REASONING
        return RetrievalMode.FAST_CONTEXT

    def _decide_mode(self, query: str, query_embedding: list[float]) -> RetrievalMode:
        fast_results = self.hybrid_search.search(query, query_embedding, top_k=3)
        top_score = float(fast_results[0].get("fused_score", 0.0)) if fast_results else 0.0

        if top_score >= self.fast_threshold:
            return RetrievalMode.FAST_CONTEXT

        if top_score <= self.deep_threshold:
            return RetrievalMode.DEEP_REASONING

        lowered = query.lower()
        if any(indicator in lowered for indicator in self.complex_indicators):
            return RetrievalMode.DEEP_REASONING

        return RetrievalMode.FAST_CONTEXT

    def _fast_context_retrieve(
        self,
        query: str,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> dict[str, Any]:
        started = time.time()
        results = self.hybrid_search.search(query, query_embedding, top_k=top_k)
        return {
            "mode": RetrievalMode.FAST_CONTEXT.value,
            "results": results,
            "latency_ms": (time.time() - started) * 1000.0,
            "reasoning": "High confidence results from hybrid search",
        }

    def _deep_reasoning_retrieve(
        self,
        query: str,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> dict[str, Any]:
        started = time.time()
        candidates = self.hybrid_search.search(query, query_embedding, top_k=max(top_k * 2, 2))

        reasoning = "Low confidence query, fallback to candidate ranking"
        ranked = list(candidates)

        if candidates and self.llm is not None and hasattr(self.llm, "invoke"):
            candidate_text = "\n".join(
                f"- {candidate.get('id', '')}: {candidate.get('content', '')}"
                for candidate in candidates
            )
            prompt = (
                f'User query: "{query}"\n\n'
                f"Candidate memories:\n{candidate_text}\n\n"
                "Return the preferred item ids in order, then a short explanation."
            )
            response = self.llm.invoke(prompt)
            reasoning = str(getattr(response, "content", response)).strip()
            ranked = self._rerank_by_reasoning(candidates, reasoning)

        return {
            "mode": RetrievalMode.DEEP_REASONING.value,
            "results": ranked[:top_k],
            "latency_ms": (time.time() - started) * 1000.0,
            "reasoning": reasoning,
        }

    def _rerank_by_reasoning(
        self,
        candidates: list[dict[str, Any]],
        reasoning: str,
    ) -> list[dict[str, Any]]:
        if not reasoning:
            return candidates

        lowered = reasoning.lower()
        positions: dict[str, int] = {}

        for candidate in candidates:
            candidate_id = str(candidate.get("id", ""))
            if not candidate_id:
                continue
            match = re.search(re.escape(candidate_id.lower()), lowered)
            if match is not None:
                positions[candidate_id] = match.start()

        if not positions:
            return candidates

        return sorted(
            candidates,
            key=lambda candidate: (
                positions.get(str(candidate.get("id", "")), 10**9),
                -float(candidate.get("fused_score", 0.0)),
            ),
        )


__all__ = ["RetrievalMode", "DualModeRetriever"]
