"""AI helpers for RSS entry summarization and translation."""

from src.models import create_chat_model


def _truncate(content: str, max_chars: int = 12000) -> str:
    text = content.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def summarize_entry_content(*, title: str, content: str) -> str:
    body = _truncate(content)
    model = create_chat_model(thinking_enabled=False)
    prompt = (
        "You are an RSS assistant. Summarize the article in concise Chinese.\n"
        "Keep factual accuracy and include key arguments in bullet points.\n\n"
        f"Title: {title}\n\n"
        f"Content:\n{body}"
    )
    try:
        response = model.invoke(prompt)
        text = str(response.content).strip()
        return text if text else body[:400]
    except Exception:
        return body[:400]


def translate_entry_content(*, content: str, target_language: str) -> str:
    body = _truncate(content)
    language = target_language.strip() or "zh-cn"
    model = create_chat_model(thinking_enabled=False)
    prompt = (
        "You are an RSS assistant. Translate the article content faithfully.\n"
        "Preserve technical terms and proper nouns.\n\n"
        f"Target language: {language}\n\n"
        f"Content:\n{body}"
    )
    try:
        response = model.invoke(prompt)
        text = str(response.content).strip()
        return text if text else body
    except Exception:
        return body
