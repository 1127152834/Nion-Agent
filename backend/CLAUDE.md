# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nion is a LangGraph-based AI super agent system with a full-stack architecture. The backend provides a "super agent" with sandbox execution, persistent memory, subagent delegation, and extensible tool integration - all operating in per-thread isolated environments.

**Architecture**:
- **LangGraph Server** (port 2024): Agent runtime and workflow execution
- **Gateway API** (port 8001): Browser-facing REST facade for models, MCP, skills, memory, artifacts, uploads, topology, and LangGraph proxying
- **Frontend** (port 3000): Next.js web interface
- **Nginx** (port 2026): Unified web entry point that forwards browser `/api/*` to Gateway
- **Provisioner** (port 8002, optional in Docker dev): Started only when sandbox is configured for provisioner/Kubernetes mode

**Project Structure**:
```
nion/
├── Makefile                    # Root commands (check, install, dev, stop)
├── config.yaml                 # Main application configuration
├── extensions_config.json      # MCP servers and skills configuration
├── backend/                    # Backend application (this directory)
│   ├── Makefile               # Backend-only commands (dev, gateway, lint)
│   ├── langgraph.json         # LangGraph server configuration
│   ├── pyproject.toml         # Backend dependencies and tooling config
│   ├── ruff.toml              # Ruff lint/format config
│   ├── Dockerfile             # Container build
│   ├── packages/
│   │   └── harness/
│   │       ├── pyproject.toml  # nion-harness package definition (workspace member)
│   │       └── nion/           # Harness layer (publishable), import prefix: nion.*
│   │           ├── agents/     # LangGraph agent system
│   │           ├── cli/        # CLI
│   │           ├── client.py   # Embedded Python client (NionClient)
│   │           ├── community/  # Community tools/providers
│   │           ├── config/     # Configuration system
│   │           ├── keychain/   # Keychain integration
│   │           ├── mcp/        # MCP integration (tools, cache, client)
│   │           ├── models/     # Model factory with thinking/vision support
│   │           ├── processlog/ # Process logging
│   │           ├── reflection/ # Dynamic module loading (resolve_variable, resolve_class)
│   │           ├── runtime_profile/
│   │           ├── sandbox/    # Sandbox execution system
│   │           ├── scheduler/  # Scheduler/workflow runner
│   │           ├── skills/     # Skills loader/parsing (code)
│   │           ├── subagents/  # Subagent delegation system
│   │           ├── tools/      # Tool system (builtins, etc.)
│   │           └── utils/      # Utilities (network, readability)
│   ├── app/                   # App layer (not publishable), import prefix: app.*
│   │   ├── gateway/           # FastAPI Gateway API
│   │   │   ├── app.py         # FastAPI application
│   │   │   └── routers/       # Route modules
│   │   ├── channels/          # Channels and integrations
│   │   ├── heartbeat/         # Heartbeat system
│   │   ├── evolution/         # Evolution system
│   │   ├── embedding_models/  # Embedding models
│   │   ├── retrieval_models/  # Retrieval models
│   │   ├── security/          # Security utilities
│   │   └── system/            # System utilities
│   ├── tests/                 # Test suite
│   └── docs/                  # Documentation
├── frontend/                   # Next.js frontend application
└── skills/                     # Agent skills directory
    ├── public/                # Public skills (committed)
    └── custom/                # Custom skills (gitignored)
```

## Important Development Guidelines

### Documentation Update Policy
**CRITICAL: Always update README.md and CLAUDE.md after every code change**

When making code changes, you MUST update the relevant documentation:
- Update `README.md` for user-facing changes (features, setup, usage instructions)
- Update `CLAUDE.md` for development changes (architecture, commands, workflows, internal systems)
- Keep documentation synchronized with the codebase at all times
- Ensure accuracy and timeliness of all documentation

## Commands

**Root directory** (for full application):
```bash
make check      # Check system requirements
make install    # Install all dependencies (frontend + backend)
make dev        # Start all services (LangGraph + Gateway + Frontend + Nginx)
make stop       # Stop all services
```

**Backend directory** (for backend development only):
```bash
make install    # Install backend dependencies
make dev        # Run LangGraph server only (port 2024)
make gateway    # Run Gateway API only (port 8001)
make test       # Run all backend tests
make lint       # Lint with ruff
make format     # Format code with ruff
```

