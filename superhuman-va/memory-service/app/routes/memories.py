"""FastAPI router for the Mem0 chat-memory endpoints.

All routes are POST/GET/DELETE, not streaming. The Next.js side handles
streaming the LLM response; memory I/O is bounded and async.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..schemas import AddMemoryRequest, SearchMemoryRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["memories"])


def _memory(request: Request):
    return request.app.state.memory


@router.post("/add_memory")
async def add_memory(body: AddMemoryRequest) -> dict[str, Any]:
    try:
        messages = [m.model_dump() for m in body.messages]
        return await _memory(request).add(
            user_id=body.user_id,
            messages=messages,
            metadata=body.metadata,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("add_memory failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/search_memory")
async def search_memory(body: SearchMemoryRequest) -> dict[str, Any]:
    try:
        results = await _memory(request).search(
            user_id=body.user_id,
            query=body.query,
            limit=body.limit,
            threshold=body.threshold,
        )
        return {"results": results}
    except Exception as exc:  # noqa: BLE001
        logger.exception("search_memory failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/list_memories")
async def list_memories(
    request: Request,
    user_id: str = Query(...),
) -> dict[str, Any]:
    try:
        items = await _memory(request).list_all(user_id=user_id)
        return {"results": items}
    except Exception as exc:  # noqa: BLE001
        logger.exception("list_memories failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/clear_memories")
async def clear_memories(
    request: Request,
    user_id: str = Query(...),
) -> dict[str, Any]:
    try:
        return await _memory(request).delete_all(user_id=user_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("clear_memories failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
