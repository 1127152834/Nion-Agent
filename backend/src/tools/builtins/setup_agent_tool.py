import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.types import Command

from src.agents.memory.actions import store_memory_action
from src.agents.memory.registry import get_default_memory_provider
from src.config.paths import get_paths
from src.tools.builtins.langchain_compat import ToolRuntime

logger = logging.getLogger(__name__)
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")

USER_PROFILE_MARKER_START = "<!-- nion:bootstrap:user_profile:start -->"
USER_PROFILE_MARKER_END = "<!-- nion:bootstrap:user_profile:end -->"


def _tool_error(message: str, runtime: ToolRuntime) -> Command:
    logger.error("[agent_creator] %s", message)
    return Command(update={"messages": [ToolMessage(content=message, tool_call_id=runtime.tool_call_id)]})


def _render_user_profile_block(content: str) -> str:
    normalized = (content or "").strip()
    return f"{USER_PROFILE_MARKER_START}\n{normalized}\n{USER_PROFILE_MARKER_END}\n"


def _upsert_user_profile_block(*, user_md_path: Path, content: str) -> None:
    normalized = (content or "").strip()
    if not normalized:
        return

    user_md_path.parent.mkdir(parents=True, exist_ok=True)
    block = _render_user_profile_block(normalized)

    if not user_md_path.exists():
        user_md_path.write_text(block, encoding="utf-8")
        return

    raw = user_md_path.read_text(encoding="utf-8")
    start = raw.find(USER_PROFILE_MARKER_START)
    end = raw.find(USER_PROFILE_MARKER_END)

    if start != -1 and end != -1 and end > start:
        end += len(USER_PROFILE_MARKER_END)
        before = raw[:start].rstrip("\n")
        after = raw[end:].lstrip("\n")
        merged = before + ("\n\n" if before else "") + block.strip("\n") + ("\n\n" if after else "\n") + after
        user_md_path.write_text(merged, encoding="utf-8")
        return

    # No marker block found: append without destroying existing manual content.
    merged = raw.rstrip("\n") + "\n\n" + block
    user_md_path.write_text(merged, encoding="utf-8")


def _sync_openviking_managed_resources(
    *,
    items: list[tuple[Path, str, str | None]],
) -> list[str]:
    """Best-effort sync to OpenViking managed resources.

    Must never break the main bootstrap flow. Callers should treat returned
    strings as warnings only.
    """

    if not items:
        return []

    try:
        provider = get_default_memory_provider()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[agent_creator] OpenViking sync skipped: provider resolve failed: %s", exc)
        return [str(exc)]

    if getattr(provider, "name", None) != "openviking" or not hasattr(provider, "sync_managed_resource"):
        return []

    warnings: list[str] = []
    for local_path, target_uri, agent_name in items:
        try:
            provider.sync_managed_resource(  # type: ignore[attr-defined]
                local_path=local_path,
                target_uri=target_uri,
                agent_name=agent_name,
                reason="nion_asset_sync",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[agent_creator] OpenViking managed resource sync failed (agent=%s target=%s): %s",
                agent_name,
                target_uri,
                exc,
                exc_info=True,
            )
            warnings.append(f"{target_uri}: {exc}")
    return warnings


def _runtime_context(runtime: ToolRuntime) -> dict[str, Any]:
    if not isinstance(runtime.context, dict):
        return {}
    return runtime.context


def _runtime_state(runtime: ToolRuntime) -> dict[str, Any]:
    # ToolRuntime typing is intentionally loose for compatibility across
    # LangChain versions. Be defensive.
    state = getattr(runtime, "state", None)
    if not isinstance(state, dict):
        return {}
    return state