Regression tests related to Docker/provisioner behavior:
- `tests/test_docker_sandbox_mode_detection.py` (mode detection from `config.yaml`)
- `tests/test_provisioner_kubeconfig.py` (kubeconfig file/directory handling)

CI runs these regression tests for every pull request via [.github/workflows/backend-unit-tests.yml](../.github/workflows/backend-unit-tests.yml).

## Architecture

### Agent System

**Lead Agent** (`packages/harness/nion/agents/lead_agent/agent.py`):
- Entry point: `make_lead_agent(config: RunnableConfig)` registered in `langgraph.json`
- Dynamic model selection via `create_chat_model()` with thinking/vision support
- Tools loaded via `get_available_tools()` - combines sandbox, built-in, MCP, community, and subagent tools
- System prompt generated by `apply_prompt_template()` with skills, memory, and subagent instructions

**ThreadState** (`packages/harness/nion/agents/thread_state.py`):
- Extends `AgentState` with: `sandbox`, `thread_data`, `title`, `artifacts`, `todos`, `uploaded_files`, `viewed_images`, `session_mode`, `memory_read`, `memory_write`
- Uses custom reducers: `merge_artifacts` (deduplicate), `merge_viewed_images` (merge/clear)

**Runtime Configuration**:
- HTTP / LangGraph SDK run requests should keep runtime fields on the `context` lane (`thread_id`, `model_name`, `thinking_enabled`, `is_plan_mode`, `subagent_enabled`, `reasoning_effort`, `agent_name`, `session_mode`, `memory_read`, `memory_write`).
- Do not send `config.configurable` together with `context` in the same browser/Electron HTTP run request; current LangGraph rejects that payload with HTTP 400. Runtime-only middleware inputs continue to flow through `context` (for example `thread_id`, `user_timezone`, runtime profile fields such as `execution_mode` / `host_workdir`).

Fields resolved by the lead agent/runtime:
- `thinking_enabled` - Enable model's extended thinking
- `model_name` - Select specific LLM model
- `is_plan_mode` - Enable TodoList middleware
- `subagent_enabled` - Enable task delegation tool
- `session_mode` / `memory_read` / `memory_write` - Thread-level memory session contract for prompt injection and memory write protection

### Middleware Chain

Middlewares execute in strict order in `packages/harness/nion/agents/lead_agent/agent.py`:

1. **ThreadDataMiddleware** - Creates per-thread directories (`backend/.nion/threads/{thread_id}/user-data/{workspace,uploads,outputs}`)
2. **UploadsMiddleware** - Tracks and injects newly uploaded files into conversation
3. **SandboxMiddleware** - Acquires sandbox, stores `sandbox_id` in state
4. **DanglingToolCallMiddleware** - Injects placeholder ToolMessages for AIMessage tool_calls that lack responses (e.g., due to user interruption)
5. **SummarizationMiddleware** - Context reduction when approaching token limits (optional, if enabled)
6. **TodoListMiddleware** - Task tracking with `write_todos` tool (optional, if plan_mode)
7. **TitleMiddleware** - Auto-generates thread title after first complete exchange
8. **MemoryMiddleware** - Queues conversations for async memory update (filters to user + final AI responses)
9. **ViewImageMiddleware** - Injects base64 image data before LLM call (conditional on vision support)
10. **SubagentLimitMiddleware** - Truncates excess `task` tool calls from model response to enforce `MAX_CONCURRENT_SUBAGENTS` limit (optional, if subagent_enabled)
11. **ClarificationMiddleware** - Intercepts `ask_clarification` tool calls, interrupts via `Command(goto=END)` (must be last)

### Configuration System

**Main Configuration** (`config.yaml`):

Setup: Copy `config.example.yaml` to `config.yaml` in the **project root** directory.

Configuration priority:
1. Explicit `config_path` argument
2. `NION_CONFIG_PATH` environment variable
3. `config.yaml` in current directory (backend/)
4. `config.yaml` in parent directory (project root - **recommended location**)

Config values starting with `$` are resolved as environment variables (e.g., `$OPENAI_API_KEY`).

**Extensions Configuration** (`extensions_config.json`):

MCP servers and skills are configured together in `extensions_config.json` in project root:

Configuration priority:
1. Explicit `config_path` argument
2. `NION_EXTENSIONS_CONFIG_PATH` environment variable
3. `extensions_config.json` in current directory (backend/)
4. `extensions_config.json` in parent directory (project root - **recommended location**)

