"""Lead-agent package exports with lazy import compatibility."""


def make_lead_agent(*args, **kwargs):
    """Lazy proxy to avoid importing heavy langchain agent stack during module import."""
    from .agent import make_lead_agent as _make_lead_agent

    return _make_lead_agent(*args, **kwargs)


__all__ = ["make_lead_agent"]
