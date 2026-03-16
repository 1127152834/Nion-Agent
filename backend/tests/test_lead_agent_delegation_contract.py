"""Test lead agent delegation contract and prompt."""

from nion.agents.lead_agent.prompt import _build_subagent_section


def test_subagent_section_includes_new_templates():
    """Test that subagent section includes all 5 templates."""
    section = _build_subagent_section(max_concurrent=3)

    # Check all templates are mentioned
    assert "general-purpose" in section
    assert "bash" in section
    assert "researcher" in section
    assert "writer" in section
    assert "organizer" in section


def test_subagent_section_includes_scope_explanation():
    """Test that subagent section explains scope boundaries."""
    section = _build_subagent_section(max_concurrent=3)

    # Check scope explanations
    assert "Subagent Access Boundaries" in section or "Scopes" in section
    assert "Tool Scope" in section
    assert "Memory Scope" in section
    assert "Soul Scope" in section
    assert "READ-ONLY" in section or "read-only" in section.lower()


def test_subagent_section_includes_delegation_guidance():
    """Test that subagent section includes when to use each type."""
    section = _build_subagent_section(max_concurrent=3)

    # Check delegation guidance
    assert "researcher" in section.lower()
    assert "writer" in section.lower()
    assert "organizer" in section.lower()

    # Check it mentions use cases
    assert "research" in section.lower() or "information" in section.lower()
    assert "document" in section.lower() or "writing" in section.lower()
    assert "plan" in section.lower() or "organize" in section.lower()


def test_subagent_section_preserves_concurrency_limit():
    """Test that concurrency limit is still enforced."""
    section = _build_subagent_section(max_concurrent=3)

    # Check concurrency limit is mentioned
    assert "MAXIMUM 3" in section or "max 3" in section.lower()
    assert "HARD" in section or "hard" in section.lower()


def test_subagent_section_different_limits():
    """Test that section adapts to different concurrency limits."""
    section_2 = _build_subagent_section(max_concurrent=2)
    section_4 = _build_subagent_section(max_concurrent=4)

    assert "MAXIMUM 2" in section_2 or "max 2" in section_2.lower()
    assert "MAXIMUM 4" in section_4 or "max 4" in section_4.lower()
