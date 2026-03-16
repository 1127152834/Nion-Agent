"""Compatibility wrappers for different langchain middleware APIs."""

from __future__ import annotations

try:
    from langchain.agents import AgentState as AgentState  # type: ignore
except Exception:  # noqa: BLE001

    class AgentState(dict):  # type: ignore[no-redef]
        pass


try:
    from langchain.agents.middleware import AgentMiddleware as AgentMiddleware  # type: ignore
except Exception:  # noqa: BLE001

    class AgentMiddleware[StateT]:  # type: ignore[no-redef]
        state_schema = dict

        @classmethod
        def __class_getitem__(cls, item):
            return cls

        def __init__(self, *args, **kwargs):
            _ = args, kwargs
