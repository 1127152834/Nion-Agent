"""Memory updater for reading, writing, and updating memory data."""

import json
import re
import uuid

import yaml
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.agents.memory.core import MemoryReadRequest
from src.agents.memory.prompt import (
    MEMORY_UPDATE_PROMPT,
    format_conversation_for_update,
)
from src.agents.memory.registry import get_default_memory_provider
from src.config.memory_config import get_memory_config
from src.models import create_chat_model


def _get_memory_file_path(agent_name: str | None = None) -> Path:
    """Backward-compatible helper that now points to structured manifest path.

    Args:
        agent_name: If provided, returns the per-agent manifest path.
            If None, returns the global manifest path.

    Returns:
        Path to the structured manifest file.
    """
    runtime = _get_structured_runtime()
    if hasattr(runtime, "_scope_from_agent") and hasattr(runtime, "_scope_manifest_file"):
        scope = runtime._scope_from_agent(agent_name)
        return runtime._scope_manifest_file(scope)
    raise RuntimeError("Structured runtime does not expose scope manifest helpers")


def _utcnow_iso_z() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _create_empty_memory() -> dict[str, Any]:
    """Create an empty memory structure."""
    return {
        "version": "3.0",
        "lastUpdated": _utcnow_iso_z(),
        "user": {
            "workContext": {"summary": "", "updatedAt": ""},
            "personalContext": {"summary": "", "updatedAt": ""},
            "topOfMind": {"summary": "", "updatedAt": ""},
        },
        "history": {
            "recentMonths": {"summary": "", "updatedAt": ""},
            "earlierContext": {"summary": "", "updatedAt": ""},
            "longTermBackground": {"summary": "", "updatedAt": ""},
        },
        "facts": [],
    }


def _get_structured_runtime():
    provider = get_default_memory_provider()
    runtime = getattr(provider, "_runtime", None)
    if runtime is None or not hasattr(runtime, "save_memory_data"):
        raise RuntimeError("Structured runtime is not available")
    return runtime


def get_memory_data(agent_name: str | None = None) -> dict[str, Any]:
    """Get memory data from structured runtime by scope."""
    provider = get_default_memory_provider()
    return provider.get_memory_data(MemoryReadRequest(agent_name=agent_name))


def reload_memory_data(agent_name: str | None = None) -> dict[str, Any]:
    """Reload memory data from structured runtime."""
    provider = get_default_memory_provider()
    return provider.reload_memory_data(MemoryReadRequest(agent_name=agent_name))


def _load_memory_from_file(agent_name: str | None = None) -> dict[str, Any]:
    """Compatibility wrapper kept for callers importing legacy name."""
    return get_memory_data(agent_name)


# Matches sentences that describe a file-upload *event* rather than general
# file-related work.  Deliberately narrow to avoid removing legitimate facts
# such as "User works with CSV files" or "prefers PDF export".
_UPLOAD_SENTENCE_RE = re.compile(
    r"[^.!?]*\b(?:"
    r"upload(?:ed|ing)?(?:\s+\w+){0,3}\s+(?:file|files?|document|documents?|attachment|attachments?)"
    r"|file\s+upload"
    r"|/mnt/user-data/uploads/"
    r"|<uploaded_files>"
    r")[^.!?]*[.!?]?\s*",
    re.IGNORECASE,
)


def _strip_upload_mentions_from_memory(memory_data: dict[str, Any]) -> dict[str, Any]:
    """Remove sentences about file uploads from all memory summaries and facts.

    Uploaded files are session-scoped; persisting upload events in long-term
    memory causes the agent to search for non-existent files in future sessions.
    """
    # Scrub summaries in user/history sections
    for section in ("user", "history"):
        section_data = memory_data.get(section, {})
        for _key, val in section_data.items():
            if isinstance(val, dict) and "summary" in val:
                cleaned = _UPLOAD_SENTENCE_RE.sub("", val["summary"]).strip()
                cleaned = re.sub(r"  +", " ", cleaned)
                val["summary"] = cleaned

    # Also remove any facts that describe upload events
    facts = memory_data.get("facts", [])
    if facts:
        memory_data["facts"] = [
            f
            for f in facts
            if not _UPLOAD_SENTENCE_RE.search(f.get("content", ""))
        ]

    return memory_data