### Gateway API (`app/gateway/`)

FastAPI application on port 8001 with health check at `GET /health`.

**Routers**:

| Router | Endpoints |
|--------|-----------|
| **Models** (`/api/models`) | `GET /` - list models; `GET /{name}` - model details |
| **MCP** (`/api/mcp`) | `GET /config` - get config; `PUT /config` - update config (saves to extensions_config.json) |
| **Skills** (`/api/skills`) | `GET /` - list skills; `GET /{name}` - details; `PUT /{name}` - update enabled; `POST /install` - install from .skill archive |
| **OpenViking** (`/api/openviking`) | query/store/items/forget/compact/governance/retrieval/reindex/graph/session/config/status |
| **Uploads** (`/api/threads/{id}/uploads`) | `POST /` - upload files (auto-converts PDF/PPT/Excel/Word); `GET /list` - list; `DELETE /{filename}` - delete |
| **Artifacts** (`/api/threads/{id}/artifacts`) | `GET /{path}` - serve artifacts; `?download=true` for file download |
| **Suggestions** (`/api/threads/{id}/suggestions`) | `POST /` - generate follow-up questions; accepts optional `model_name` override |

Browser traffic should use Gateway as the only API facade. In Web mode nginx forwards `/api/*` to Gateway; in Electron and direct dev mode the frontend talks to Gateway directly.

### Sandbox System (`packages/harness/nion/sandbox/`)

**Interface**: Abstract `Sandbox` with `execute_command`, `read_file`, `write_file`, `list_dir`
**Provider Pattern**: `SandboxProvider` with `acquire`, `get`, `release` lifecycle
**Implementations**:
- `LocalSandboxProvider` - Singleton local filesystem execution with path mappings
- `AioSandboxProvider` (`packages/harness/nion/community/`) - Docker-based isolation

**Virtual Path System**:
- Agent sees: `/mnt/user-data/{workspace,uploads,outputs}`, `/mnt/skills`
- Physical: `backend/.nion/threads/{thread_id}/user-data/...`, `nion/skills/`
- Translation: `replace_virtual_path()` / `replace_virtual_paths_in_command()`
- Detection: `is_local_sandbox()` checks `sandbox_id == "local"`

**Sandbox Tools** (in `packages/harness/nion/sandbox/tools.py`):
- `bash` - Execute commands with path translation and error handling
- `ls` - Directory listing (tree format, max 2 levels)
- `read_file` - Read file contents with optional line range
- `write_file` - Write/append to files, creates directories
- `str_replace` - Substring replacement (single or all occurrences)

### Subagent System (`packages/harness/nion/subagents/`)

**Architecture**: Lead agent is the single user entry point; subagents are bounded delegation workers, not peer agents.

**Built-in Agents** (5 templates):
- `general-purpose` - Complex multi-step tasks (all tools except `task`)
- `bash` - Command execution specialist (sandbox tools only)
- `researcher` - Research, information gathering, comparative analysis (max_turns=50)
- `writer` - Document creation, content rewriting, structured output (max_turns=40)
- `organizer` - Task breakdown, information organization, result summarization (max_turns=40)

**Scope Model** (`SubagentScopes`):
- `tool_scope`: Tools accessible to subagent (inherit/list)
- `skill_scope`: Skills accessible to subagent (inherit/none/list)
- `memory_scope`: Long-term memory access (read-only/no-access)
- `soul_scope`: Soul asset access (minimal-summary/none)
- `artifact_scope`: Artifact access (read-write/read-only)

**Delegation Contract** (`DelegationContract`):
- `task_kind`: Task type (research/writing/execution)
- `goal`: Clear task description
- `input_context_refs`: Input context references
- `allowed_tools`: Tool allowlist for this delegation
- `memory_scope`: Memory access level
- `expected_output_schema`: Optional structured output schema
- `return_summary`: Whether to return summary

**Scope Boundaries**:
- Subagents have READ-ONLY memory access (no MemoryMiddleware)
- Subagents receive minimal soul summary, not full SOUL/IDENTITY assets
- Subagents cannot delegate to other subagents (task tool disallowed)
- Subagents inherit sandbox access for artifact read/write

