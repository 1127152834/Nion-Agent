"""Prompt templates for memory update and injection."""

import re
from datetime import UTC, datetime
from typing import Any

try:
    import tiktoken

    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False

# Prompt template for updating memory based on conversation
MEMORY_UPDATE_PROMPT = """You are a memory management system. Your task is to analyze a conversation and update the user's memory profile.

Current Memory State:
<current_memory>
{current_memory}
</current_memory>

New Conversation to Process:
<conversation>
{conversation}
</conversation>

Instructions:
1. Analyze the conversation for important information about the user
2. Extract relevant facts, preferences, and context with specific details (numbers, names, technologies)
3. Update the memory sections as needed following the detailed length guidelines below

Memory Section Guidelines:

**User Context** (Current state - concise summaries):
- workContext: Professional role, company, key projects, main technologies (2-3 sentences)
  Example: Core contributor, project names with metrics (16k+ stars), technical stack
- personalContext: Languages, communication preferences, key interests (1-2 sentences)
  Example: Bilingual capabilities, specific interest areas, expertise domains
- topOfMind: Multiple ongoing focus areas and priorities (3-5 sentences, detailed paragraph)
  Example: Primary project work, parallel technical investigations, ongoing learning/tracking
  Include: Active implementation work, troubleshooting issues, market/research interests
  Note: This captures SEVERAL concurrent focus areas, not just one task

**History** (Temporal context - rich paragraphs):
- recentMonths: Detailed summary of recent activities (4-6 sentences or 1-2 paragraphs)
  Timeline: Last 1-3 months of interactions
  Include: Technologies explored, projects worked on, problems solved, interests demonstrated
- earlierContext: Important historical patterns (3-5 sentences or 1 paragraph)
  Timeline: 3-12 months ago
  Include: Past projects, learning journeys, established patterns
- longTermBackground: Persistent background and foundational context (2-4 sentences)
  Timeline: Overall/foundational information
  Include: Core expertise, longstanding interests, fundamental working style

**Facts Extraction**:
- Extract specific, quantifiable details (e.g., "16k+ GitHub stars", "200+ datasets")
- Include proper nouns (company names, project names, technology names)
- Preserve technical terminology and version numbers
- Categories:
  * preference: Tools, styles, approaches user prefers/dislikes
  * knowledge: Specific expertise, technologies mastered, domain knowledge
  * context: Background facts (job title, projects, locations, languages)
  * behavior: Working patterns, communication habits, problem-solving approaches
  * goal: Stated objectives, learning targets, project ambitions
- Confidence levels:
  * 0.9-1.0: Explicitly stated facts ("I work on X", "My role is Y")
  * 0.7-0.8: Strongly implied from actions/discussions
  * 0.5-0.6: Inferred patterns (use sparingly, only for clear patterns)

**What Goes Where**:
- workContext: Current job, active projects, primary tech stack
- personalContext: Languages, personality, interests outside direct work tasks
- topOfMind: Multiple ongoing priorities and focus areas user cares about recently (gets updated most frequently)
  Should capture 3-5 concurrent themes: main work, side explorations, learning/tracking interests
- recentMonths: Detailed account of recent technical explorations and work
- earlierContext: Patterns from slightly older interactions still relevant
- longTermBackground: Unchanging foundational facts about the user

**Multilingual Content**:
- Preserve original language for proper nouns and company names
- Keep technical terms in their original form (DeepSeek, LangGraph, etc.)
- Note language capabilities in personalContext

Output Format (JSON):
{{
  "user": {{
    "workContext": {{ "summary": "...", "shouldUpdate": true/false }},
    "personalContext": {{ "summary": "...", "shouldUpdate": true/false }},
    "topOfMind": {{ "summary": "...", "shouldUpdate": true/false }}
  }},
  "history": {{
    "recentMonths": {{ "summary": "...", "shouldUpdate": true/false }},
    "earlierContext": {{ "summary": "...", "shouldUpdate": true/false }},
    "longTermBackground": {{ "summary": "...", "shouldUpdate": true/false }}
  }},
  "newFacts": [
    {{ "content": "...", "category": "preference|knowledge|context|behavior|goal", "confidence": 0.0-1.0 }}
  ],
  "factsToRemove": ["fact_id_1", "fact_id_2"]
}}

Important Rules:
- Only set shouldUpdate=true if there's meaningful new information
- Follow length guidelines: workContext/personalContext are concise (1-3 sentences), topOfMind and history sections are detailed (paragraphs)
- Include specific metrics, version numbers, and proper nouns in facts
- Only add facts that are clearly stated (0.9+) or strongly implied (0.7+)
- Remove facts that are contradicted by new information
- When updating topOfMind, integrate new focus areas while removing completed/abandoned ones
  Keep 3-5 concurrent focus themes that are still active and relevant
- For history sections, integrate new information chronologically into appropriate time period
- Preserve technical accuracy - keep exact names of technologies, companies, projects
- Focus on information useful for future interactions and personalization
- IMPORTANT: Do NOT record file upload events in memory. Uploaded files are
  session-specific and ephemeral — they will not be accessible in future sessions.
  Recording upload events causes confusion in subsequent conversations.

Return ONLY one valid JSON object. Start with `{{` and end with `}}`. Use double quotes for keys and strings. Do NOT wrap the response in markdown fences. Do NOT add any explanation, prefix, suffix, or commentary."""


