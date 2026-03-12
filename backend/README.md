# Nion Backend

Nion is a LangGraph-based AI super agent with sandbox execution, persistent memory, and extensible tool integration. The backend enables AI agents to execute code, browse the web, manage files, delegate tasks to subagents, and retain context across conversations - all in isolated, per-thread environments.

---

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │          Nginx (Port 2026)           │
                        │   Unified browser entry (Web only)   │
                        └─────────────────┬────────────────────┘
                                          │
                            Browser `/api/*` + `/`
                                          │
                                          ▼
                         ┌────────────────────────────────┐
                         │      Gateway API (8001)        │
                         │       FastAPI facade           │
                         │ Models, MCP, Skills, Memory,   │
                         │ Uploads, Artifacts, Topology,  │
                         │ LangGraph proxy + state access │
                         └─────────────────┬──────────────┘
                                           │
                           Internal upstream `/api/langgraph/*`
                                           │
                                           ▼
                            ┌────────────────────────────┐
                            │    LangGraph Server 2024   │
                            │  Lead Agent + middleware   │
                            │  chain + tools + subagents │
                            └────────────────────────────┘
```

**Request Routing**:
- Web unified entry: Nginx forwards browser `/` to Frontend and browser `/api/*` to Gateway
- Electron / web direct dev: Frontend calls Gateway directly without Nginx
- Gateway is the only browser-facing API facade; LangGraph is treated as Gateway's upstream

---

## Core Components

### Lead Agent

The single LangGraph agent (`lead_agent`) is the runtime entry point, created via `make_lead_agent(config)`. It combines:

- **Dynamic model selection** with thinking and vision support
- **Middleware chain** for cross-cutting concerns (9 middlewares)
- **Tool system** with sandbox, MCP, community, and built-in tools
- **Subagent delegation** for parallel task execution
- **System prompt** with skills injection, memory context, and working directory guidance
- **Run contract** where browser/Electron LangGraph requests keep runtime fields in `context`; do not send `config.configurable` together with `context` in the same HTTP run request

### Middleware Chain

Middlewares execute in strict order, each handling a specific concern:

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | **ThreadDataMiddleware** | Creates per-thread isolated directories (workspace, uploads, outputs) |
| 2 | **UploadsMiddleware** | Injects newly uploaded files into conversation context |
| 3 | **SandboxMiddleware** | Acquires sandbox environment for code execution |
| 4 | **SummarizationMiddleware** | Reduces context when approaching token limits (optional) |
| 5 | **TodoListMiddleware** | Tracks multi-step tasks in plan mode (optional) |
| 6 | **TitleMiddleware** | Auto-generates conversation titles after first exchange |
| 7 | **MemoryMiddleware** | Queues conversations for async memory extraction |
| 8 | **ViewImageMiddleware** | Injects image data for vision-capable models (conditional) |
| 9 | **ClarificationMiddleware** | Intercepts clarification requests and interrupts execution (must be last) |

### Sandbox System

Per-thread isolated execution with virtual path translation:

- **Abstract interface**: `execute_command`, `read_file`, `write_file`, `list_dir`
- **Providers**: `LocalSandboxProvider` (filesystem) and `AioSandboxProvider` (Docker, in community/)
- **Virtual paths**: `/mnt/user-data/{workspace,uploads,outputs}` → thread-specific physical directories
- **Skills path**: `/mnt/skills` → `nion/skills/` directory
- **Skills loading**: Recursively discovers nested `SKILL.md` files under `skills/{public,custom}` and preserves nested container paths
- **Tools**: `bash`, `ls`, `read_file`, `write_file`, `str_replace`

### Subagent System

Async task delegation with concurrent execution:

- **Built-in agents**: `general-purpose` (full toolset) and `bash` (command specialist)
- **Concurrency**: Max 3 subagents per turn, 15-minute timeout
- **Execution**: Background thread pools with status tracking and SSE events
- **Flow**: Agent calls `task()` tool → executor runs subagent in background → polls for completion → returns result

### Memory System

OpenViking-only persistent context retention across conversations:

- **Single provider**: `openviking` is the only online memory provider
- **Resource ledger**: Local SQLite ledger tracks `memory_id`, `uri`, score, status, and usage metadata
- **Hard delete**: `forget` / `compact` first call OpenViking `rm(uri)`, then commit local ledger changes
- **Governance**: Queue/status/run/decide flows built on OpenViking ledger tables
- **No legacy path**: structured memory and old single-file memory artifacts are cleaned at startup

### Tool Ecosystem

| Category | Tools |
|----------|-------|
| **Sandbox** | `bash`, `ls`, `read_file`, `write_file`, `str_replace` |
| **Built-in** | `present_files`, `ask_clarification`, `view_image`, `task` (subagent) |
| **Community** | Tavily (web search), Jina AI (web fetch), Firecrawl (scraping), DuckDuckGo (image search) |
| **MCP** | Any Model Context Protocol server (stdio, SSE, HTTP transports) |
| **Skills** | Domain-specific workflows injected via system prompt |

### Gateway API

FastAPI application providing REST endpoints for frontend integration:

| Route | Purpose |
|-------|---------|
| `GET /api/models` | List available LLM models |
| `GET/PUT /api/mcp/config` | Manage MCP server configurations |
| `GET/PUT /api/skills` | List and manage skills |
| `POST /api/skills/install` | Install skill from `.skill` archive |
| `POST /api/openviking/query` | Query OpenViking memory |
| `POST /api/openviking/store` | Store memory into OpenViking |
| `GET /api/openviking/items` | List ledger items |
| `POST /api/openviking/forget` | Hard-delete one memory item |
| `POST /api/openviking/compact` | Hard-delete by retention ratio |
| `GET /api/openviking/governance/status` | Governance status |
| `POST /api/openviking/governance/run` | Run governance |
| `POST /api/openviking/governance/decide` | Apply governance decision |
| `GET /api/openviking/retrieval/status` | Retrieval runtime status |
| `POST /api/openviking/reindex-vectors` | Rebuild vector index |
| `POST /api/openviking/graph/query` | Query memory graph |
| `POST /api/openviking/session/commit` | Commit session batch |
| `GET /api/openviking/config` | OpenViking config |
| `GET /api/openviking/status` | Combined config + retrieval + governance |
| `GET /api/runtime/topology` | Read-only runtime topology diagnostics |
| `POST /api/threads/{id}/uploads` | Upload files (auto-converts PDF/PPT/Excel/Word to Markdown) |
| `GET /api/threads/{id}/uploads/list` | List uploaded files |
| `GET /api/threads/{id}/artifacts/{path}` | Serve generated artifacts |

---

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager
- API keys for your chosen LLM provider

### Installation

```bash
cd nion

# Copy configuration files
cp config.example.yaml config.yaml

# Install backend dependencies
cd backend
make install
```

### Configuration

Edit `config.yaml` in the project root:

```yaml
models:
  - name: gpt-4o
    display_name: GPT-4o
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY
    supports_thinking: false
    supports_vision: true
```

Set your API keys:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

### Running

**Full Application** (from project root):

```bash
make dev  # Starts LangGraph + Gateway + Frontend + Nginx
```

Access at: http://localhost:2026

**Backend Only** (from backend directory):

```bash
# Terminal 1: LangGraph server
make dev

# Terminal 2: Gateway API
make gateway
```

Direct service access for diagnostics: LangGraph at http://localhost:2024, Gateway at http://localhost:8001

---

## Project Structure

```
backend/
├── src/
│   ├── agents/                  # Agent system
│   │   ├── lead_agent/         # Main agent (factory, prompts)
│   │   ├── middlewares/        # 9 middleware components
│   │   ├── memory/             # OpenViking runtime, policy, governance, ledger
│   │   └── thread_state.py    # ThreadState schema
│   ├── gateway/                # FastAPI Gateway API
│   │   ├── app.py             # Application setup
│   │   └── routers/           # 6 route modules
│   ├── sandbox/                # Sandbox execution
│   │   ├── local/             # Local filesystem provider
│   │   ├── sandbox.py         # Abstract interface
│   │   ├── tools.py           # bash, ls, read/write/str_replace
│   │   └── middleware.py      # Sandbox lifecycle
│   ├── subagents/              # Subagent delegation
│   │   ├── builtins/          # general-purpose, bash agents
│   │   ├── executor.py        # Background execution engine
│   │   └── registry.py        # Agent registry
│   ├── tools/builtins/         # Built-in tools
│   ├── mcp/                    # MCP protocol integration
│   ├── models/                 # Model factory
│   ├── skills/                 # Skill discovery & loading
│   ├── config/                 # Configuration system
│   ├── community/              # Community tools & providers
│   ├── reflection/             # Dynamic module loading
│   └── utils/                  # Utilities
├── docs/                       # Documentation
├── tests/                      # Test suite
├── langgraph.json              # LangGraph server configuration
├── pyproject.toml              # Python dependencies
├── Makefile                    # Development commands
└── Dockerfile                  # Container build
```

---

## Configuration

### Main Configuration (`config.yaml`)

Place in project root. Config values starting with `$` resolve as environment variables.

Key sections:
- `models` - LLM configurations with class paths, API keys, thinking/vision flags
- `tools` - Tool definitions with module paths and groups
- `tool_groups` - Logical tool groupings
- `sandbox` - Execution environment provider
- `skills` - Skills directory paths
- `title` - Auto-title generation settings
- `summarization` - Context summarization settings
- `subagents` - Subagent system (enabled/disabled)
- `memory` - OpenViking settings (enabled, debounce, retrieval/rerank, facts limits)

Provider note:
- `models[*].use` references provider classes by module path (for example `langchain_openai:ChatOpenAI`).
- If a provider module is missing, Nion now returns an actionable error with install guidance (for example `uv add langchain-google-genai`).

### Extensions Configuration (`extensions_config.json`)

MCP servers and skill states in a single file:

```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}
    },
    "secure-http": {
      "enabled": true,
      "type": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.example.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$MCP_OAUTH_CLIENT_ID",
        "client_secret": "$MCP_OAUTH_CLIENT_SECRET"
      }
    }
  },
  "skills": {
    "pdf-processing": {"enabled": true}
  }
}
```

### Environment Variables

- `NION_CONFIG_PATH` - Override config.yaml location
- `NION_EXTENSIONS_CONFIG_PATH` - Override extensions_config.json location
- Model API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, etc.
- Tool API keys: `TAVILY_API_KEY`, `GITHUB_TOKEN`, etc.

---

## Development

### Commands

```bash
make install    # Install dependencies
make dev        # Run LangGraph server (port 2024)
make gateway    # Run Gateway API (port 8001)
make lint       # Run linter (ruff)
make format     # Format code (ruff)
```

### Code Style

- **Linter/Formatter**: `ruff`
- **Line length**: 240 characters
- **Python**: 3.12+ with type hints
- **Quotes**: Double quotes
- **Indentation**: 4 spaces

### Testing

```bash
uv run pytest
```

---

## Technology Stack

- **LangGraph** (1.0.6+) - Agent framework and multi-agent orchestration
- **LangChain** (1.2.3+) - LLM abstractions and tool system
- **FastAPI** (0.115.0+) - Gateway REST API
- **langchain-mcp-adapters** - Model Context Protocol support
- **agent-sandbox** - Sandboxed code execution
- **markitdown** - Multi-format document conversion
- **tavily-python** / **firecrawl-py** - Web search and scraping

---

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md)
- [Architecture Details](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [File Upload](docs/FILE_UPLOAD.md)
- [Path Examples](docs/PATH_EXAMPLES.md)
- [Context Summarization](docs/summarization.md)
- [Plan Mode](docs/plan_mode_usage.md)
- [Setup Guide](docs/SETUP.md)

---

## License

See the [LICENSE](../LICENSE) file in the project root.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