**Execution**: Dual thread pool - `_scheduler_pool` (3 workers) + `_execution_pool` (3 workers)
**Concurrency**: `MAX_CONCURRENT_SUBAGENTS = 3` enforced by `SubagentLimitMiddleware` (truncates excess tool calls in `after_model`), 15-minute timeout
**Flow**: `task()` tool → `SubagentExecutor` → background thread → poll 5s → SSE events → result
**Events**: `task_started`, `task_running`, `task_completed`/`task_failed`/`task_timed_out`

### Tool System (`packages/harness/nion/tools/`)

`get_available_tools(groups, include_mcp, model_name, subagent_enabled)` assembles:
1. **Config-defined tools** - Resolved from `config.yaml` via `resolve_variable()`
2. **MCP tools** - From enabled MCP servers (lazy initialized, cached with mtime invalidation)
3. **Built-in tools**:
   - `present_files` - Make output files visible to user (only `/mnt/user-data/outputs`)
   - `ask_clarification` - Request clarification (intercepted by ClarificationMiddleware → interrupts)
   - `view_image` - Read image as base64 (added only if model supports vision)
4. **Subagent tool** (if enabled):
   - `task` - Delegate to subagent (description, prompt, subagent_type, max_turns)

**Community tools** (`packages/harness/nion/community/`):
- `tavily/` - Web search (5 results default) and web fetch (4KB limit)
- `jina_ai/` - Web fetch via Jina reader API with readability extraction
- `firecrawl/` - Web scraping via Firecrawl API
- `image_search/` - Image search via DuckDuckGo

### MCP System (`packages/harness/nion/mcp/`)

- Uses `langchain-mcp-adapters` `MultiServerMCPClient` for multi-server management
- **Lazy initialization**: Tools loaded on first use via `get_cached_mcp_tools()`
- **Cache invalidation**: Detects config file changes via mtime comparison
- **Transports**: stdio (command-based), SSE, HTTP
- **OAuth (HTTP/SSE)**: Supports token endpoint flows (`client_credentials`, `refresh_token`) with automatic token refresh + Authorization header injection
- **Runtime updates**: Gateway API saves to extensions_config.json; LangGraph detects via mtime

### Skills System (`packages/harness/nion/skills/`)

- **Location**: `nion/skills/{public,custom}/`
- **Format**: Directory with `SKILL.md` (YAML frontmatter: name, description, license, allowed-tools)
- **Loading**: `load_skills()` recursively scans `skills/{public,custom}` for `SKILL.md`, parses metadata, and reads enabled state from extensions_config.json
- **Injection**: Enabled skills listed in agent system prompt with container paths
- **Installation**: `POST /api/skills/install` extracts .skill ZIP archive to custom/ directory

### Model Factory (`packages/harness/nion/models/factory.py`)

- `create_chat_model(name, thinking_enabled)` instantiates LLM from config via reflection
- Supports `thinking_enabled` flag with per-model `when_thinking_enabled` overrides
- Supports `supports_vision` flag for image understanding models
- Config values starting with `$` resolved as environment variables
- Missing provider modules surface actionable install hints from reflection resolvers (for example `uv add langchain-google-genai`)

### Memory System (`packages/harness/nion/agents/memory/`)

OpenViking is the only online memory stack (no structured fallback, no legacy single-file read/write path).

**Components**:
- `policy.py` - Shared memory session policy resolution (`normal` vs `temporary_chat`, explicit read/write overrides)
- `core.py` / `openviking_provider.py` / `openviking_runtime.py` / `registry.py` - Single-provider memory core (provider fixed to `openviking`)
- `sqlite_index.py` - Local SQLite ledger (resource metadata, governance queue/state, vector/graph index)
- `queue.py` - Optional debounced session-commit queue
- `prompt.py` - Prompt templates for memory injection formatting
- `legacy_cleanup.py` - Startup cleanup for legacy single-file memory artifacts and old structured directories

**OpenViking API Surface**:
- `POST /api/openviking/query`
- `POST /api/openviking/store`
- `GET /api/openviking/items`
- `POST /api/openviking/forget` (hard delete)
- `POST /api/openviking/compact` (hard delete by ratio)
- `GET/POST /api/openviking/governance/*`
- `GET /api/openviking/retrieval/status`
- `POST /api/openviking/reindex-vectors`
- `POST /api/openviking/graph/query`
- `POST /api/openviking/session/commit`
- `GET /api/openviking/config`
- `GET /api/openviking/status`

