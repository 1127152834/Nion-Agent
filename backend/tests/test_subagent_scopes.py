"""Test subagent scopes and contracts."""

import pytest

from src.subagents import DelegationContract, DelegationResultEnvelope, SubagentConfig, SubagentScopes


def test_subagent_scopes_default():
    """Test SubagentScopes with default values."""
    scopes = SubagentScopes()
    assert scopes.tool_scope == "inherit"
    assert scopes.skill_scope == "none"
    assert scopes.memory_scope == "read-only"
    assert scopes.soul_scope == "minimal-summary"
    assert scopes.artifact_scope == "read-write"


def test_subagent_scopes_custom():
    """Test SubagentScopes with custom values."""
    scopes = SubagentScopes(
        tool_scope=["bash", "read_file"],
        skill_scope="inherit",
        memory_scope="no-access",
        soul_scope="none",
        artifact_scope="read-only",
    )
    assert scopes.tool_scope == ["bash", "read_file"]
    assert scopes.skill_scope == "inherit"
    assert scopes.memory_scope == "no-access"
    assert scopes.soul_scope == "none"
    assert scopes.artifact_scope == "read-only"


def test_delegation_contract():
    """Test DelegationContract model."""
    contract = DelegationContract(
        task_kind="research",
        goal="Collect information about topic X",
        input_context_refs=["file1.txt", "file2.txt"],
        allowed_tools=["bash", "read_file"],
        memory_scope="read-only",
    )
    assert contract.task_kind == "research"
    assert contract.goal == "Collect information about topic X"
    assert contract.input_context_refs == ["file1.txt", "file2.txt"]
    assert contract.allowed_tools == ["bash", "read_file"]
    assert contract.memory_scope == "read-only"
    assert contract.return_summary is True


def test_delegation_result_envelope():
    """Test DelegationResultEnvelope model."""
    result = DelegationResultEnvelope(
        summary="Task completed successfully",
        key_findings=["Finding 1", "Finding 2"],
        artifact_paths=["/path/to/artifact.txt"],
        suggest_memory_write=True,
    )
    assert result.summary == "Task completed successfully"
    assert result.key_findings == ["Finding 1", "Finding 2"]
    assert result.artifact_paths == ["/path/to/artifact.txt"]
    assert result.failure_reason is None
    assert result.suggest_memory_write is True


def test_subagent_config_with_scopes():
    """Test SubagentConfig with scopes field."""
    config = SubagentConfig(
        name="test-agent",
        description="Test agent",
        system_prompt="Test prompt",
        scopes=SubagentScopes(
            memory_scope="no-access",
            soul_scope="none",
        ),
    )
    assert config.name == "test-agent"
    assert config.scopes.memory_scope == "no-access"
    assert config.scopes.soul_scope == "none"
    assert config.scopes.tool_scope == "inherit"


def test_subagent_config_default_scopes():
    """Test SubagentConfig with default scopes."""
    config = SubagentConfig(
        name="test-agent",
        description="Test agent",
        system_prompt="Test prompt",
    )
    assert config.scopes.tool_scope == "inherit"
    assert config.scopes.skill_scope == "none"
    assert config.scopes.memory_scope == "read-only"
    assert config.scopes.soul_scope == "minimal-summary"
    assert config.scopes.artifact_scope == "read-write"
