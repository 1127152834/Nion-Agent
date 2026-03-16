"""Test subagent registry with new templates."""

from nion.subagents import get_subagent_config, list_subagents


def test_list_subagents_includes_new_templates():
    """Test that list_subagents returns all 5 templates."""
    subagents = list_subagents()
    assert len(subagents) == 5

    names = [s.name for s in subagents]
    assert "general-purpose" in names
    assert "bash" in names
    assert "researcher" in names
    assert "writer" in names
    assert "organizer" in names


def test_get_researcher_config():
    """Test researcher subagent configuration."""
    config = get_subagent_config("researcher")
    assert config is not None
    assert config.name == "researcher"
    assert "资料收集" in config.description
    assert config.max_turns == 50
    assert config.scopes.memory_scope == "read-only"
    assert config.scopes.soul_scope == "minimal-summary"
    assert "task" in config.disallowed_tools


def test_get_writer_config():
    """Test writer subagent configuration."""
    config = get_subagent_config("writer")
    assert config is not None
    assert config.name == "writer"
    assert "成稿" in config.description
    assert config.max_turns == 40
    assert config.scopes.memory_scope == "read-only"
    assert config.scopes.soul_scope == "minimal-summary"
    assert "bash" in config.disallowed_tools


def test_get_organizer_config():
    """Test organizer subagent configuration."""
    config = get_subagent_config("organizer")
    assert config is not None
    assert config.name == "organizer"
    assert "计划拆解" in config.description
    assert config.max_turns == 40
    assert config.scopes.memory_scope == "read-only"
    assert config.scopes.soul_scope == "minimal-summary"


def test_all_new_templates_have_scopes():
    """Test that all new templates have proper scopes."""
    for name in ["researcher", "writer", "organizer"]:
        config = get_subagent_config(name)
        assert config is not None
        assert config.scopes is not None
        assert config.scopes.tool_scope == "inherit"
        assert config.scopes.skill_scope == "inherit"
        assert config.scopes.memory_scope == "read-only"
        assert config.scopes.soul_scope == "minimal-summary"
        assert config.scopes.artifact_scope == "read-write"


def test_new_templates_disallow_task():
    """Test that new templates disallow task tool to prevent nesting."""
    for name in ["researcher", "writer", "organizer"]:
        config = get_subagent_config(name)
        assert config is not None
        assert "task" in config.disallowed_tools