# Prompt template for extracting facts from a single message
FACT_EXTRACTION_PROMPT = """Extract factual information about the user from this message.

Message:
{message}

Extract facts in this JSON format:
{{
  "facts": [
    {{ "content": "...", "category": "preference|knowledge|context|behavior|goal", "confidence": 0.0-1.0 }}
  ]
}}

Categories:
- preference: User preferences (likes/dislikes, styles, tools)
- knowledge: User's expertise or knowledge areas
- context: Background context (location, job, projects)
- behavior: Behavioral patterns
- goal: User's goals or objectives

Rules:
- Only extract clear, specific facts
- Confidence should reflect certainty (explicit statement = 0.9+, implied = 0.6-0.8)
- Skip vague or temporary information

Return ONLY valid JSON."""


def _count_tokens(text: str, encoding_name: str = "cl100k_base") -> int:
    """Count tokens in text using tiktoken.

    Args:
        text: The text to count tokens for.
        encoding_name: The encoding to use (default: cl100k_base for GPT-4/3.5).

    Returns:
        The number of tokens in the text.
    """
    if not TIKTOKEN_AVAILABLE:
        # Fallback to character-based estimation if tiktoken is not available
        return len(text) // 4

    try:
        encoding = tiktoken.get_encoding(encoding_name)
        return len(encoding.encode(text))
    except Exception:
        # Fallback to character-based estimation on error
        return len(text) // 4


def _parse_iso(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC)
    except Exception:  # noqa: BLE001
        return None


