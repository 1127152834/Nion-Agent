import json
import logging
import re

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.langchain_compat import ToolRuntime

logger = logging.getLogger(__name__)
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


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


@tool
def setup_agent(
    soul: str,
    description: str,
    # NOTE:
    # runtime is injected by LangGraph and must remain a required positional
    # parameter. Put it before optional params to keep Python signature valid.
    runtime: ToolRuntime,
    model: str | None = None,
    tool_groups: list[str] | None = None,
) -> Command:
    """Setup the custom Nion agent.

    Args:
        soul: Full SOUL.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does.
        model: Optional model name to use for this agent (e.g., "claude-opus-4-6").
        tool_groups: Optional list of tool groups to enable for this agent (e.g., ["default"]).
    """

    agent_name: str | None = runtime.context.get("agent_name")
    agent_display_name: str | None = (
        runtime.context.get("agent_display_name")
        or runtime.context.get("agentDisplayName")
        or runtime.context.get("display_name")
        or runtime.context.get("displayName")
    )

    if not agent_name or not str(agent_name).strip():
        message = (
            "Error: missing required runtime context 'agent_name'. "
            "Please pass agent_name in the first bootstrap message context before calling setup_agent."
        )
        logger.error("[agent_creator] %s", message)
        return Command(update={"messages": [ToolMessage(content=message, tool_call_id=runtime.tool_call_id)]})

    normalized_agent_name = str(agent_name).strip().lower()
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        message = (
            f"Error: invalid agent_name '{normalized_agent_name}'. "
            "Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only)."
        )
        logger.error("[agent_creator] %s", message)
        return Command(update={"messages": [ToolMessage(content=message, tool_call_id=runtime.tool_call_id)]})

    agent_dir = None
    try:
        paths = get_paths()
        agent_dir = paths.agent_dir(normalized_agent_name)
        agent_dir.mkdir(parents=True, exist_ok=True)

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

        # Create IDENTITY.md (default template)
        identity_file = paths.agent_identity_file(normalized_agent_name)
        identity_file.write_text(DEFAULT_IDENTITY_CONTENT.strip(), encoding="utf-8")

        logger.info(f"[agent_creator] Created agent '{normalized_agent_name}' at {agent_dir}")
        return Command(
            update={
                "created_agent_name": normalized_agent_name,
                "messages": [ToolMessage(content=f"Agent '{normalized_agent_name}' created successfully!", tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:
        import shutil

        if agent_dir is not None and agent_dir.exists():
            # Cleanup the custom agent directory only if it was created but an error occurred during setup
            shutil.rmtree(agent_dir)
        logger.error(f"[agent_creator] Failed to create agent '{normalized_agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
