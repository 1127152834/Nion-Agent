"""Builtin tool exports with lazy loading."""

from __future__ import annotations

from importlib import import_module

_EXPORT_MAP: dict[str, tuple[str, str]] = {
    "setup_agent": (".setup_agent_tool", "setup_agent"),
    "present_file_tool": (".present_file_tool", "present_file_tool"),
    "ask_clarification_tool": (".clarification_tool", "ask_clarification_tool"),
    "view_image_tool": (".view_image_tool", "view_image_tool"),
    "task_tool": (".task_tool", "task_tool"),
    "scheduler_create_task_tool": (".scheduler_manage_tools", "scheduler_create_task_tool"),
    "scheduler_operate_task_tool": (".scheduler_manage_tools", "scheduler_operate_task_tool"),
    "memory_query_tool": (".memory_manage_tools", "memory_query_tool"),
    "search_memory_tool": (".memory_manage_tools", "search_memory_tool"),
    "query_history_tool": (".memory_manage_tools", "query_history_tool"),
    "memory_store_tool": (".memory_manage_tools", "memory_store_tool"),
    "memory_compact_tool": (".memory_manage_tools", "memory_compact_tool"),
    "memory_forget_tool": (".memory_manage_tools", "memory_forget_tool"),
    "ov_find_tool": (".memory_manage_tools", "ov_find_tool"),
    "ov_search_tool": (".memory_manage_tools", "ov_search_tool"),
    "ov_session_commit_tool": (".memory_manage_tools", "ov_session_commit_tool"),
    "skills_manage_tool": (".system_manage_tools", "skills_manage_tool"),
    "mcp_manage_tool": (".system_manage_tools", "mcp_manage_tool"),
    "models_manage_tool": (".system_manage_tools", "models_manage_tool"),
}

__all__ = [
    "setup_agent",
    "present_file_tool",
    "ask_clarification_tool",
    "view_image_tool",
    "task_tool",
    "scheduler_create_task_tool",
    "scheduler_operate_task_tool",
    "memory_query_tool",
    "search_memory_tool",
    "query_history_tool",
    "memory_store_tool",
    "memory_compact_tool",
    "memory_forget_tool",
    "ov_find_tool",
    "ov_search_tool",
    "ov_session_commit_tool",
    "skills_manage_tool",
    "mcp_manage_tool",
    "models_manage_tool",
]


def __getattr__(name: str):
    if name not in _EXPORT_MAP:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    module_name, attr_name = _EXPORT_MAP[name]
    module = import_module(module_name, package=__name__)
    value = getattr(module, attr_name)
    globals()[name] = value
    return value
