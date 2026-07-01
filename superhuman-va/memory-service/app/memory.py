"""Thin async wrapper around the Mem0 `Memory` client.

Mem0 itself is async-by-default in v1.0+, so we don't need a threadpool.
This module just centralises the construction and exposes the small
surface our FastAPI routes need.
"""

from __future__ import annotations

import logging
from typing import Any

from mem0 import Memory

from .config import Settings, mem0_config

logger = logging.getLogger(__name__)


class MemoryService:
    def __init__(self, settings: Settings):
        self.settings = settings
        logger.info("Initialising Mem0 (llm=deepseek, embedder=fastembed) ...")
        self._memory: Memory = Memory.from_config(mem0_config(settings))
        logger.info("Mem0 ready.")

    # ── Add ────────────────────────────────────────────

    async def add(
        self,
        user_id: str,
        messages: list[dict[str, str]],
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = await self._memory.add(
            messages=messages,
            user_id=user_id,
            metadata=metadata or {},
        )
        return result if isinstance(result, dict) else {"results": result}

    # ── Search ─────────────────────────────────────────

    async def search(
        self,
        user_id: str,
        query: str,
        limit: int = 5,
        threshold: float = 0.3,
    ) -> list[dict[str, Any]]:
        result = await self._memory.search(
            query=query,
            user_id=user_id,
            limit=limit,
            threshold=threshold,
        )
        # Mem0 returns {"results": [...]} or just a list depending on version
        items = result.get("results", result) if isinstance(result, dict) else result
        return [
            {
                "id": item.get("id"),
                "memory": item.get("memory") or item.get("text", ""),
                "score": item.get("score"),
                "metadata": item.get("metadata"),
            }
            for item in (items or [])
        ]

    # ── List / delete ──────────────────────────────────

    async def list_all(self, user_id: str) -> list[dict[str, Any]]:
        result = await self._memory.get_all(user_id=user_id)
        items = result.get("results", result) if isinstance(result, dict) else result
        return list(items or [])

    async def delete_all(self, user_id: str) -> dict[str, Any]:
        result = await self._memory.delete_all(user_id=user_id)
        return result if isinstance(result, dict) else {"results": result}
