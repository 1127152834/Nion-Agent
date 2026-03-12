"""Memory governance service (OpenViking single-stack)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from src.agents.memory.registry import get_default_memory_provider
from src.config.default_agent import DEFAULT_AGENT_NAME, ensure_default_agent
from src.config.paths import get_paths


def _summarize_markdown(content: str, *, max_chars: int = 180) -> str:
    lines = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue
        if line.startswith("- "):
            line = line[2:].strip()
        lines.append(line)
        if len(" ".join(lines)) >= max_chars:
            break

    summary = " ".join(lines).strip()
    if len(summary) > max_chars:
        return summary[: max_chars - 3] + "..."
    return summary


class MemoryGovernor:
    """Coordinates governance queue and agent catalog refresh."""

    def __init__(self):
        provider = get_default_memory_provider()
        runtime = getattr(provider, "_runtime", None)
        if runtime is None:
            raise RuntimeError("Memory governor requires OpenViking runtime")
        self._runtime = runtime
        self._paths = get_paths()

    def run(self) -> dict:
        result = self._runtime.run_governance(agent_name=None)
        cards = self.refresh_agent_catalog()
        result["catalog_size"] = len(cards)
        return result

    def status(self) -> dict:
        status = self._runtime.get_governance_status(agent_name=None)
        status["catalog_size"] = len(self._runtime.list_agent_catalog())
        return status

    def decide(
        self,
        *,
        decision_id: str,
        action: str,
        override_summary: str | None = None,
        decided_by: str = "user",
    ) -> dict:
        return self._runtime.apply_governance_decision(
            decision_id=decision_id,
            action=action,
            override_summary=override_summary,
            decided_by=decided_by,
            agent_name=None,
        )

    def refresh_agent_catalog(self) -> list[dict]:
        ensure_default_agent()

        cards: list[dict] = []
        for agent_name, agent_dir in self._iter_agent_dirs():
            config_payload = self._load_agent_config(agent_dir / "agent.json")
            soul_content = self._load_text(agent_dir / "SOUL.md")
            identity_content = self._load_text(agent_dir / "IDENTITY.md")

            role = "default_assistant" if agent_name == DEFAULT_AGENT_NAME else "custom_agent"
            capability_summary = str(config_payload.get("description", "")).strip()
            if not capability_summary:
                capability_summary = _summarize_markdown(soul_content, max_chars=160)
            persona_summary = _summarize_markdown(identity_content or soul_content, max_chars=200)
            style_hint = _summarize_markdown(identity_content, max_chars=120)

            cards.append(
                {
                    "agent_name": agent_name,
                    "role": role,
                    "capability_summary": capability_summary,
                    "persona_summary": persona_summary,
                    "style_hint": style_hint,
                    "updated_at": self._latest_updated_at(agent_dir),
                }
            )

        cards.sort(key=lambda item: str(item.get("agent_name") or ""))
        self._runtime.replace_agent_catalog(cards)
        return cards

    def _iter_agent_dirs(self) -> list[tuple[str, Path]]:
        result: list[tuple[str, Path]] = []
        agents_dir = self._paths.agents_dir
        if not agents_dir.exists():
            return result
        for entry in agents_dir.iterdir():
            if not entry.is_dir():
                continue
            result.append((entry.name, entry))
        return result

    def _load_agent_config(self, path: Path) -> dict:
        if not path.exists():
            return {}
        try:
            with open(path, encoding="utf-8") as file:
                payload = json.load(file)
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    def _load_text(self, path: Path) -> str:
        if not path.exists():
            return ""
        try:
            return path.read_text(encoding="utf-8")
        except Exception:
            return ""

    def _latest_updated_at(self, agent_dir: Path) -> str:
        latest_mtime = 0.0
        for name in ("agent.json", "SOUL.md", "IDENTITY.md"):
            path = agent_dir / name
            if not path.exists():
                continue
            try:
                latest_mtime = max(latest_mtime, path.stat().st_mtime)
            except OSError:
                continue
        if latest_mtime <= 0:
            return ""
        return datetime.fromtimestamp(latest_mtime, tz=UTC).isoformat().replace("+00:00", "Z")


_governor: MemoryGovernor | None = None


def get_memory_governor() -> MemoryGovernor:
    global _governor
    if _governor is None:
        _governor = MemoryGovernor()
    return _governor
