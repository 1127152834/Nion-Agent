import logging

import yaml
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths

logger = logging.getLogger(__name__)


@tool
def setup_agent(
    soul: str,
    description: str,
    runtime: ToolRuntime,
) -> Command:
    """Setup the custom Nion agent.

    Args:
        soul: Full SOUL.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does.
    """

    agent_name: str | None = runtime.context.get("agent_name")

    if not agent_name or not str(agent_name).strip():
        message = (
            "Error: missing required runtime context 'agent_name'. "
            "Please pass agent_name in the first bootstrap message context before calling setup_agent."
        )
        logger.error("[agent_creator] %s", message)
        return Command(update={"messages": [ToolMessage(content=message, tool_call_id=runtime.tool_call_id)]})

    agent_dir = None
    try:
        paths = get_paths()
        agent_dir = paths.agent_dir(agent_name)
        agent_dir.mkdir(parents=True, exist_ok=True)

        # If agent_name is provided, we are creating a custom agent in the agents/ directory
        config_data: dict = {"name": agent_name}
        if description:
            config_data["description"] = description

        config_file = agent_dir / "config.yaml"
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)

        soul_file = agent_dir / "SOUL.md"
        soul_file.write_text(soul, encoding="utf-8")

        logger.info(f"[agent_creator] Created agent '{agent_name}' at {agent_dir}")
        return Command(
            update={
                "created_agent_name": agent_name,
                "messages": [ToolMessage(content=f"Agent '{agent_name}' created successfully!", tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:
        import shutil

        if agent_dir is not None and agent_dir.exists():
            # Cleanup the custom agent directory only if it was created but an error occurred during setup
            shutil.rmtree(agent_dir)
        logger.error(f"[agent_creator] Failed to create agent '{agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