def _save_memory_to_file(
    memory_data: dict[str, Any],
    agent_name: str | None = None,
    thread_id: str | None = None,
) -> bool:
    """Save memory data into structured runtime (legacy function name retained)."""
    try:
        runtime = _get_structured_runtime()
        memory_data["lastUpdated"] = _utcnow_iso_z()
        return bool(runtime.save_memory_data(memory_data, agent_name=agent_name, thread_id=thread_id))
    except Exception as e:
        print(f"Failed to save structured memory: {e}")
        return False


def _extract_text_fragments(content: Any) -> list[str]:
    if isinstance(content, str):
        stripped = content.strip()
        return [stripped] if stripped else []

    if isinstance(content, list):
        fragments: list[str] = []
        for item in content:
            fragments.extend(_extract_text_fragments(item))
        return fragments

    if isinstance(content, dict):
        fragments: list[str] = []
        for key in ("text", "content", "value", "output_text"):
            if key in content:
                fragments.extend(_extract_text_fragments(content.get(key)))
        return fragments

    return []


def _response_content_to_text(content: Any) -> str:
    fragments = _extract_text_fragments(content)
    if fragments:
        return "\n".join(fragments).strip()
    return str(content).strip()


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped

    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]

    return "\n".join(lines).strip()


def _extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False

    for index in range(start, len(text)):
        char = text[index]

        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue

        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    return None


def _normalize_update_data(data: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(data)
    normalized["user"] = normalized.get("user") if isinstance(normalized.get("user"), dict) else {}
    normalized["history"] = normalized.get("history") if isinstance(normalized.get("history"), dict) else {}
    normalized["newFacts"] = normalized.get("newFacts") if isinstance(normalized.get("newFacts"), list) else []
    normalized["factsToRemove"] = normalized.get("factsToRemove") if isinstance(normalized.get("factsToRemove"), list) else []
    return normalized


def parse_memory_update_response(response_text: str) -> dict[str, Any]:
    candidates: list[str] = []

    raw_text = response_text.strip()
    if raw_text:
        candidates.append(raw_text)

    without_fences = _strip_code_fences(raw_text)
    if without_fences and without_fences not in candidates:
        candidates.append(without_fences)

    for candidate in list(candidates):
        extracted = _extract_first_json_object(candidate)
        if extracted and extracted not in candidates:
            candidates.append(extracted)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return _normalize_update_data(parsed)

    for candidate in candidates:
        try:
            parsed = yaml.safe_load(candidate)
        except yaml.YAMLError:
            continue
        if isinstance(parsed, dict):
            return _normalize_update_data(parsed)

    raise ValueError("Memory update response is not a parseable object")


def _truncate_log_text(text: str, max_chars: int = 240) -> str:
    compact = " ".join(text.strip().split())
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 3] + "..."