def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
    """Format memory data for injection into system prompt.

    Args:
        memory_data: The memory data dictionary.
        max_tokens: Maximum tokens to use (counted via tiktoken for accuracy).

    Returns:
        Formatted memory string for system prompt injection.
    """
    if not memory_data:
        return ""

    facts_raw = memory_data.get("facts") or []
    if not isinstance(facts_raw, list):
        return ""

    now = datetime.now(UTC)
    profile_items: list[dict[str, Any]] = []
    preference_items: list[dict[str, Any]] = []
    episode_items: list[dict[str, Any]] = []

    for fact in facts_raw:
        if not isinstance(fact, dict):
            continue
        text = str(fact.get("content") or "").strip()
        if not text:
            continue
        status = str(fact.get("status") or "active").strip().lower()
        if status != "active":
            continue
        tier = str(fact.get("tier") or "").strip().lower() or "episode"
        if tier == "trace":
            continue
        expires_at = str(fact.get("expires_at") or "").strip()
        expires_at_dt = _parse_iso(expires_at)
        if expires_at_dt is not None and expires_at_dt <= now:
            continue

        quality = float(fact.get("quality_score") or fact.get("confidence") or 0.0)
        updated_at = str(fact.get("updatedAt") or fact.get("createdAt") or "")
        record = {
            "text": text,
            "quality": quality,
            "updated_at": updated_at,
        }

        if tier == "profile":
            profile_items.append(record)
        elif tier == "preference":
            preference_items.append(record)
        else:
            episode_items.append(record)

    def _sort_key(item: dict[str, Any]) -> tuple[float, str]:
        return (float(item.get("quality") or 0.0), str(item.get("updated_at") or ""))

    def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for item in items:
            text = str(item.get("text") or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            out.append(item)
        return out

    profile_items = _dedupe(sorted(profile_items, key=_sort_key, reverse=True))[:12]
    preference_items = _dedupe(sorted(preference_items, key=_sort_key, reverse=True))[:12]
    # Episodes are high-cardinality; keep only top-N by quality.
    episode_items = _dedupe(sorted(episode_items, key=_sort_key, reverse=True))[:5]

    sections: list[str] = []

    if profile_items:
        sections.append("Profile:\n" + "\n".join(f"- {item['text']}" for item in profile_items))
    if preference_items:
        sections.append("Preference:\n" + "\n".join(f"- {item['text']}" for item in preference_items))

    base = "\n\n".join(sections).strip()
    if not base:
        if not episode_items:
            return ""
        episode_only = "Episodes:\n" + "\n".join(f"- {item['text']}" for item in episode_items)
        if _count_tokens(episode_only) <= max_tokens:
            return episode_only
        token_count = _count_tokens(episode_only)
        if token_count <= 0:
            return episode_only[: max(0, int(max_tokens) * 4)]
        char_per_token = len(episode_only) / token_count
        target_chars = int(max_tokens * char_per_token * 0.95)
        return episode_only[:target_chars] + "\n..."

    # Episodes are optional and should never crowd out Profile/Preference.
    if episode_items:
        episode_section = "Episodes:\n" + "\n".join(f"- {item['text']}" for item in episode_items)
        candidate = f"{base}\n\n{episode_section}"
    else:
        candidate = base

    if _count_tokens(candidate) <= max_tokens:
        return candidate

    # Over budget: drop Episodes first.
    if _count_tokens(base) <= max_tokens:
        return base

    # Still over budget: hard-truncate while preserving Profile/Preference structure.
    token_count = _count_tokens(base)
    if token_count <= 0:
        return base[: max(0, int(max_tokens) * 4)]
    char_per_token = len(base) / token_count
    target_chars = int(max_tokens * char_per_token * 0.95)
    return base[:target_chars] + "\n..."


def format_conversation_for_update(messages: list[Any]) -> str:
    """Format conversation messages for memory update prompt.

    Args:
        messages: List of conversation messages.

    Returns:
        Formatted conversation string.
    """
    lines = []
    for msg in messages:
        role = getattr(msg, "type", "unknown")
        content = getattr(msg, "content", str(msg))

        # Handle content that might be a list (multimodal)
        if isinstance(content, list):
            text_parts = [p.get("text", "") for p in content if isinstance(p, dict) and "text" in p]
            content = " ".join(text_parts) if text_parts else str(content)

        # Strip uploaded_files tags from human messages to avoid persisting
        # ephemeral file path info into long-term memory.  Skip the turn entirely
        # when nothing remains after stripping (upload-only message).
        if role == "human":
            content = re.sub(r"<uploaded_files>[\s\S]*?</uploaded_files>\n*", "", str(content)).strip()
            if not content:
                continue

        # Truncate very long messages
        if len(str(content)) > 1000:
            content = str(content)[:1000] + "..."

        if role == "human":
            lines.append(f"User: {content}")
        elif role == "ai":
            lines.append(f"Assistant: {content}")

    return "\n\n".join(lines)