def _runtime_thread_id(runtime: ToolRuntime) -> str | None:
    value = _runtime_context(runtime).get("thread_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _memory_policy_state(runtime: ToolRuntime) -> dict[str, Any]:
    state = _runtime_state(runtime)
    return {
        "session_mode": state.get("session_mode"),
        "memory_read": state.get("memory_read"),
        "memory_write": state.get("memory_write"),
    }


def _memory_policy_runtime_context(runtime: ToolRuntime) -> dict[str, Any]:
    context = _runtime_context(runtime)
    return {
        "session_mode": context.get("session_mode"),
        "memory_read": context.get("memory_read"),
        "memory_write": context.get("memory_write"),
    }


def _normalize_identity(identity: str | None) -> str | None:
    payload = (identity or "").strip()
    return payload or None


def _normalize_memory_items(raw_items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not raw_items:
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        tier = str(item.get("tier") or "").strip().lower() or "episode"
        if tier not in {"profile", "preference", "episode", "trace"}:
            tier = "episode"
        confidence_raw = item.get("confidence")
        confidence = 0.9
        if confidence_raw is not None:
            try:
                confidence = float(confidence_raw)
            except Exception:  # noqa: BLE001
                confidence = 0.9
        normalized.append({"content": content, "tier": tier, "confidence": confidence})

    return normalized


@tool
def setup_agent(
    soul: str,
    description: str,
    # NOTE:
    # runtime is injected by LangGraph and must remain a required positional
    # parameter. Put it before optional params to keep Python signature valid.
    runtime: ToolRuntime,
    target: Literal["custom", "default"] = "custom",
    identity: str | None = None,
    user_profile: str | None = None,
    user_profile_strategy: Literal["replace_generated_block"] = "replace_generated_block",
    memory_items: list[dict[str, Any]] | None = None,
    model: str | None = None,
    tool_groups: list[str] | None = None,
) -> Command:
    """Setup or update Nion agent assets (bootstrap only).

    Args:
        soul: SOUL.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does (custom agent only).
        identity: IDENTITY.md content defining the agent's role, responsibilities, and boundaries.
        memory_items: Optional list of memory items to seed into OpenViking (profile/preference tiers).
        model: Optional model name to use for this agent (e.g., "claude-opus-4-6").
        tool_groups: Optional list of tool groups to enable for this agent (e.g., ["default"]).
    """

    if user_profile_strategy != "replace_generated_block":
        return _tool_error(
            "Error: unsupported user_profile_strategy. Only 'replace_generated_block' is supported.",
            runtime,
        )

    if target == "default":
        identity_payload = _normalize_identity(identity)
        if identity_payload is None:
            return _tool_error(
                "Error: missing required 'identity' content. "
                "Bootstrap must generate and pass a non-empty IDENTITY.md (do not rely on silent default templates).",
                runtime,
            )

        normalized_memory_items = _normalize_memory_items(memory_items)

        from src.config.default_agent import DEFAULT_AGENT_NAME, ensure_default_agent

        try:
            # Ensure default agent directory + agent.json exist.
            ensure_default_agent()
            paths = get_paths()
            default_name = DEFAULT_AGENT_NAME

            soul_path = paths.agent_soul_file(default_name)
            soul_path.parent.mkdir(parents=True, exist_ok=True)
            soul_path.write_text(soul, encoding="utf-8")

            identity_path = paths.agent_identity_file(default_name)
            identity_path.parent.mkdir(parents=True, exist_ok=True)
            identity_path.write_text(identity_payload, encoding="utf-8")

            if isinstance(user_profile, str) and user_profile.strip():
                _upsert_user_profile_block(user_md_path=paths.user_md_file, content=user_profile)

            memory_results: list[dict[str, Any]] = []
            memory_errors: list[str] = []
            if normalized_memory_items:
                for idx, item in enumerate(normalized_memory_items, start=1):
                    try:
                        memory_results.append(
                            store_memory_action(
                                content=item["content"],
                                confidence=float(item["confidence"]),
                                scope="global",
                                agent_name=None,
                                runtime_agent_name=None,
                                source="bootstrap",
                                thread_id=_runtime_thread_id(runtime),
                                metadata={"tier": item["tier"]},
                                policy_state=_memory_policy_state(runtime),
                                policy_runtime_context=_memory_policy_runtime_context(runtime),
                            )
                        )
                    except Exception as e:  # noqa: BLE001
                        logger.warning(
                            "[agent_creator] Failed to store default memory item %s: %s",
                            idx,
                            e,
                            exc_info=True,
                        )
                        memory_errors.append(f"{idx}: {e}")

            managed_base = "viking://resources/nion/managed"
            sync_items: list[tuple[Path, str, str | None]] = [
                (soul_path, f"{managed_base}/agents/{default_name}/SOUL.md", None),
                (identity_path, f"{managed_base}/agents/{default_name}/IDENTITY.md", None),
            ]
            config_path = paths.agent_config_file(default_name)
            if config_path.exists():
                sync_items.append((config_path, f"{managed_base}/agents/{default_name}/agent.json", None))
            if isinstance(user_profile, str) and user_profile.strip() and paths.user_md_file.exists():
                sync_items.append((paths.user_md_file, f"{managed_base}/user/USER.md", None))
            sync_warnings = _sync_openviking_managed_resources(items=sync_items)

            logger.info("[agent_creator] Updated default agent assets at %s", paths.agent_dir(default_name))
            message_lines = ["Default agent assets updated successfully!"]
            if memory_errors:
                message_lines.append(
                    f"Warning: memory initialization failed for {len(memory_errors)} item(s): " + "; ".join(memory_errors)
                )
            if sync_warnings:
                message_lines.append(
                    f"Warning: OpenViking resource sync failed for {len(sync_warnings)} item(s): " + "; ".join(sync_warnings)
                )
            return Command(
                update={
                    "updated_agent_name": default_name,
                    "memory_results": memory_results,
                    "messages": [
                        ToolMessage(
                            content="\n".join(message_lines),
                            tool_call_id=runtime.tool_call_id,
                        )
                    ],
                }
            )
        except Exception as e:  # noqa: BLE001
            logger.error("[agent_creator] Failed to update default agent assets: %s", e, exc_info=True)
            return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})

    agent_name: str | None = runtime.context.get("agent_name")
    agent_display_name: str | None = None
    if isinstance(runtime.context, dict):
        agent_display_name = runtime.context.get("agent_display_name") or runtime.context.get("agentDisplayName") or runtime.context.get("display_name") or runtime.context.get("displayName")

    if not agent_name or not str(agent_name).strip():
        return _tool_error(
            "Error: missing required runtime context 'agent_name'. Please pass agent_name in the first bootstrap message context before calling setup_agent.",
            runtime,
        )

    normalized_agent_name = str(agent_name).strip().lower()
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        return _tool_error(
            f"Error: invalid agent_name '{normalized_agent_name}'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).",
            runtime,
        )

    identity_payload = _normalize_identity(identity)
    if identity_payload is None:
        return _tool_error(
            "Error: missing required 'identity' content. "
            "Bootstrap must generate and pass a non-empty IDENTITY.md (do not rely on silent default templates).",
            runtime,
        )

    normalized_memory_items = _normalize_memory_items(memory_items)

    agent_dir = None
    try:
        paths = get_paths()
        agent_dir = paths.agent_dir(normalized_agent_name)
        if agent_dir.exists():
            return _tool_error(
                f"Error: agent '{normalized_agent_name}' already exists. Choose a different agent_name.",
                runtime,
            )

        # Must not clobber existing directory: create atomically and only cleanup
        # if this call created the directory.
        agent_dir.mkdir(parents=True, exist_ok=False)

        # Create agent.json with complete configuration
        config_data: dict = {
            "name": normalized_agent_name,
            "description": description,
            "heartbeat_enabled": True,
            "evolution_enabled": True,
        }
        if agent_display_name and str(agent_display_name).strip():
            config_data["display_name"] = str(agent_display_name).strip()

        # Add optional fields if provided
        if model is not None:
            config_data["model"] = model
        if tool_groups is not None:
            config_data["tool_groups"] = tool_groups

        config_file = paths.agent_config_file(normalized_agent_name)
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        # Create SOUL.md (AI-generated content)
        soul_file = paths.agent_soul_file(normalized_agent_name)
        soul_file.write_text(soul, encoding="utf-8")

        # Create IDENTITY.md (bootstrap must provide non-empty content)
        identity_file = paths.agent_identity_file(normalized_agent_name)
        identity_file.write_text(identity_payload, encoding="utf-8")

        if isinstance(user_profile, str) and user_profile.strip():
            _upsert_user_profile_block(user_md_path=paths.user_md_file, content=user_profile)

        memory_results: list[dict[str, Any]] = []
        memory_errors: list[str] = []
        if normalized_memory_items:
            for idx, item in enumerate(normalized_memory_items, start=1):
                try:
                    memory_results.append(
                        store_memory_action(
                            content=item["content"],
                            confidence=float(item["confidence"]),
                            scope="agent",
                            agent_name=normalized_agent_name,
                            runtime_agent_name=normalized_agent_name,
                            source="bootstrap",
                            thread_id=_runtime_thread_id(runtime),
                            metadata={"tier": item["tier"]},
                            policy_state=_memory_policy_state(runtime),
                            policy_runtime_context=_memory_policy_runtime_context(runtime),
                        )
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[agent_creator] Failed to store agent memory item %s: %s",
                        idx,
                        e,
                        exc_info=True,
                    )
                    memory_errors.append(f"{idx}: {e}")

        managed_base = "viking://resources/nion/managed"
        sync_items: list[tuple[Path, str, str | None]] = [
            (soul_file, f"{managed_base}/agents/{normalized_agent_name}/SOUL.md", normalized_agent_name),
            (identity_file, f"{managed_base}/agents/{normalized_agent_name}/IDENTITY.md", normalized_agent_name),
            (config_file, f"{managed_base}/agents/{normalized_agent_name}/agent.json", normalized_agent_name),
        ]
        if isinstance(user_profile, str) and user_profile.strip() and paths.user_md_file.exists():
            sync_items.append((paths.user_md_file, f"{managed_base}/user/USER.md", None))
        sync_warnings = _sync_openviking_managed_resources(items=sync_items)

        logger.info(f"[agent_creator] Created agent '{normalized_agent_name}' at {agent_dir}")
        message_lines = [f"Agent '{normalized_agent_name}' created successfully!"]
        if memory_errors:
            message_lines.append(
                f"Warning: memory initialization failed for {len(memory_errors)} item(s): " + "; ".join(memory_errors)
            )
        if sync_warnings:
            message_lines.append(
                f"Warning: OpenViking resource sync failed for {len(sync_warnings)} item(s): " + "; ".join(sync_warnings)
            )
        return Command(
            update={
                "created_agent_name": normalized_agent_name,
                "memory_results": memory_results,
                "messages": [ToolMessage(content="\n".join(message_lines), tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:  # noqa: BLE001
        import shutil

        if agent_dir is not None and agent_dir.exists():
            # Safe: we already ensured the directory didn't exist before this tool call.
            shutil.rmtree(agent_dir)
        logger.error(f"[agent_creator] Failed to create agent '{normalized_agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
