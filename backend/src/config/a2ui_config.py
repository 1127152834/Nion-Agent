"""A2UI (Agent-to-UI) configuration.

Why this exists
---------------
Nion supports an "Agent-to-UI" capability (A2UI) that lets the model render
interactive UI surfaces (forms/buttons) via `send_a2ui_json_to_client`.

However, A2UI is not always desired:
- Some users prefer pure text interaction.
- Some environments (or debugging sessions) want to eliminate UI/tool noise.

Therefore we keep a dedicated config model that can be stored in Config Store
(SQLite) and toggled from the Settings UI (Session Policy).

Design notes
------------
- Default is enabled to preserve current behavior.
- The toggle is *global* (applies to all chats/agents) because it affects the
  lead agent middleware chain + prompt + tool exposure.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class A2UIConfig(BaseModel):
    """Global A2UI settings."""

    enabled: bool = Field(
        default=True,
        description="Whether A2UI is enabled (interactive UI rendering via send_a2ui_json_to_client).",
    )

    model_config = ConfigDict(extra="allow")

