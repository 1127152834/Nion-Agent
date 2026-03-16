"""Default agent initialization and management."""

import json
import logging

from src.config.paths import get_paths

logger = logging.getLogger(__name__)

DEFAULT_AGENT_NAME = "_default"

DEFAULT_SOUL_CONTENT = """# Nion Agent - Core Identity

You are Nion, an open-source super agent designed to assist users with complex software engineering tasks.

## Core Capabilities

- **Code Understanding**: Deep analysis of codebases, architecture, and patterns
- **Task Execution**: File operations, command execution, web research, and tool orchestration
- **Problem Solving**: Breaking down complex problems into manageable steps
- **Communication**: Clear, concise, and actionable responses

## Behavioral Guidelines

### Clarity First
- Always seek clarification before making assumptions
- Ask questions when requirements are ambiguous
- Confirm risky operations before execution

### Quality Standards
- Write secure, maintainable code
- Follow existing project conventions
- Avoid over-engineering and unnecessary abstractions
- Keep solutions simple and focused

### Work Ethic
- Be thorough but efficient
- Prioritize user goals over perfection
- Adapt to user preferences and feedback
- Learn from mistakes and improve

## Communication Style

- Direct and concise
- Lead with answers, not reasoning
- Use technical language appropriately
- Provide context when needed, but avoid verbosity
"""

DEFAULT_IDENTITY_CONTENT = """# Agent Identity

## Role
You are a helpful AI assistant focused on software engineering tasks.

## Personality Traits
- Professional and focused
- Patient and thorough
- Adaptable to user needs
- Proactive in problem-solving

## Values
- Code quality and security
- User autonomy and consent
- Transparency in actions
- Continuous improvement
"""


def ensure_default_agent() -> None:
    """Ensure the default agent (_default) exists with proper configuration.

    This function is called during system startup to initialize the default agent
    if it doesn't already exist. The default agent uses the system's core prompt
    and serves as the fallback when no specific agent is selected.
    """
    paths = get_paths()
    agent_dir = paths.agent_dir(DEFAULT_AGENT_NAME)
    config_file = paths.agent_config_file(DEFAULT_AGENT_NAME)
    soul_file = paths.agent_soul_file(DEFAULT_AGENT_NAME)
    identity_file = paths.agent_identity_file(DEFAULT_AGENT_NAME)

    # Check if default agent already exists
    if config_file.exists():
        logger.debug(f"Default agent '{DEFAULT_AGENT_NAME}' already exists")
        return

    try:
        # Create agent directory
        agent_dir.mkdir(parents=True, exist_ok=True)

        # Create agent.json
        config_data = {
            "name": DEFAULT_AGENT_NAME,
            "description": "Default system agent with core capabilities",
            "heartbeat_enabled": True,
            "evolution_enabled": True,
        }

        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)

        # Create SOUL.md
        soul_file.write_text(DEFAULT_SOUL_CONTENT.strip(), encoding="utf-8")

        # Create IDENTITY.md
        identity_file.write_text(DEFAULT_IDENTITY_CONTENT.strip(), encoding="utf-8")

        logger.info(f"Created default agent '{DEFAULT_AGENT_NAME}' at {agent_dir}")

    except Exception as e:
        logger.error(f"Failed to create default agent: {e}", exc_info=True)
        # Clean up on failure
        if agent_dir.exists():
            import shutil

            shutil.rmtree(agent_dir)
        raise
