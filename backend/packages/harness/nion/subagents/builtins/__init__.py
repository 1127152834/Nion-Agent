"""Built-in subagent configurations."""

from .bash_agent import BASH_AGENT_CONFIG
from .general_purpose import GENERAL_PURPOSE_CONFIG
from .organizer import ORGANIZER_CONFIG
from .researcher import RESEARCHER_CONFIG
from .writer import WRITER_CONFIG

__all__ = [
    "GENERAL_PURPOSE_CONFIG",
    "BASH_AGENT_CONFIG",
    "RESEARCHER_CONFIG",
    "WRITER_CONFIG",
    "ORGANIZER_CONFIG",
]

# Registry of built-in subagents
BUILTIN_SUBAGENTS = {
    "general-purpose": GENERAL_PURPOSE_CONFIG,
    "bash": BASH_AGENT_CONFIG,
    "researcher": RESEARCHER_CONFIG,
    "writer": WRITER_CONFIG,
    "organizer": ORGANIZER_CONFIG,
}
