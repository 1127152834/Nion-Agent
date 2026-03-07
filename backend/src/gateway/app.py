import logging
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.channels.event_broker import ChannelEventBroker
from src.channels.repository import ChannelRepository
from src.channels.runtime_manager import ChannelRuntimeManager
from src.config.app_config import get_app_config
from src.config.paths import get_paths
from src.gateway.config import get_gateway_config
from src.gateway.routers import (
    agents,
    artifact_groups,
    artifacts,
    channels,
    config,
    embedding_models,
    mcp,
    memory,
    models,
    retrieval_models,
    rss,
    scheduler,
    skills,
    uploads,
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
        get_app_config()
        logger.info("Configuration loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load configuration: {e}")
        sys.exit(1)
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

LangGraph requests are handled by nginx reverse proxy.
This gateway provides custom endpoints for models, MCP configuration, skills, and artifacts.
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
                "name": "agents",
                "description": "Create and manage custom agents with per-agent config and prompts",
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
                "name": "embedding-models",
                "description": "Manage embedding models for memory system vector search",
            },
            {
                "name": "retrieval-models",
                "description": "Manage retrieval models (embedding + rerank) for memory system",
            },
            {
                "name": "health",
                "description": "Health check and system status endpoints",
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

    # Agents API is mounted at /api/agents
    app.include_router(agents.router)

    # RSS API is mounted at /api/rss
    app.include_router(rss.router)

    # Channels API is mounted at /api/channels
    app.include_router(channels.router)

    # Scheduler API is mounted at /api/scheduler
    app.include_router(scheduler.router)

    # Embedding models API is mounted at /api/embedding-models
    app.include_router(embedding_models.router)

    # Retrieval models API is mounted at /api/retrieval-models
    app.include_router(retrieval_models.router)

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