**Hard-delete Contract**:
1. `forget/compact` first call OpenViking `rm(uri)` to delete remote memory.
2. Only after remote deletion succeeds, local SQLite ledger changes are committed.
3. If remote deletion fails, local state is not committed.

### Heartbeat System (`app/heartbeat/`)

**Purpose**: Semantic layer on top of scheduler for assistant rhythm and periodic maintenance tasks.

**Components**:
- `models.py` - Data models (HeartbeatTemplate, HeartbeatSettings, HeartbeatLogRecord)
- `templates.py` - Four default templates (daily_review, weekly_reset, memory_maintenance, identity_check)
- `store.py` - Thread-safe storage with atomic writes (temp file + rename)
- `executor.py` - Execution engine integrating Memory Core and Soul Core
- `service.py` - Service layer with singleton pattern

**Default Templates**:
- `daily_review` - Daily 21:00, read_write memory, generates daily summary
- `weekly_reset` - Sunday 19:00, read_write memory, generates weekly insights
- `memory_maintenance` - Monday 02:00, calls Memory Core maintenance (usage/compact/rebuild)
- `identity_check` - Monthly 1st 10:00, calls Soul Core summarizer (suggestions only)

**API Endpoints** (`/api/heartbeat`):
- `GET/PUT /settings` - Get/update heartbeat settings
- `GET /templates` - List available templates
- `POST /bootstrap` - Bootstrap scheduler tasks from templates
- `GET /logs` - Get execution logs
- `POST /execute/{template_id}` - Manual execution
- `GET /status` - Get heartbeat status

**Storage** (`backend/.nion/heartbeat/`):
- `settings.json` - Heartbeat configuration
- `logs/` - Execution logs by date

### Evolution System (`app/evolution/`)

**Purpose**: Low-frequency reflection and suggestion layer based on Heartbeat logs, Memory stats, and Soul assets.

**Components**:
- `models.py` - Data models (EvolutionReport, EvolutionSuggestion, EvolutionSettings)
- `analyzer.py` - Analyzer generating three types of suggestions
- `store.py` - Thread-safe storage with atomic writes, suggestions stored by status
- `service.py` - Service layer with singleton pattern

**Suggestion Types**:
- `MEMORY` - Memory compression suggestions (triggers when entry_count > 200)
- `SOUL` - Soul asset completeness (checks for SOUL.md/IDENTITY.md existence)
- `AGENT` - Agent stability suggestions (analyzes Heartbeat failure rates)

**Suggestion Flow**:
- Status: `pending` → `accepted` / `dismissed`
- Default action: `suggest_only` (never auto-apply)
- Priority levels: `LOW`, `MEDIUM`, `HIGH`

**API Endpoints** (`/api/evolution`):
- `POST /run` - Run Evolution analysis manually
- `GET/PUT /settings` - Get/update Evolution settings
- `GET /reports` - Get report list
- `GET /reports/{report_id}` - Get specific report
- `GET /suggestions` - Get suggestions (filterable by status)
- `POST /suggestions/{id}/dismiss` - Dismiss suggestion
- `POST /suggestions/{id}/accept` - Accept suggestion (does not auto-apply)

**Storage** (`backend/.nion/evolution/`):
- `settings.json` - Evolution configuration
- `reports/` - Analysis reports by date
- `suggestions/pending/` - Pending suggestions
- `suggestions/accepted/` - Accepted suggestions
- `suggestions/dismissed/` - Dismissed suggestions

**Design Principles**:
- Low-frequency operation (manual trigger or scheduled)
- Suggest-only, never auto-apply
- Auditable and reversible
- Can be globally disabled via settings

### Reflection System (`packages/harness/nion/reflection/`)

- `resolve_variable(path)` - Import module and return variable (e.g., `module.path:variable_name`)
- `resolve_class(path, base_class)` - Import and validate class against base class

### Config Schema

**`config.yaml`** key sections:
- `models[]` - LLM configs with `use` class path, `supports_thinking`, `supports_vision`, provider-specific fields
- `tools[]` - Tool configs with `use` variable path and `group`
- `tool_groups[]` - Logical groupings for tools
- `sandbox.use` - Sandbox provider class path
- `skills.path` / `skills.container_path` - Host and container paths to skills directory
- `title` - Auto-title generation (enabled, max_words, max_chars, prompt_template)
- `summarization` - Context summarization (enabled, trigger conditions, keep policy)
- `subagents.enabled` - Master switch for subagent delegation
- `memory` - OpenViking memory system (enabled, debounce_seconds, model_name, max_facts, fact_confidence_threshold, injection_enabled, max_injection_tokens, retrieval/rerank, graph)

