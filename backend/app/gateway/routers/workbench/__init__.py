"""Workbench runtime APIs: command sessions, plugin tests, marketplace, and plugin studio.

This package combines all sub-routers into the top-level names expected by
``app.gateway.app`` so that existing imports remain unchanged::

    from app.gateway.routers import workbench
    app.include_router(workbench.router)
    app.include_router(workbench.plugin_router)
    app.include_router(workbench.marketplace_router)
    app.include_router(workbench.plugin_studio_router)
"""

from app.gateway.routers.workbench.marketplace import router as marketplace_router
from app.gateway.routers.workbench.plugin_studio import router as plugin_studio_router
from app.gateway.routers.workbench.plugins import router as plugin_router
from app.gateway.routers.workbench.sessions import router as router

__all__ = [
    "router",
    "plugin_router",
    "marketplace_router",
    "plugin_studio_router",
]
