"""FastAPI entrypoint for the memory service.

Lifespan boots three long-lived objects and stashes them on app.state:
- `memory`   → Mem0 client (LLM=DeepSeek, embedder=FastEmbed, store=Qdrant)
- `docstore` → raw Qdrant client + FastEmbed for the `documents` collection
- `settings` → pydantic settings singleton

Routes are mounted in `routes/`.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .memory import MemoryService
from .qdrant_client import DocumentStore
from .routes import documents as documents_routes
from .routes import memories as memories_routes
from .schemas import StatusResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("memory-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings

    logger.info("Booting memory service ...")
    app.state.memory = MemoryService(settings)
    app.state.docstore = DocumentStore(settings)
    logger.info("Memory service ready (user_id=%s)", settings.user_id)
    try:
        yield
    finally:
        logger.info("Shutting down memory service.")


app = FastAPI(
    title="Superhuman VA — Memory Service",
    version="0.1.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(memories_routes.router)
app.include_router(documents_routes.router)


@app.get("/health", response_model=StatusResponse)
async def health() -> StatusResponse:
    mem0_loaded = hasattr(app.state, "memory") and app.state.memory is not None
    embedder_loaded = (
        hasattr(app.state, "docstore")
        and app.state.docstore is not None
        and getattr(app.state.docstore, "embedder", None) is not None
    )
    qdrant_ok = (
        embedder_loaded
        and app.state.docstore.healthcheck()
    )
    return StatusResponse(
        status="ok" if (mem0_loaded and qdrant_ok) else "degraded",
        mem0_loaded=mem0_loaded,
        qdrant_ok=qdrant_ok,
        embedder_loaded=embedder_loaded,
        user_id=app.state.settings.user_id,
    )


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "superhuman-va memory-service",
        "docs": "/docs",
        "health": "/health",
    }