**`extensions_config.json`**:
- `mcpServers` - Map of server name → config (enabled, type, command, args, env, url, headers, oauth, description)
- `skills` - Map of skill name → state (enabled)

Both can be modified at runtime via Gateway API endpoints or `NionClient` methods.

### Embedded Client (`packages/harness/nion/client.py`)

`NionClient` provides direct in-process access to all Nion capabilities without HTTP services. All return types align with the Gateway API response schemas, so consumer code works identically in HTTP and embedded modes.

**Architecture**: Imports the same harness modules (`nion.*`) that LangGraph Server and Gateway API depend on. Shares the same config files and data directories. No FastAPI dependency.

**Agent Conversation** (replaces LangGraph Server):
- `chat(message, thread_id, **kwargs)` — synchronous, returns final text; supports per-call `session_mode` / `memory_read` / `memory_write` overrides
- `stream(message, thread_id, **kwargs)` — yields `StreamEvent` aligned with LangGraph SSE protocol and supports embedded memory session fields via constructor defaults or per-call overrides:
  - `"values"` — full state snapshot (title, messages, artifacts)
  - `"messages-tuple"` — per-message update (AI text, tool calls, tool results)
  - `"end"` — stream finished
- Agent created lazily via `create_agent()` + `_build_middlewares()`, same as `make_lead_agent`
- Embedded mode now preserves the full resolved `config.configurable` payload when streaming so per-call model selection and memory session flags behave the same as web chat; `context` still carries middleware-facing runtime fields, and omitted memory session fields are rehydrated from the checkpointer on later turns before rebuilding the cached prompt
- Supports `checkpointer` parameter for state persistence across turns
- `reset_agent()` forces agent recreation (e.g. after memory or skill changes)
- Internal agent cache key includes memory session fields so prompt injection policy cannot be reused across mismatched embedded sessions

**Gateway Equivalent Methods** (replaces Gateway API):

| Category | Methods | Return format |
|----------|---------|---------------|
| Models | `list_models()`, `get_model(name)` | `{"models": [...]}`, `{name, display_name, ...}` |
| MCP | `get_mcp_config()`, `update_mcp_config(servers)` | `{"mcp_servers": {...}}` |
| Skills | `list_skills()`, `get_skill(name)`, `update_skill(name, enabled)`, `install_skill(path)` | `{"skills": [...]}` |
| Memory | `get_memory()`, `reload_memory()`, `get_memory_config()`, `get_memory_status()` | dict |
| Uploads | `upload_files(thread_id, files)`, `list_uploads(thread_id)`, `delete_upload(thread_id, filename)` | `{"success": true, "files": [...]}`, `{"files": [...], "count": N}` |
| Artifacts | `get_artifact(thread_id, path)` → `(bytes, mime_type)` | tuple |

**Key difference from Gateway**: Upload accepts local `Path` objects instead of HTTP `UploadFile`. Artifact returns `(bytes, mime_type)` instead of HTTP Response. `update_mcp_config()` and `update_skill()` automatically invalidate the cached agent.

**Tests**: `tests/test_client.py` (77 unit tests including `TestGatewayConformance`), `tests/test_client_live.py` (live integration tests, requires config.yaml)

**Gateway Conformance Tests** (`TestGatewayConformance`): Validate that every dict-returning client method conforms to the corresponding Gateway Pydantic response model. Each test parses the client output through the Gateway model — if Gateway adds a required field that the client doesn't provide, Pydantic raises `ValidationError` and CI catches the drift. Covers: `ModelsListResponse`, `ModelResponse`, `SkillsListResponse`, `SkillResponse`, `SkillInstallResponse`, `McpConfigResponse`, `UploadResponse`, `MemoryConfigResponse`, `MemoryStatusResponse`.

## Development Workflow

### Test-Driven Development (TDD) — MANDATORY

**Every new feature or bug fix MUST be accompanied by unit tests. No exceptions.**

