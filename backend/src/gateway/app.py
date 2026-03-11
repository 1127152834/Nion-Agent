import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.channels.event_broker import ChannelEventBroker
from src.channels.repository import ChannelRepository
from src.channels.runtime_manager import ChannelRuntimeManager
from src.agents.memory.legacy_cleanup import ensure_legacy_memory_removed
from src.config.app_config import get_app_config
from src.config.default_agent import ensure_default_agent
from src.config.paths import get_paths
from src.gateway.config import get_gateway_config
from src.gateway.routers import (
    agents,
    artifact_groups,
    artifacts,
    channels,
    config,
    embedding_models,
    evolution,
    heartbeat,
    langgraph_proxy,
    mcp,
    memory,
    models,
    retrieval_models,
    rss,
    runtime_profile,
    runtime_topology,
    scheduler,
    skills,
    suggestions,
    tools,
    uploads,
    workbench,
    workspace,
)
from src.scheduler.service import shutdown_scheduler, startup_scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""

    app.state.channel_event_broker = ChannelEventBroker()
    app.state.channel_runtime_manager = None
    app.state.channel_runtime_error = None

    # Load config and check necessary environment variables at startup
    try:
        get_app_config(process_name="gateway")
        logger.info("Configuration loaded successfully")
    except Exception as e:
        error_msg = f"Failed to load configuration during gateway startup: {e}"
        logger.exception(error_msg)
        raise RuntimeError(error_msg) from e

    # Initialize default agent
    try:
        ensure_default_agent()
        logger.info("Default agent initialized")
    except Exception as e:
        logger.warning(f"Failed to initialize default agent (non-blocking): {e}")

    # Hard-cut migration policy: remove legacy memory.json files on startup.
    try:
        ensure_legacy_memory_removed()
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to remove legacy memory.json files (non-blocking): %s", e)

    config = get_gateway_config()
    logger.info(f"Starting API Gateway on {config.host}:{config.port}")
    startup_scheduler()
    logger.info("Scheduler service started")

    try:
        channel_repo = ChannelRepository(paths=get_paths())
        channel_repo.init_schema()
        channel_runtime_manager = ChannelRuntimeManager(repo=channel_repo)
        channel_runtime_manager.start()
        app.state.channel_runtime_manager = channel_runtime_manager
    except Exception as error:
        app.state.channel_runtime_error = str(error)
        logger.warning("Channel runtime manager startup failed (non-blocking): %s", error)

    # NOTE: MCP tools initialization is NOT done here because:
    # 1. Gateway doesn't use MCP tools - they are used by Agents in the LangGraph Server
    # 2. Gateway and LangGraph Server are separate processes with independent caches
    # MCP tools are lazily initialized in LangGraph Server when first needed

    yield
    channel_runtime_manager = getattr(app.state, "channel_runtime_manager", None)
    if isinstance(channel_runtime_manager, ChannelRuntimeManager):
        channel_runtime_manager.stop()
        app.state.channel_runtime_manager = None

    shutdown_scheduler()
    logger.info("Scheduler service stopped")
    logger.info("Shutting down API Gateway")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Configured FastAPI application instance.
    """

    app = FastAPI(
        title="Nion API Gateway",
        description="""
## Nion API Gateway

API Gateway for Nion - A LangGraph-based AI agent backend with sandbox execution capabilities.

### Features

- **Models Management**: Query and retrieve available AI models
- **MCP Configuration**: Manage Model Context Protocol (MCP) server configurations
- **Memory Management**: Access and manage global memory data for personalized conversations
- **Skills Management**: Query and manage skills and their enabled status
- **Artifacts**: Access thread artifacts and generated files
- **Health Monitoring**: System health check endpoints

### Architecture

