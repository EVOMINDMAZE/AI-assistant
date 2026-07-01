"""Pydantic request/response models for the memory service API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Chat-memory endpoints ─────────────────────────────

class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class AddMemoryRequest(BaseModel):
    user_id: str
    messages: list[Message] = Field(..., min_length=1)
    metadata: dict[str, Any] | None = None


class SearchMemoryRequest(BaseModel):
    user_id: str
    query: str
    limit: int = 5
    threshold: float = 0.3


class MemoryHit(BaseModel):
    id: str | None = None
    memory: str
    score: float | None = None
    metadata: dict[str, Any] | None = None


# ── Document endpoints ────────────────────────────────

class SearchDocumentsRequest(BaseModel):
    user_id: str
    query: str
    limit: int = 5


class DocumentHit(BaseModel):
    doc_id: str
    chunk_index: int
    text: str
    score: float
    filename: str | None = None


# ── Generic ──────────────────────────────────────────

class StatusResponse(BaseModel):
    status: str
    mem0_loaded: bool
    qdrant_ok: bool
    embedder_loaded: bool
    user_id: str
