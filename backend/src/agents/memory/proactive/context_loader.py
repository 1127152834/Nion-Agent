"""Context preloader for proactive memory retrieval."""

from __future__ import annotations

from typing import Any


class ContextPreloader:
    """Preload relevant memory and optional workspace context."""

    def __init__(self, memory_manager: Any, workspace_files: Any = None) -> None:
        self.memory_manager = memory_manager
        self.workspace_files = workspace_files

    def preload(self, query: str, top_k: int = 5) -> dict[str, Any]:
        """Load memory context and optional workspace metadata for a query."""
        payload = self.memory_manager.search(query=query, top_k=top_k)
        result = {
            "mode": payload.get("mode", "fast"),
            "results": payload.get("results", []),
            "reasoning": payload.get("reasoning", ""),
        }

        if self.workspace_files is not None:
            if hasattr(self.workspace_files, "get_identity"):
                result["identity"] = self.workspace_files.get_identity()
            if hasattr(self.workspace_files, "get_user"):
                result["user"] = self.workspace_files.get_user()
            if hasattr(self.workspace_files, "get_memory_summary"):
                result["memory_summary"] = self.workspace_files.get_memory_summary()

        return result


__all__ = ["ContextPreloader"]
