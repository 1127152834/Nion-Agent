"""Middleware for automatic thread title generation."""

from typing import NotRequired, override

from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState
from langgraph.runtime import Runtime

from src.config.title_config import get_title_config
from src.models import create_chat_model


class TitleMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    title: NotRequired[str | None]


class TitleMiddleware(AgentMiddleware[TitleMiddlewareState]):
    """Automatically generate a title for the thread after the first user message."""

    state_schema = TitleMiddlewareState

    def _should_generate_title(self, state: TitleMiddlewareState) -> bool:
        """Check if we should generate a title for this thread."""
        config = get_title_config()
        if not config.enabled:
            return False

        # Check if thread already has a title in state
        if state.get("title"):
            return False

        # Check if this is the first turn (has at least one user message and one assistant response)
        messages = state.get("messages", [])
        if len(messages) < 2:
            return False

        # Count user and assistant messages
        user_messages = [m for m in messages if m.type == "human"]
        assistant_messages = [m for m in messages if m.type == "ai"]

        # Generate title after first complete exchange
        return len(user_messages) == 1 and len(assistant_messages) >= 1

    @staticmethod
    def _extract_message_text(message) -> str:
        """Extract plain text from a LangChain message, handling different content formats."""
        content = getattr(message, "content", "")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text")
                    if isinstance(text, str):
                        chunks.append(text)
            return "\n".join(chunks).strip()
        return str(content).strip() if content else ""

    def _get_first_exchange_texts(self, state: TitleMiddlewareState) -> tuple[str, str]:
        """Extract normalized text from the first user/assistant exchange."""
        messages = state.get("messages", [])

        # Use _extract_message_text to properly handle different message formats
        user_msg = ""
        assistant_msg = ""

        for m in messages:
            if m.type == "human" and not user_msg:
                user_msg = self._extract_message_text(m)
            elif m.type == "ai" and not getattr(m, "tool_calls", None) and not assistant_msg:
                assistant_msg = self._extract_message_text(m)

        return user_msg, assistant_msg

    def _build_fallback_title(self, user_msg: str, assistant_msg: str, max_chars: int) -> str:
        """Build a deterministic fallback title without LLM calls."""
        fallback_source = user_msg or assistant_msg
        if not fallback_source:
            return "New Conversation"

        fallback_chars = min(max_chars, 50)
        if len(fallback_source) > fallback_chars:
            return fallback_source[:fallback_chars].rstrip() + "..."
        return fallback_source

    def _generate_fast_title(self, state: TitleMiddlewareState) -> str:
        """Generate a fast deterministic title without blocking on LLM calls."""
        config = get_title_config()
        user_msg, _ = self._get_first_exchange_texts(state)
        return self._build_fallback_title(
            user_msg=user_msg,
            assistant_msg="",
            max_chars=config.max_chars,
        )

    def _generate_title(self, state: TitleMiddlewareState) -> str:
        """Generate a concise title based on the conversation using LLM."""
        config = get_title_config()
        user_msg, assistant_msg = self._get_first_exchange_texts(state)

        # Use a lightweight model to generate title
        model = create_chat_model(name=config.model_name, thinking_enabled=False)

        prompt = config.prompt_template.format(
            max_words=config.max_words,
            user_msg=user_msg[:500],
            assistant_msg=assistant_msg[:500],
        )

        try:
            response = model.invoke(prompt)
            # Ensure response content is string
            title_content = str(response.content) if response.content else ""
            title = title_content.strip().strip('"').strip("'")
            # Limit to max characters
            return title[: config.max_chars] if len(title) > config.max_chars else title
        except Exception as e:
            print(f"Failed to generate title: {e}")
            # Fallback: use first part of user message (by character count)
            fallback_chars = min(config.max_chars, 50)  # Use max_chars or 50, whichever is smaller
            if len(user_msg) > fallback_chars:
                return user_msg[:fallback_chars].rstrip() + "..."
            return user_msg if user_msg else "New Conversation"

    @override
    def after_agent(self, state: TitleMiddlewareState, runtime: Runtime) -> dict | None:
        """Set thread title after the first agent response."""
        if self._should_generate_title(state):
            config = get_title_config()
            if config.mode == "llm":
                title = self._generate_title(state)
                print(f"Generated thread title (llm): {title}")
            else:
                # Use fast title (user's question) to avoid blocking on LLM
                title = self._generate_fast_title(state)
                print(f"Generated thread title (fast): {title}")

            # Store title in state (will be persisted by checkpointer if configured)
            return {"title": title}

        return None
