from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.middlewares.internal_tool_recall_middleware import InternalToolRecallMiddleware
from src.tools.internal_tool_recall import InternalToolHit


def test_internal_tool_recall_middleware_injects_system_message(monkeypatch):
    mw = InternalToolRecallMiddleware(limit=3)

    # Avoid coupling this unit test to the global model configuration.
    monkeypatch.setattr(mw, "_is_anthropic_compatible_model", lambda _runtime: False)

    monkeypatch.setattr(
        "src.agents.middlewares.internal_tool_recall_middleware.recommend_internal_tools",
        lambda _query, limit: [
            InternalToolHit(
                tool_type="cli",
                tool_id="xhs-cli",
                score=123,
                why="matched xhs",
                example_call='cli_xhs-cli argv=["login"]',
            )
        ][:limit],
    )

    state = {"messages": [HumanMessage(content="我要登录小红书")]}
    runtime = type("R", (), {"context": {"model_name": "gpt-4"}})()

    out = mw.before_model(state, runtime)
    assert out is not None
    assert "messages" in out
    assert isinstance(out["messages"][0], SystemMessage)
    assert "xhs-cli" in out["messages"][0].content


def test_internal_tool_recall_middleware_dedupes_by_query_hash(monkeypatch):
    mw = InternalToolRecallMiddleware(limit=3)
    monkeypatch.setattr(mw, "_is_anthropic_compatible_model", lambda _runtime: False)

    monkeypatch.setattr(
        "src.agents.middlewares.internal_tool_recall_middleware.recommend_internal_tools",
        lambda *_args, **_kwargs: [
            InternalToolHit(
                tool_type="cli",
                tool_id="xhs-cli",
                score=1,
                why="xhs",
                example_call='cli_xhs-cli argv=["login"]',
            )
        ],
    )

    query = "我要登录小红书"
    runtime = type("R", (), {"context": {"model_name": "gpt-4"}})()

    first = mw.before_model({"messages": [HumanMessage(content=query)]}, runtime)
    assert first is not None

    injected = first["messages"][0].content
    second = mw.before_model(
        {"messages": [HumanMessage(content=query), SystemMessage(content=injected)]},
        runtime,
    )
    assert second is None
