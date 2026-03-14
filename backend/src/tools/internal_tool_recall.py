from __future__ import annotations

from dataclasses import dataclass

from src.cli.catalog import load_cli_catalog
from src.config.extensions_config import ExtensionsConfig


@dataclass(frozen=True)
class InternalToolHit:
    tool_type: str  # "cli" | "mcp" | "skill" (v1 only uses cli)
    tool_id: str
    score: int
    why: str
    example_call: str


def _normalize(text: str) -> str:
    return (text or "").strip().lower()


def _contains_any(haystack: str, needles: list[str]) -> bool:
    return any(n for n in needles if n and n in haystack)


def _example_call_for_cli(tool_id: str, query: str) -> str:
    if tool_id == "xhs-cli" and ("登录" in query or "login" in query.lower()):
        return 'cli_xhs-cli argv=["login"]'
    return f'cli_{tool_id} argv=["--help"]'


def recommend_internal_tools(query: str, limit: int = 5) -> list[InternalToolHit]:
    """
    Deterministically recommend internal tools (CLI/MCP/skills) for a user query.

    v1 scope:
    - Only recommends enabled CLI tools from extensions_config.json.
    - Uses lightweight keyword scoring (no embeddings, no extra dependencies).
    """
    q_raw = (query or "").strip()
    if not q_raw:
        return []

    q = _normalize(q_raw)
    config = ExtensionsConfig.from_file()
    enabled_clis = [
        tool_id
        for tool_id, cfg in (config.clis or {}).items()
        if getattr(cfg, "enabled", False)
    ]
    if not enabled_clis:
        return []

    catalog = load_cli_catalog()
    tool_defs = {
        t.get("id"): t
        for t in catalog.get("tools", [])
        if isinstance(t, dict) and isinstance(t.get("id"), str)
    }

    hits: list[InternalToolHit] = []
    for tool_id in enabled_clis:
        tool_def = tool_defs.get(tool_id) or {}
        tags = tool_def.get("tags") if isinstance(tool_def.get("tags"), list) else []

        blob = " ".join(
            [
                _normalize(str(tool_id)),
                _normalize(str(tool_def.get("name") or "")),
                _normalize(str(tool_def.get("description") or "")),
                " ".join(_normalize(str(t)) for t in tags if isinstance(t, str)),
            ]
        ).strip()

        score = 0
        why_parts: list[str] = []

        if tool_id.lower() in q:
            score += 10
            why_parts.append("query 直接提到了工具 id")

        # Tiny bilingual hints for common products.
        if "小红书" in q_raw and _contains_any(blob, ["xhs", "xiaohongshu", "小红书"]):
            score += 20
            why_parts.append("query 提到小红书且工具标签/描述包含 xhs/xiaohongshu")

        if "视频" in q_raw and _contains_any(blob, ["video", "ffmpeg"]):
            score += 8
            why_parts.append("query 提到视频且工具描述包含 video/ffmpeg")

        for tag in tags:
            if isinstance(tag, str) and tag.lower() in q:
                score += 3
                why_parts.append(f"query 命中 tag={tag}")

        if score <= 0:
            continue

        hits.append(
            InternalToolHit(
                tool_type="cli",
                tool_id=tool_id,
                score=score,
                why="; ".join(why_parts) if why_parts else "keyword match",
                example_call=_example_call_for_cli(tool_id, q_raw),
            )
        )

    hits.sort(key=lambda item: item.score, reverse=True)
    return hits[: max(0, int(limit or 0))]