- Write tests in `backend/tests/` following the existing naming convention `test_<feature>.py`
- Run the full suite before and after your change: `make test`
- Tests must pass before a feature is considered complete
- For lightweight config/utility modules, prefer pure unit tests with no external dependencies
- If a module causes circular import issues in tests, add a `sys.modules` mock in `tests/conftest.py` (see existing example for `nion.subagents.executor`)

```bash
# Run all tests
make test

# Run a specific test file
PYTHONPATH=. uv run pytest tests/test_<feature>.py -v
```

### Running the Full Application

From the **project root** directory:
```bash
make dev
```

This starts all services and makes the application available at `http://localhost:2026`.

**Nginx routing**:
- Browser `/api/*` → Gateway API (8001)
- Browser `/` (non-API) → Frontend (3000)
- Gateway internal `/api/langgraph/*` → LangGraph Server (2024)

### Running Backend Services Separately

From the **backend** directory:

```bash
# Terminal 1: LangGraph server
make dev

# Terminal 2: Gateway API
make gateway
```

Direct access (without nginx):
- LangGraph: `http://localhost:2024`
- Gateway: `http://localhost:8001`

### Frontend Configuration

The frontend uses environment variables to connect to backend services:
- `NEXT_PUBLIC_LANGGRAPH_BASE_URL` - Recommended to point at Gateway facade, e.g. `http://localhost:8001/api/langgraph`
- `NEXT_PUBLIC_BACKEND_BASE_URL` - Recommended to point at Gateway, e.g. `http://localhost:8001`

When using `make dev` from root, nginx remains the web entry point, but browser API traffic should still converge on Gateway.

## Key Features

### File Upload

Multi-file upload with automatic document conversion:
- Endpoint: `POST /api/threads/{thread_id}/uploads`
- Supports: PDF, PPT, Excel, Word documents (converted via `markitdown`)
- Files stored in thread-isolated directories
- Agent receives uploaded file list via `UploadsMiddleware`

See [docs/FILE_UPLOAD.md](docs/FILE_UPLOAD.md) for details.

### Plan Mode

TodoList middleware for complex multi-step tasks:
- Controlled via runtime config: `config.configurable.is_plan_mode = True`
- Provides `write_todos` tool for task tracking
- One task in_progress at a time, real-time updates

See [docs/plan_mode_usage.md](docs/plan_mode_usage.md) for details.

### Context Summarization

Automatic conversation summarization when approaching token limits:
- Configured in `config.yaml` under `summarization` key
- Trigger types: tokens, messages, or fraction of max input
- Keeps recent messages while summarizing older ones

See [docs/summarization.md](docs/summarization.md) for details.

### Vision Support

For models with `supports_vision: true`:
- `ViewImageMiddleware` processes images in conversation
- `view_image_tool` added to agent's toolset
- Images automatically converted to base64 and injected into state

## Code Style

- Uses `ruff` for linting and formatting
- Line length: 240 characters
- Python 3.12+ with type hints
- Double quotes, space indentation

## Documentation

See `docs/` directory for detailed documentation:
- [CONFIGURATION.md](docs/CONFIGURATION.md) - Configuration options
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Architecture details
- [API.md](docs/API.md) - API reference
- [SETUP.md](docs/SETUP.md) - Setup guide
- [FILE_UPLOAD.md](docs/FILE_UPLOAD.md) - File upload feature
- [PATH_EXAMPLES.md](docs/PATH_EXAMPLES.md) - Path types and usage
- [summarization.md](docs/summarization.md) - Context summarization
- [plan_mode_usage.md](docs/plan_mode_usage.md) - Plan mode with TodoList

## Channel Session Overrides

- Gateway / HTTP channels persist session defaults in `channel_integrations.session_json`.
- Per-user channel overrides persist in `channel_authorized_users.session_override_json`.
- Runtime resolution priority is `authorized_user.session_override` > `integration.session` > bridge base defaults.
- The channel bridge only force-injects `context.thread_id`, `context.workspace_id`, `context.user_id`, and `context.locale`; optional session fields are appended only when explicitly configured.
- For HTTP/SDK requests, runtime fields should use the `context` lane. The embedded direct-runtime path may still keep `configurable.thread_id` when checkpointer compatibility requires it.
- Local sandbox `read_file`, `write_file`, and `update_file` must rethrow file errors with the caller-requested logical path instead of the resolved host path.
