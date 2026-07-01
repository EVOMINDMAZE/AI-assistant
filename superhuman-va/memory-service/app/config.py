"""Application settings and Mem0 configuration.

Mem0's `Memory.from_config` accepts three sub-sections: llm, embedder,
vector_store. We read everything from environment variables (injected by
docker-compose) so no secret ever lives in code.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── LLM ───────────────────────────────────────────
    deepseek_api_key: str = Field(default="", alias="DEEPSEEK_API_KEY")
    deepseek_base_url: str = Field(
        default="https://api.deepseek.com", alias="DEEPSEEK_BASE_URL"
    )
    deepseek_model: str = Field(default="deepseek-v4-pro", alias="DEEPSEEK_MODEL")

    # ── Identity ──────────────────────────────────────
    user_id: str = Field(default="local-user", alias="USER_ID")

    # ── Embedding ─────────────────────────────────────
    embed_model: str = Field(
        default="BAAI/bge-small-en-v1.5", alias="EMBED_MODEL"
    )
    embed_dims: int = Field(default=384, alias="EMBED_DIMS")

    # ── Qdrant ────────────────────────────────────────
    qdrant_host: str = Field(default="qdrant", alias="QDRANT_HOST")
    qdrant_port: int = Field(default=6333, alias="QDRANT_PORT")
    mem0_collection: str = Field(default="memories", alias="MEM0_COLLECTION")
    documents_collection: str = Field(
        default="documents", alias="DOCUMENTS_COLLECTION"
    )
    global_memory_collection: str = Field(
        default="memories_global", alias="GLOBAL_MEMORY_COLLECTION"
    )
    messages_collection: str = Field(
        default="messages", alias="MESSAGES_COLLECTION"
    )

    # ── PocketBase ────────────────────────────────────
    pocketbase_url: str = Field(
        default="http://pocketbase:8090", alias="POCKETBASE_URL"
    )
    pocketbase_admin_email: str = Field(
        default="", alias="POCKETBASE_ADMIN_EMAIL"
    )
    pocketbase_admin_password: str = Field(
        default="", alias="POCKETBASE_ADMIN_PASSWORD"
    )

    # ── HTTP ──────────────────────────────────────────
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def mem0_config(s: Settings) -> dict[str, Any]:
    """Build the dict that `Memory.from_config` expects.

    Embedder: `fastembed` runs a local sentence-transformer model. No
    OpenAI dependency. Dims MUST match the Qdrant collection.
    """
    return {
        "llm": {
            "provider": "deepseek",
            "config": {
                "model": s.deepseek_model,
                "api_key": s.deepseek_api_key,
                "deepseek_base_url": s.deepseek_base_url,
                "temperature": 0.0,
            },
        },
        "embedder": {
            "provider": "fastembed",
            "config": {
                "model": s.embed_model,
            },
        },
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "host": s.qdrant_host,
                "port": s.qdrant_port,
                "collection_name": s.mem0_collection,
                "embedding_model_dims": s.embed_dims,
            },
        },
    }


# Sensible default for the FastEmbed cache to live inside the image.
os.environ.setdefault("HF_HOME", "/app/.cache/huggingface")
os.environ.setdefault("HF_HUB_CACHE", "/app/.cache/huggingface")
