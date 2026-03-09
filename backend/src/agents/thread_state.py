from typing import Annotated, Literal, NotRequired, TypedDict

from langchain.agents import AgentState


class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]


class ThreadDataState(TypedDict):
    workspace_path: NotRequired[str | None]
    uploads_path: NotRequired[str | None]
    outputs_path: NotRequired[str | None]


class ToolSafetyState(TypedDict):
    pending_signature: NotRequired[str | None]
    pending_summary: NotRequired[str | None]
    allow_once_signature: NotRequired[str | None]
    asked_at: NotRequired[str | None]
    resolved_at: NotRequired[str | None]


class ViewedImageData(TypedDict):
    base64: str
    mime_type: str


class ArtifactGroupMetadata(TypedDict):
    task_id: NotRequired[str | None]
    prompt: NotRequired[str | None]
    tags: NotRequired[list[str] | None]


class ArtifactGroup(TypedDict):
    id: str
    name: str
    description: NotRequired[str | None]
    artifacts: list[str]
    created_at: int
    metadata: NotRequired[ArtifactGroupMetadata | None]


class ClarificationState(TypedDict):
    status: NotRequired[str]
    question: NotRequired[str]
    clarification_type: NotRequired[str]
    context: NotRequired[str | None]
    options: NotRequired[list[str]]
    requires_choice: NotRequired[bool]
    tool_call_id: NotRequired[str | None]
    asked_at: NotRequired[str | None]
    resolved_at: NotRequired[str | None]
    resolved_by_message_id: NotRequired[str | None]


def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    """Reducer for artifacts list - merges and deduplicates artifacts."""
    if existing is None:
        return new or []
    if new is None:
        return existing
    # Use dict.fromkeys to deduplicate while preserving order
    return list(dict.fromkeys(existing + new))


def merge_viewed_images(existing: dict[str, ViewedImageData] | None, new: dict[str, ViewedImageData] | None) -> dict[str, ViewedImageData]:
    """Reducer for viewed_images dict - merges image dictionaries.

    Special case: If new is an empty dict {}, it clears the existing images.
    This allows middlewares to clear the viewed_images state after processing.
    """
    if existing is None:
        return new or {}
    if new is None:
        return existing
    # Special case: empty dict means clear all viewed images
    if len(new) == 0:
        return {}
    # Merge dictionaries, new values override existing ones for same keys
    return {**existing, **new}


SessionMode = Literal["normal", "temporary_chat"]


class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    execution_mode: NotRequired[str | None]
    host_workdir: NotRequired[str | None]
    runtime_profile_locked: NotRequired[bool]
    session_mode: NotRequired[SessionMode | None]
    memory_read: NotRequired[bool | None]
    memory_write: NotRequired[bool | None]
    tool_safety: NotRequired[ToolSafetyState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    artifact_groups: NotRequired[list[ArtifactGroup] | None]
    clarification: NotRequired[ClarificationState | None]
    todos: NotRequired[list | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]  # image_path -> {base64, mime_type}
