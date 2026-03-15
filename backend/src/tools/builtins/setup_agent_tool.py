import json
import logging
import re
from pathlib import Path
from typing import Literal

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.langchain_compat import ToolRuntime

logger = logging.getLogger(__name__)
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")

USER_PROFILE_MARKER_START = "<!-- nion:bootstrap:user_profile:start -->"
USER_PROFILE_MARKER_END = "<!-- nion:bootstrap:user_profile:end -->"


DEFAULT_IDENTITY_CONTENT = """# Agent Identity

## Role
You are a helpful AI assistant focused on assisting users with their tasks.

## Personality Traits
- Professional and focused
- Patient and thorough
- Adaptable to user needs
- Proactive in problem-solving

## Values
- Quality and accuracy
- User autonomy and consent
- Transparency in actions
- Continuous improvement
"""


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
        merged = (
            before
            + ("\n\n" if before else "")
            + block.strip("\n")
            + ("\n\n" if after else "\n")
            + after
        )
        user_md_path.write_text(merged, encoding="utf-8")
        return

    # No marker block found: append without destroying existing manual content.
    merged = raw.rstrip("\n") + "\n\n" + block
    user_md_path.write_text(merged, encoding="utf-8")


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
    model: str | None = None,
    tool_groups: list[str] | None = None,
) -> Command:
    """Setup or update Nion agent assets (bootstrap only).

    Args:
        soul: SOUL.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does (custom agent only).
        model: Optional model name to use for this agent (e.g., "claude-opus-4-6").
        tool_groups: Optional list of tool groups to enable for this agent (e.g., ["default"]).
    """

    if user_profile_strategy != "replace_generated_block":
        return _tool_error(
            "Error: unsupported user_profile_strategy. Only 'replace_generated_block' is supported.",
            runtime,
        )

    if target == "default":
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
            identity_payload = identity.strip() if isinstance(identity, str) and identity.strip() else DEFAULT_IDENTITY_CONTENT.strip()
            identity_path.write_text(identity_payload, encoding="utf-8")

            if isinstance(user_profile, str) and user_profile.strip():
                _upsert_user_profile_block(user_md_path=paths.user_md_file, content=user_profile)

            logger.info("[agent_creator] Updated default agent assets at %s", paths.agent_dir(default_name))
            return Command(
                update={
                    "updated_agent_name": default_name,
                    "messages": [
                        ToolMessage(
                            content="Default agent assets updated successfully!",
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
        agent_display_name = (
            runtime.context.get("agent_display_name")
            or runtime.context.get("agentDisplayName")
            or runtime.context.get("display_name")
            or runtime.context.get("displayName")
        )

    if not agent_name or not str(agent_name).strip():
        return _tool_error(
            "Error: missing required runtime context 'agent_name'. "
            "Please pass agent_name in the first bootstrap message context before calling setup_agent.",
            runtime,
        )

    normalized_agent_name = str(agent_name).strip().lower()
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        return _tool_error(
            f"Error: invalid agent_name '{normalized_agent_name}'. "
            "Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).",
            runtime,
        )

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

        # Create IDENTITY.md (custom content or default template)
        identity_file = paths.agent_identity_file(normalized_agent_name)
        identity_payload = identity.strip() if isinstance(identity, str) and identity.strip() else DEFAULT_IDENTITY_CONTENT.strip()
        identity_file.write_text(identity_payload, encoding="utf-8")

        if isinstance(user_profile, str) and user_profile.strip():
            _upsert_user_profile_block(user_md_path=paths.user_md_file, content=user_profile)

        logger.info(f"[agent_creator] Created agent '{normalized_agent_name}' at {agent_dir}")
        return Command(
            update={
                "created_agent_name": normalized_agent_name,
                "messages": [ToolMessage(content=f"Agent '{normalized_agent_name}' created successfully!", tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:  # noqa: BLE001
        import shutil

        if agent_dir is not None and agent_dir.exists():
            # Safe: we already ensured the directory didn't exist before this tool call.
            shutil.rmtree(agent_dir)
        logger.error(f"[agent_creator] Failed to create agent '{normalized_agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
