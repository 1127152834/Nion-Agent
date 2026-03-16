"""Soul resolver for loading soul assets."""

from __future__ import annotations

from nion.agents.soul.models import SoulAsset
from nion.config.paths import get_paths


class SoulResolver:
    """Resolve and load soul assets."""

    def __init__(self):
        self._paths = get_paths()

    def load_soul(self, agent_name: str | None = None) -> SoulAsset | None:
        """Load SOUL.md for agent."""
        if agent_name:
            soul_path = self._paths.agent_soul_file(agent_name)
        else:
            soul_path = self._paths.agent_soul_file("_default")

        if not soul_path.exists():
            return None

        content = soul_path.read_text(encoding="utf-8").strip()
        if not content:
            return None

        return SoulAsset(content=content, source_path=str(soul_path), asset_type="soul")

    def load_identity(self, agent_name: str | None = None) -> SoulAsset | None:
        """Load IDENTITY.md for agent."""
        if agent_name:
            identity_path = self._paths.agent_identity_file(agent_name)
        else:
            identity_path = self._paths.agent_identity_file("_default")

        if not identity_path.exists():
            return None

        content = identity_path.read_text(encoding="utf-8").strip()
        if not content:
            return None

        return SoulAsset(content=content, source_path=str(identity_path), asset_type="identity")

    def load_user_profile(self) -> SoulAsset | None:
        """Load USER.md."""
        user_path = self._paths.user_md_file
        if not user_path.exists():
            return None

        content = user_path.read_text(encoding="utf-8").strip()
        if not content:
            return None

        return SoulAsset(content=content, source_path=str(user_path), asset_type="user")