class MemoryUpdater:
    """Updates memory using LLM based on conversation context."""

    def __init__(self, model_name: str | None = None):
        """Initialize the memory updater.

        Args:
            model_name: Optional model name to use. If None, uses config or default.
        """
        self._model_name = model_name

    def _get_model(self):
        """Get the model for memory updates."""
        config = get_memory_config()
        model_name = self._model_name or config.model_name
        return create_chat_model(name=model_name, thinking_enabled=False)

    def update_memory(self, messages: list[Any], thread_id: str | None = None, agent_name: str | None = None) -> bool:
        """Update memory based on conversation messages.

        Args:
            messages: List of conversation messages.
            thread_id: Optional thread ID for tracking source.
            agent_name: If provided, updates per-agent memory. If None, updates global memory.

        Returns:
            True if update was successful, False otherwise.
        """
        config = get_memory_config()
        if not config.enabled:
            return False

        if not messages:
            return False

        try:
            # Get current memory
            current_memory = get_memory_data(agent_name)

            # Format conversation for prompt
            conversation_text = format_conversation_for_update(messages)

            if not conversation_text.strip():
                return False

            # Build prompt
            prompt = MEMORY_UPDATE_PROMPT.format(
                current_memory=json.dumps(current_memory, indent=2),
                conversation=conversation_text,
            )

            # Call LLM
            model = self._get_model()
            response = model.invoke(prompt)
            response_text = _response_content_to_text(getattr(response, "content", response))

            update_data = parse_memory_update_response(response_text)

            # Apply updates
            updated_memory = self._apply_updates(current_memory, update_data, thread_id)

            # Strip file-upload mentions from all summaries before saving.
            # Uploaded files are session-scoped and won't exist in future sessions,
            # so recording upload events in long-term memory causes the agent to
            # try (and fail) to locate those files in subsequent conversations.
            updated_memory = _strip_upload_mentions_from_memory(updated_memory)

            # Save
            return _save_memory_to_file(updated_memory, agent_name, thread_id=thread_id)

        except ValueError as e:
            model_name = self._model_name or config.model_name or "default"
            response_excerpt = _truncate_log_text(response_text if "response_text" in locals() else "")
            print(
                "Failed to parse LLM response for memory update "
                f"(thread_id={thread_id or 'unknown'}, model={model_name}, response_excerpt={response_excerpt!r}): {e}"
            )
            return False
        except Exception as e:
            model_name = self._model_name or config.model_name or "default"
            print(
                "Memory update failed "
                f"(thread_id={thread_id or 'unknown'}, model={model_name}): {e}"
            )
            return False

    def _apply_updates(
        self,
        current_memory: dict[str, Any],
        update_data: dict[str, Any],
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        """Apply LLM-generated updates to memory.

        Args:
            current_memory: Current memory data.
            update_data: Updates from LLM.
            thread_id: Optional thread ID for tracking.

        Returns:
            Updated memory data.
        """
        config = get_memory_config()
        now = _utcnow_iso_z()

        # Update user sections
        user_updates = update_data.get("user", {})
        for section in ["workContext", "personalContext", "topOfMind"]:
            section_data = user_updates.get(section, {})
            if section_data.get("shouldUpdate") and section_data.get("summary"):
                current_memory["user"][section] = {
                    "summary": section_data["summary"],
                    "updatedAt": now,
                }

        # Update history sections
        history_updates = update_data.get("history", {})
        for section in ["recentMonths", "earlierContext", "longTermBackground"]:
            section_data = history_updates.get(section, {})
            if section_data.get("shouldUpdate") and section_data.get("summary"):
                current_memory["history"][section] = {
                    "summary": section_data["summary"],
                    "updatedAt": now,
                }

        # Remove facts
        facts_to_remove = set(update_data.get("factsToRemove", []))
        if facts_to_remove:
            current_memory["facts"] = [f for f in current_memory.get("facts", []) if f.get("id") not in facts_to_remove]

        # Add new facts
        new_facts = update_data.get("newFacts", [])
        for fact in new_facts:
            confidence = fact.get("confidence", 0.5)
            if confidence >= config.fact_confidence_threshold:
                fact_entry = {
                    "id": f"fact_{uuid.uuid4().hex[:8]}",
                    "content": fact.get("content", ""),
                    "category": fact.get("category", "context"),
                    "confidence": confidence,
                    "createdAt": now,
                    "source": thread_id or "unknown",
                }
                current_memory["facts"].append(fact_entry)

        # Enforce max facts limit
        if len(current_memory["facts"]) > config.max_facts:
            # Sort by confidence and keep top ones
            current_memory["facts"] = sorted(
                current_memory["facts"],
                key=lambda f: f.get("confidence", 0),
                reverse=True,
            )[: config.max_facts]

        return current_memory


def update_memory_from_conversation(messages: list[Any], thread_id: str | None = None, agent_name: str | None = None) -> bool:
    """Convenience function to update memory from a conversation.

    Args:
        messages: List of conversation messages.
        thread_id: Optional thread ID.
        agent_name: If provided, updates per-agent memory. If None, updates global memory.

    Returns:
        True if successful, False otherwise.
    """
    updater = MemoryUpdater()
    return updater.update_memory(messages, thread_id, agent_name)
