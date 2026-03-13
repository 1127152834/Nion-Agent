"""Lead-agent package exports with lazy import compatibility."""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig


def make_lead_agent(config: RunnableConfig):
    """Lazy proxy to avoid importing heavy langchain agent stack during module import."""
    from .agent import make_lead_agent as _make_lead_agent

    return _make_lead_agent(config)


__all__ = ["make_lead_agent"]