Gateway is the single backend facade for frontend HTTP traffic.
It proxies LangGraph streaming requests and also provides custom endpoints for models, MCP configuration, skills, artifacts, workspace, and diagnostics.
        """,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=[
            {
                "name": "config",
                "description": "Manage application configuration with version control",
            },
            {
                "name": "models",
                "description": "Operations for querying available AI models and their configurations",
            },
            {
                "name": "mcp",
                "description": "Manage Model Context Protocol (MCP) server configurations",
            },
            {
                "name": "memory",
                "description": "Access and manage global memory data for personalized conversations",
            },
            {
                "name": "skills",
                "description": "Manage skills and their configurations",
            },
            {
                "name": "artifacts",
                "description": "Access and download thread artifacts and generated files",
            },
            {
                "name": "uploads",
                "description": "Upload and manage user files for threads",
            },
            {
                "name": "runtime-profile",
                "description": "Thread runtime execution profile (sandbox/host mode)",
            },
            {
                "name": "agents",
                "description": "Create and manage custom agents with per-agent config and prompts",
            },
            {
                "name": "runtime",
                "description": "Inspect runtime topology and active network facade configuration",
            },
            {
                "name": "rss",
                "description": "RSS feed subscription, refresh and entry management",
            },
            {
                "name": "channels",
                "description": "Message channel integration for Lark and DingTalk",
            },
            {
                "name": "scheduler",
                "description": "Scheduled tasks with cron/interval/event triggers and workflow execution",
            },
            {
                "name": "tools",
                "description": "Tool provider probe and diagnostics endpoints",
            },
            {
                "name": "embedding-models",
                "description": "Manage embedding models for memory system vector search",
            },
            {
                "name": "retrieval-models",
                "description": "Manage retrieval models (embedding + rerank) for memory system",
            },
            {
                "name": "suggestions",
                "description": "Generate follow-up question suggestions for conversations",
            },
            {
                "name": "health",
                "description": "Health check and system status endpoints",
            },
            {
                "name": "workspace",
                "description": "Thread workspace tree APIs for /mnt/user-data browsing",
            },
            {
                "name": "workbench",
                "description": "Workbench plugin runtime, command sessions and compatibility tests",
            },
        ],
    )

    # Keep CORS at app-level so local frontend can call gateway directly
    # (e.g., http://localhost:3000 -> http://localhost:8001) without nginx.
    gateway_config = get_gateway_config()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=gateway_config.cors_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    # Config API is mounted at /api/config
    app.include_router(config.router)

    # Models API is mounted at /api/models
    app.include_router(models.router)

    # LangGraph proxy API is mounted at /api/langgraph/*
    # (desktop runtime does not run nginx)
    app.include_router(langgraph_proxy.router)

    # MCP API is mounted at /api/mcp
    app.include_router(mcp.router)

    # Memory API is mounted at /api/memory
    app.include_router(memory.router)

    # Skills API is mounted at /api/skills
    app.include_router(skills.router)

    # Artifacts API is mounted at /api/threads/{thread_id}/artifacts
    app.include_router(artifacts.router)

    # Artifact groups API is mounted at /api/threads/{thread_id}/artifact-groups
    app.include_router(artifact_groups.router)

    # Uploads API is mounted at /api/threads/{thread_id}/uploads
    app.include_router(uploads.router)

    # Runtime profile API is mounted at /api/threads/{thread_id}/runtime-profile
    app.include_router(runtime_profile.router)

    # Runtime topology API is mounted at /api/runtime/topology
    app.include_router(runtime_topology.router)

    # Agents API is mounted at /api/agents
    app.include_router(agents.router)

    # RSS API is mounted at /api/rss
    app.include_router(rss.router)

    # Channels API is mounted at /api/channels
    app.include_router(channels.router)

    # Scheduler API is mounted at /api/scheduler
    app.include_router(scheduler.router)

    # Heartbeat API is mounted at /api/heartbeat
    app.include_router(heartbeat.router)

    # Evolution API is mounted at /api/evolution
    app.include_router(evolution.router)


    # Tools API is mounted at /api/tools
    app.include_router(tools.router)

    # Embedding models API is mounted at /api/embedding-models
    app.include_router(embedding_models.router)

    # Retrieval models API is mounted at /api/retrieval-models
    app.include_router(retrieval_models.router)

    # Suggestions API is mounted at /api/threads/{thread_id}/suggestions
    app.include_router(suggestions.router)

    # Workspace tree API is mounted at /api/threads/{thread_id}/workspace
    app.include_router(workspace.router)

    # Workbench API is mounted at /api/threads/{thread_id}/workbench and /api/workbench/plugins/*
    app.include_router(workbench.router)
    app.include_router(workbench.plugin_router)
    app.include_router(workbench.marketplace_router)
    app.include_router(workbench.plugin_studio_router)

    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        """Health check endpoint.

        Returns:
            Service health status information.
        """
        return {"status": "healthy", "service": "nion-gateway"}

    return app


# Create app instance for uvicorn
app = create_app()
