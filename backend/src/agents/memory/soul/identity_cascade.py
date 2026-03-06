"""Identity cascade resolver for global/agent/workspace layers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Identity:
    """Resolved identity info."""

    name: str
    tone: str
    avatar: str | None = None
    description: str | None = None
    language: str | None = None
    custom: dict[str, Any] = field(default_factory=dict)


class IdentityCascade:
    """Resolve identity precedence: global < agent < workspace."""

    def __init__(self, global_config: dict[str, Any] | None = None) -> None:
        self.global_config = global_config or {}

    def resolve_identity(
        self,
        agent_name: str | None = None,  # noqa: ARG002
        agent_config: dict[str, Any] | None = None,
        workspace_files: Any = None,
    ) -> Identity:
        """Resolve final identity from all sources."""
        identity = Identity(
            name=str(self.global_config.get("name", "Assistant")),
            tone=str(self.global_config.get("tone", "professional")),
            avatar=self.global_config.get("avatar"),
            description=self.global_config.get("description"),
            language=self.global_config.get("language"),
            custom=dict(self.global_config.get("custom", {}) or {}),
        )

        agent_identity = (agent_config or {}).get("identity", {}) if agent_config else {}
        if agent_identity:
            self._apply_overrides(identity, agent_identity)

        if workspace_files is not None and hasattr(workspace_files, "get_identity"):
            ws_identity = workspace_files.get_identity() or {}
            if ws_identity:
                self._apply_overrides(identity, ws_identity)

        return identity

    def _apply_overrides(self, identity: Identity, overrides: dict[str, Any]) -> None:
        if "name" in overrides and overrides["name"]:
            identity.name = str(overrides["name"])
        if "tone" in overrides and overrides["tone"]:
            identity.tone = str(overrides["tone"])
        if "avatar" in overrides and overrides["avatar"]:
            identity.avatar = str(overrides["avatar"])
        if "description" in overrides and overrides["description"]:
            identity.description = str(overrides["description"])
        if "language" in overrides and overrides["language"]:
            identity.language = str(overrides["language"])

        custom = overrides.get("custom")
        if isinstance(custom, dict) and custom:
            merged = dict(identity.custom)
            merged.update(custom)
            identity.custom = merged


class SoulResolver:
    """Resolve soul prompt with bootstrap/workspace/default fallback."""

    def __init__(self, workspace_manager: Any = None) -> None:
        self.workspace_manager = workspace_manager

    def resolve_soul(
        self,
        agent_name: str | None = None,
        bootstrap_soul: str | None = None,
    ) -> str:
        """Resolve final soul text."""
        if bootstrap_soul:
            return bootstrap_soul

        if self.workspace_manager is not None and hasattr(self.workspace_manager, "get_workspace"):
            workspace = self.workspace_manager.get_workspace(agent_name)
            if workspace is not None and hasattr(workspace, "get_soul"):
                soul = workspace.get_soul()
                if soul:
                    return soul

        return self._default_soul()

    def _default_soul(self) -> str:
        return """**Identity**

Nion — Your AI assistant.

**Core Traits**

- Be helpful and concise
- Proactive in surfacing relevant information

**Communication**

- Professional but approachable
- Match user's language preference
"""


__all__ = ["Identity", "IdentityCascade", "SoulResolver"]
