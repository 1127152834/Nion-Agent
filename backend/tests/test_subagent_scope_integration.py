"""Test subagent scope integration."""

from nion.subagents import SubagentConfig, SubagentScopes, get_subagent_config


def test_researcher_has_read_only_memory_scope():
    """Test that researcher has read-only memory scope."""
    config = get_subagent_config("researcher")
    assert config is not None
    assert config.scopes.memory_scope == "read-only"


def test_writer_has_read_only_memory_scope():
    """Test that writer has read-only memory scope."""
    config = get_subagent_config("writer")
    assert config is not None
    assert config.scopes.memory_scope == "read-only"


def test_organizer_has_read_only_memory_scope():
    """Test that organizer has read-only memory scope."""
    config = get_subagent_config("organizer")
    assert config is not None
    assert config.scopes.memory_scope == "read-only"


def test_all_new_templates_have_minimal_soul_scope():
    """Test that all new templates have minimal soul scope."""
    for name in ["researcher", "writer", "organizer"]:
        config = get_subagent_config(name)
        assert config is not None
        assert config.scopes.soul_scope == "minimal-summary"


def test_all_new_templates_have_read_write_artifact_scope():
    """Test that all new templates can read and write artifacts."""
    for name in ["researcher", "writer", "organizer"]:
        config = get_subagent_config(name)
        assert config is not None
        assert config.scopes.artifact_scope == "read-write"


def test_scope_boundaries_prevent_memory_write():
    """Test that scope boundaries prevent long-term memory write.

    This is enforced by not including MemoryMiddleware in subagent execution.
    Subagents use create_react_agent_executor which doesn't include MemoryMiddleware.
    """
    config = get_subagent_config("researcher")
    assert config is not None
    # Memory write is prevented by architecture (no MemoryMiddleware)
    # This test documents the expected behavior
    assert config.scopes.memory_scope in ["read-only", "no-access"]


def test_scope_boundaries_prevent_nested_delegation():
    """Test that scope boundaries prevent nested delegation.

    This is enforced by disallowing the 'task' tool in all subagents.
    """
    for name in ["researcher", "writer", "organizer", "bash", "general-purpose"]:
        config = get_subagent_config(name)
        assert config is not None
        assert "task" in config.disallowed_tools


def test_custom_scope_configuration():
    """Test that custom scopes can be configured."""
    custom_config = SubagentConfig(
        name="custom-agent",
        description="Custom agent",
        system_prompt="Custom prompt",
        scopes=SubagentScopes(
            tool_scope=["bash", "read_file"],
            skill_scope="none",
            memory_scope="no-access",
            soul_scope="none",
            artifact_scope="read-only",
        ),
    )

    assert custom_config.scopes.tool_scope == ["bash", "read_file"]
    assert custom_config.scopes.skill_scope == "none"
    assert custom_config.scopes.memory_scope == "no-access"
    assert custom_config.scopes.soul_scope == "none"
    assert custom_config.scopes.artifact_scope == "read-only"
