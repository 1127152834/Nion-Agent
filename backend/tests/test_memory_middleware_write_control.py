"""Tests for runtime memory write control in MemoryMiddleware."""

import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import langchain.agents as langchain_agents
from langchain_core.messages import AIMessage, HumanMessage

BACKEND_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = BACKEND_DIR / "src"
AGENTS_DIR = SRC_DIR / "agents"
MEMORY_DIR = AGENTS_DIR / "memory"
MIDDLEWARES_DIR = AGENTS_DIR / "middlewares"


def _ensure_namespace_pkg(name: str, path: Path) -> None:
    module = sys.modules.get(name)
    if module is None:
        module = types.ModuleType(name)
        module.__path__ = [str(path)]  # type: ignore[attr-defined]
        sys.modules[name] = module


def _load_module(module_name: str, module_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


if not hasattr(langchain_agents, "create_agent"):
    langchain_agents.create_agent = MagicMock()  # type: ignore[attr-defined]
if not hasattr(langchain_agents, "AgentState"):
    langchain_agents.AgentState = dict  # type: ignore[attr-defined]
if "langchain.agents.middleware" not in sys.modules:
    middleware_module = types.ModuleType("langchain.agents.middleware")

    class AgentMiddleware:
        def __class_getitem__(cls, _item):
            return cls

        def __init__(self, *_args, **_kwargs):
            pass

    middleware_module.AgentMiddleware = AgentMiddleware
    middleware_module.SummarizationMiddleware = object
    middleware_module.TodoListMiddleware = object
    sys.modules["langchain.agents.middleware"] = middleware_module

_ensure_namespace_pkg("src.agents", AGENTS_DIR)
_ensure_namespace_pkg("src.agents.memory", MEMORY_DIR)
_ensure_namespace_pkg("src.agents.middlewares", MIDDLEWARES_DIR)

queue_module = types.ModuleType("src.agents.memory.queue")
queue_module.get_memory_queue = lambda: None  # type: ignore[assignment]
sys.modules["src.agents.memory.queue"] = queue_module

memory_middleware_module = _load_module(
    "test_memory_middleware_module",
    MIDDLEWARES_DIR / "memory_middleware.py",
)
MemoryMiddleware = memory_middleware_module.MemoryMiddleware


def _runtime_with_context(context: dict):
    return SimpleNamespace(context=context)


def test_memory_write_disabled_skips_queue() -> None:
    middleware = MemoryMiddleware()
    state = {
        "messages": [
            HumanMessage(content="你好"),
            AIMessage(content="你好！"),
        ]
    }
    queue = MagicMock()

    with patch(
        f"{memory_middleware_module.__name__}.get_memory_config",
        return_value=SimpleNamespace(enabled=True),
    ):
        with patch(
            f"{memory_middleware_module.__name__}.get_memory_queue",
            return_value=queue,
        ):
            middleware.after_agent(
                state=state,
                runtime=_runtime_with_context(
                    {
                        "thread_id": "thread-1",
                        "memory_write": False,
                    }
                ),
            )

    queue.add.assert_not_called()


def test_memory_write_enabled_still_enqueues() -> None:
    middleware = MemoryMiddleware()
    state = {
        "messages": [
            HumanMessage(content="请记录这条信息"),
            AIMessage(content="已记录"),
        ]
    }
    queue = MagicMock()

    with patch(
        f"{memory_middleware_module.__name__}.get_memory_config",
        return_value=SimpleNamespace(enabled=True),
    ):
        with patch(
            f"{memory_middleware_module.__name__}.get_memory_queue",
            return_value=queue,
        ):
            middleware.after_agent(
                state=state,
                runtime=_runtime_with_context(
                    {
                        "thread_id": "thread-2",
                        "memory_write": True,
                    }
                ),
            )

    queue.add.assert_called_once()
    kwargs = queue.add.call_args.kwargs
    assert kwargs["thread_id"] == "thread-2"
    assert kwargs["agent_name"] is None
