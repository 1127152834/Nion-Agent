"""Delegation contract models."""

from dataclasses import dataclass, field


@dataclass
class DelegationContract:
    """Defines the contract for delegating a task to a subagent.

    Attributes:
        task_kind: Type of task (e.g., "research", "writing", "execution")
        goal: Clear description of what the subagent should achieve
        input_context_refs: References to input context (file paths, URLs, etc.)
        allowed_tools: List of tool names the subagent is allowed to use
        memory_scope: Memory access level for this delegation
        expected_output_schema: Optional schema for structured output
        return_summary: Whether to return a summary of the work
    """

    task_kind: str
    goal: str
    input_context_refs: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    memory_scope: str = "read-only"
    expected_output_schema: dict | None = None
    return_summary: bool = True


@dataclass
class DelegationResultEnvelope:
    """Envelope for subagent execution results.

    Attributes:
        summary: Brief summary of what was accomplished
        key_findings: List of key findings or insights
        artifact_paths: Paths to generated artifacts
        failure_reason: Reason for failure if task failed
        suggest_memory_write: Whether the result should be written to long-term memory
    """

    summary: str
    key_findings: list[str] = field(default_factory=list)
    artifact_paths: list[str] = field(default_factory=list)
    failure_reason: str | None = None
    suggest_memory_write: bool = False
