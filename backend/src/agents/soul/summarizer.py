"""Soul summarizer for injection."""

from __future__ import annotations

from src.agents.soul.models import SoulAsset, SoulSummary


class SoulSummarizer:
    """Summarize soul assets for injection."""

    def summarize(self, asset: SoulAsset, max_tokens: int = 500) -> SoulSummary:
        """Summarize a soul asset.

        For now, use simple truncation. Future: LLM-based summarization.
        """
        content = asset.content

        # Simple token estimation (4 chars ≈ 1 token)
        estimated_tokens = len(content) // 4

        if estimated_tokens <= max_tokens:
            # No summarization needed
            return SoulSummary(
                summary=content,
                source_type=asset.asset_type,
                token_count=estimated_tokens,
                full_content_available=True,
            )

        # Truncate to max_tokens
        max_chars = max_tokens * 4
        truncated = content[:max_chars] + "\n\n[... truncated ...]"

        return SoulSummary(
            summary=truncated,
            source_type=asset.asset_type,
            token_count=max_tokens,
            full_content_available=False,
        )
