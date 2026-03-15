import logging

from langchain.tools import BaseTool

from src.config.app_config import ensure_latest_app_config
from src.reflection import resolve_variable
from src.tools.policy import filter_tools_by_policy
from src.tools.builtins import (
    ask_clarification_tool,
    mcp_manage_tool,
    memory_compact_tool,
    memory_forget_tool,
    memory_query_tool,
    memory_store_tool,
    models_manage_tool,
    ov_find_tool,
    ov_search_tool,
    ov_session_commit_tool,
    present_file_tool,
    query_history_tool,
    send_a2ui_json_to_client_tool,
    scheduler_create_task_tool,
    scheduler_operate_task_tool,
    search_memory_tool,
    skills_manage_tool,
    task_tool,
    view_image_tool,
)

logger = logging.getLogger(__name__)

DEFAULT_WEB_SEARCH_TOOL_USE = "src.community.web_search.tools:web_search_tool"
DEFAULT_WEB_FETCH_TOOL_USE = "src.community.web_fetch.tools:web_fetch_tool"

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
    send_a2ui_json_to_client_tool,
    memory_query_tool,
    search_memory_tool,
    memory_store_tool,
    memory_compact_tool,
    memory_forget_tool,
    scheduler_create_task_tool,
    scheduler_operate_task_tool,
    query_history_tool,
    ov_find_tool,
    ov_search_tool,
    ov_session_commit_tool,
    skills_manage_tool,
    mcp_manage_tool,
    models_manage_tool,
]

SUBAGENT_TOOLS = [
    task_tool,
    # task_status_tool is no longer exposed to LLM (backend handles polling internally)
]


def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
    agent_name: str | None = None,
) -> list[BaseTool]:
    """Get all available tools from config.

    Note: MCP tools should be initialized at application startup using
    `initialize_mcp_tools()` from src.mcp module.

    Args:
        groups: Optional list of tool groups to filter by.
        include_mcp: Whether to include tools from MCP servers (default: True).
        model_name: Optional model name to determine if vision tools should be included.
        subagent_enabled: Whether to include subagent tools (task, task_status).

    Returns:
        List of available tools.
    """
    config = ensure_latest_app_config(process_name="langgraph")
    scoped_tools = [tool for tool in config.tools if groups is None or tool.group in groups]
    loaded_tools: list[BaseTool] = []
    for tool in scoped_tools:
        resolved_use = tool.use
        if tool.name == "web_search" and tool.use != DEFAULT_WEB_SEARCH_TOOL_USE:
            resolved_use = DEFAULT_WEB_SEARCH_TOOL_USE
            logger.info("web_search provider remapped to unified fallback implementation")
        if tool.name == "web_fetch" and tool.use != DEFAULT_WEB_FETCH_TOOL_USE:
            resolved_use = DEFAULT_WEB_FETCH_TOOL_USE
            logger.info("web_fetch provider remapped to unified fallback implementation")
        loaded_tools.append(resolve_variable(resolved_use, BaseTool))

    web_group_enabled = groups is None or "web" in groups
    has_web_search = any(tool.name == "web_search" for tool in scoped_tools)
    if web_group_enabled and not has_web_search:
        try:
            loaded_tools.append(resolve_variable(DEFAULT_WEB_SEARCH_TOOL_USE, BaseTool))
            logger.info("web_search not configured; injected default fallback web_search tool")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to inject fallback web_search tool: %s", exc)

    # Get cached MCP tools if enabled
    # NOTE: We use ExtensionsConfig.from_file() instead of config.extensions
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when loading MCP tools.
    mcp_tools = []
    if include_mcp:
        try:
            from src.config.extensions_config import ExtensionsConfig
            from src.mcp.cache import get_cached_mcp_tools

            extensions_config = ExtensionsConfig.from_file()
            if extensions_config.get_enabled_mcp_servers():
                mcp_tools = get_cached_mcp_tools()
                if mcp_tools:
                    logger.info(f"Using {len(mcp_tools)} cached MCP tool(s)")
        except ImportError:
            logger.warning("MCP module not available. Install 'langchain-mcp-adapters' package to enable MCP tools.")
        except Exception as e:
            logger.error(f"Failed to get cached MCP tools: {e}")

    # Conditionally add tools based on config
    builtin_tools = BUILTIN_TOOLS.copy()

    # A2UI is a user-facing UX capability. If globally disabled via Config Center,
    # do NOT expose `send_a2ui_json_to_client` to the model. This prevents tool-call
    # attempts and keeps the interaction purely text-based.
    try:
        a2ui_enabled = bool(getattr(getattr(config, "a2ui", None), "enabled", True))
    except Exception:  # noqa: BLE001
        a2ui_enabled = True
    if not a2ui_enabled:
        builtin_tools = [
            tool
            for tool in builtin_tools
            if getattr(tool, "name", None) != "send_a2ui_json_to_client"
        ]
        logger.info("A2UI is disabled by config; removed send_a2ui_json_to_client tool from available tools")

    # Add subagent tools only if enabled via runtime parameter
    if subagent_enabled:
        builtin_tools.extend(SUBAGENT_TOOLS)
        logger.info("Including subagent tools (task)")

    # If no model_name specified, use the first model (default)
    if model_name is None and config.models:
        model_name = config.models[0].name

    # Add view_image_tool only if the model supports vision
    model_config = config.get_model_config(model_name) if model_name else None
    if model_config is not None and model_config.supports_vision:
        builtin_tools.append(view_image_tool)
        logger.info(f"Including view_image_tool for model '{model_name}' (supports_vision=True)")

    all_tools = loaded_tools + builtin_tools + mcp_tools
    try:
        from src.cli.runtime_tools import get_cli_tools

        all_tools.extend(get_cli_tools(agent_name=agent_name))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load CLI tools: %s", exc)
    return [tool for tool in filter_tools_by_policy(agent_name, all_tools) if isinstance(tool, BaseTool)]
