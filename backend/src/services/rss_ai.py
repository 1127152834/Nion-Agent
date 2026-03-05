"""AI helpers for RSS entry summarization and translation."""

from src.models import create_chat_model


def _truncate(content: str, max_chars: int = 12000) -> str:
    text = content.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def _invoke_model(prompt: str) -> str | None:
    try:
        model = create_chat_model(thinking_enabled=False)
        response = model.invoke(prompt)
        text = str(response.content).strip()
        return text or None
    except Exception:
        return None


def summarize_entry_content(*, title: str, content: str) -> str:
    body = _truncate(content)
    prompt = (
        "You are an RSS assistant. Summarize the article in concise Chinese.\n"
        "Keep factual accuracy and include key arguments in bullet points.\n\n"
        f"Title: {title}\n\n"
        f"Content:\n{body}"
    )
    return _invoke_model(prompt) or body[:400]


def translate_entry_content(*, content: str, target_language: str) -> str:
    body = _truncate(content)
    language = target_language.strip() or "zh-cn"
    prompt = (
        "You are an RSS assistant. Translate the article content faithfully.\n"
        "Preserve technical terms and proper nouns.\n\n"
        f"Target language: {language}\n\n"
        f"Content:\n{body}"
    )
    return _invoke_model(prompt) or body
