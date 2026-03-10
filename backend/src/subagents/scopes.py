"""Subagent scope models."""

from dataclasses import dataclass
from typing import Literal


@dataclass
class SubagentScopes:
    """Defines the access boundaries for a subagent.

    Attributes:
        tool_scope: Tools the subagent can access.
            - "inherit": Inherit all tools from parent agent
            - list[str]: Specific tool names allowed
        skill_scope: Skills the subagent can access.
            - "inherit": Inherit all skills from parent agent
            - "none": No skills access
            - list[str]: Specific skill names allowed
        memory_scope: Long-term memory access level.
            - "read-only": Can read memory but not write
            - "no-access": Cannot access long-term memory
        soul_scope: Soul asset access level.
            - "minimal-summary": Only receives minimal style/boundary summary
            - "none": No soul asset access
        artifact_scope: Artifact access level.
            - "read-write": Can read and write artifacts
            - "read-only": Can only read artifacts
    """

    tool_scope: list[str] | Literal["inherit"] = "inherit"
    skill_scope: list[str] | Literal["inherit", "none"] = "none"
    memory_scope: Literal["read-only", "no-access"] = "read-only"
    soul_scope: Literal["minimal-summary", "none"] = "minimal-summary"
    artifact_scope: Literal["read-write", "read-only"] = "read-write"
