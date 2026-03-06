"""Workspace files management for soul/identity/user/memory state."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class WorkspaceFiles:
    """Manage per-agent workspace markdown files."""

    workspace_path: Path

    def __post_init__(self) -> None:
        self.workspace_path = Path(self.workspace_path)
        self.workspace_path.mkdir(parents=True, exist_ok=True)

        self.soul_file = self.workspace_path / "SOUL.md"
        self.identity_file = self.workspace_path / "IDENTITY.md"
        self.user_file = self.workspace_path / "USER.md"
        self.memory_file = self.workspace_path / "MEMORY.md"
        self.heartbeat_file = self.workspace_path / "HEARTBEAT.md"

    @classmethod
    def create_for_agent(cls, agent_name: str, base_path: Path) -> WorkspaceFiles:
        """Create workspace files container for one agent."""
        workspace_path = Path(base_path) / "workspaces" / agent_name
        workspace_path.mkdir(parents=True, exist_ok=True)
        return cls(workspace_path=workspace_path)

    def get_soul(self) -> str | None:
        """Read SOUL.md content if it exists."""
        if not self.soul_file.exists():
            return None
        return self.soul_file.read_text(encoding="utf-8")

    def set_soul(self, content: str) -> None:
        """Write SOUL.md content."""
        self.soul_file.write_text(content, encoding="utf-8")

    def set_identity(
        self,
        name: str | None = None,
        tone: str | None = None,
        avatar: str | None = None,
        description: str | None = None,
        language: str | None = None,
        custom: dict[str, Any] | None = None,
    ) -> None:
        """Write structured IDENTITY.md."""
        lines = ["# Identity", ""]

        if name:
            lines.append(f"- **Name**: {name}")
        if tone:
            lines.append(f"- **Tone**: {tone}")
        if avatar:
            lines.append(f"- **Avatar**: {avatar}")
        if language:
            lines.append(f"- **Language**: {language}")

        if custom:
            lines.append("- **Custom**:")
            for key, value in custom.items():
                lines.append(f"  - {key}: {value}")

        if description:
            lines.append("")
            lines.append("## Description")
            lines.append(description)

        self.identity_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def get_identity(self) -> dict[str, Any] | None:
        """Parse and return IDENTITY.md values."""
        if not self.identity_file.exists():
            return None
        return self._parse_identity(self.identity_file.read_text(encoding="utf-8"))

    def _parse_identity(self, content: str) -> dict[str, Any]:
        result: dict[str, Any] = {"content": content, "custom": {}}
        in_description = False

        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            if line.startswith("## Description"):
                in_description = True
                continue

            if in_description:
                current = result.get("description", "")
                result["description"] = (current + "\n" + line).strip() if current else line
                continue

            if line.startswith("- **Name**:"):
                result["name"] = line.split(":", 1)[1].strip()
            elif line.startswith("- **Tone**:"):
                result["tone"] = line.split(":", 1)[1].strip()
            elif line.startswith("- **Avatar**:"):
                result["avatar"] = line.split(":", 1)[1].strip()
            elif line.startswith("- **Language**:"):
                result["language"] = line.split(":", 1)[1].strip()
            elif line.startswith("- **Custom**"):
                continue
            elif line.startswith("-") and ":" in line and raw_line.startswith("  "):
                kv = line.lstrip("-").strip()
                key, value = kv.split(":", 1)
                result.setdefault("custom", {})[key.strip()] = value.strip()

        return result

    def set_user(
        self,
        name: str | None = None,
        preferences: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        """Write USER.md with user profile details."""
        lines = ["# User", ""]
        if name:
            lines.append(f"- **Name**: {name}")

        if preferences:
            lines.append("")
            lines.append("## Preferences")
            for key, value in preferences.items():
                lines.append(f"- {key}: {value}")

        if context:
            lines.append("")
            lines.append("## Context")
            for key, value in context.items():
                lines.append(f"- {key}: {value}")

        self.user_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def get_user(self) -> dict[str, Any] | None:
        """Parse USER.md into structured dict."""
        if not self.user_file.exists():
            return None

        name: str | None = None
        preferences: dict[str, str] = {}
        context: dict[str, str] = {}
        section: str | None = None

        for raw_line in self.user_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("## Preferences"):
                section = "preferences"
                continue
            if line.startswith("## Context"):
                section = "context"
                continue
            if line.startswith("- **Name**:"):
                name = line.split(":", 1)[1].strip()
                continue
            if line.startswith("-") and ":" in line:
                key, value = line.lstrip("-").split(":", 1)
                if section == "preferences":
                    preferences[key.strip()] = value.strip()
                elif section == "context":
                    context[key.strip()] = value.strip()

        return {
            "name": name,
            "preferences": preferences,
            "context": context,
            "content": self.user_file.read_text(encoding="utf-8"),
        }

    def get_memory_summary(self) -> str | None:
        """Read MEMORY.md content if present."""
        if not self.memory_file.exists():
            return None
        return self.memory_file.read_text(encoding="utf-8")

    def update_memory_summary(self, summary: str) -> None:
        """Write MEMORY.md summary content."""
        self.memory_file.write_text(summary, encoding="utf-8")

    def set_heartbeat(self, schedule: str, tasks: list[str]) -> None:
        """Write HEARTBEAT.md schedule config."""
        lines = ["# Heartbeat", "", f"Schedule: {schedule}", "", "## Tasks"]
        for task in tasks:
            lines.append(f"- {task}")
        self.heartbeat_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def get_heartbeat_config(self) -> dict[str, Any] | None:
        """Parse HEARTBEAT.md config."""
        if not self.heartbeat_file.exists():
            return None

        schedule = ""
        tasks: list[str] = []
        for raw_line in self.heartbeat_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line.startswith("Schedule:"):
                schedule = line.split(":", 1)[1].strip()
            elif line.startswith("- "):
                tasks.append(line[2:].strip())

        return {"schedule": schedule, "tasks": tasks}


__all__ = ["WorkspaceFiles"]
