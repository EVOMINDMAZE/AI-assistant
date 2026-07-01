"""Shared Qdrant client + a tiny FastEmbed wrapper for raw document RAG.

Mem0 owns the `memories` collection; this module owns the `documents`
collection so we can do classic RAG (chunk → embed → store → cosine
search) on top of user uploads. The embedder MUST be the same model
Mem0 uses, otherwise the two collections are not in the same vector
space and cross-search would be meaningless.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastembed import TextEmbedding
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from .config import Settings, get_settings

logger = logging.getLogger(__name__)


class DocumentStore:
    """Wraps the Qdrant `documents` collection and the FastEmbed model.

    The embedder is intentionally not the same object Mem0 uses internally
    (Mem0 instantiates its own). They are the same *model*, so the vector
    space matches.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            timeout=30,
        )
        logger.info("Loading embedder model %s ...", settings.embed_model)
        self.embedder = TextEmbedding(model_name=settings.embed_model)
        logger.info("Embedder loaded.")
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        existing = {c.name for c in self.client.get_collections().collections}
        if self.settings.documents_collection in existing:
            return
        logger.info(
            "Creating Qdrant collection %s (dims=%d) ...",
            self.settings.documents_collection,
            self.settings.embed_dims,
        )
        self.client.create_collection(
            collection_name=self.settings.documents_collection,
            vectors_config=qmodels.VectorParams(
                size=self.settings.embed_dims,
                distance=qmodels.Distance.COSINE,
            ),
        )
        # Index for user_id filtering
        self.client.create_payload_index(
            collection_name=self.settings.documents_collection,
            field_name="user_id",
            field_schema=qmodels.PayloadSchemaType.KEYWORD,
        )

    # ── Ingest ─────────────────────────────────────────

    def ingest(
        self,
        user_id: str,
        filename: str,
        chunks: list[str],
    ) -> dict[str, Any]:
        """Embed each chunk and upsert into Qdrant. Returns a summary."""
        if not chunks:
            return {"doc_id": None, "chunks_created": 0}

        doc_id = uuid.uuid4().hex
        # FastEmbed is a generator; materialise to list once.
        vectors = list(self.embedder.embed(chunks))
        points = [
            qmodels.PointStruct(
                id=uuid.uuid4().hex,
                vector=vec.tolist(),
                payload={
                    "user_id": user_id,
                    "doc_id": doc_id,
                    "filename": filename,
                    "chunk_index": i,
                    "text": chunk,
                },
            )
            for i, (chunk, vec) in enumerate(zip(chunks, vectors))
        ]
        self.client.upsert(
            collection_name=self.settings.documents_collection,
            points=points,
            wait=True,
        )
        return {"doc_id": doc_id, "chunks_created": len(points)}

    # ── Search ─────────────────────────────────────────

    def search(self, user_id: str, query: str, limit: int = 5) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        qvec = list(self.embedder.embed([query]))[0].tolist()
        result = self.client.search(
            collection_name=self.settings.documents_collection,
            query_vector=qvec,
            limit=limit,
            query_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="user_id",
                        match=qmodels.MatchValue(value=user_id),
                    )
                ]
            ),
            with_payload=True,
        )
        return [
            {
                "doc_id": (p.payload or {}).get("doc_id", ""),
                "chunk_index": (p.payload or {}).get("chunk_index", 0),
                "text": (p.payload or {}).get("text", ""),
                "filename": (p.payload or {}).get("filename"),
                "score": p.score,
            }
            for p in result
        ]

    def list_documents(self, user_id: str) -> list[dict[str, Any]]:
        """Return distinct documents uploaded by this user (by doc_id)."""
        records, _ = self.client.scroll(
            collection_name=self.settings.documents_collection,
            scroll_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="user_id",
                        match=qmodels.MatchValue(value=user_id),
                    )
                ]
            ),
            limit=1000,
            with_payload=True,
            with_vectors=False,
        )
        seen: dict[str, dict[str, Any]] = {}
        for r in records:
            doc_id = (r.payload or {}).get("doc_id")
            if not doc_id or doc_id in seen:
                continue
            seen[doc_id] = {
                "doc_id": doc_id,
                "filename": (r.payload or {}).get("filename"),
                "chunks": 0,
            }
        # Count chunks per doc with a second pass
        for r in records:
            doc_id = (r.payload or {}).get("doc_id")
            if doc_id in seen:
                seen[doc_id]["chunks"] += 1
        return list(seen.values())

    def healthcheck(self) -> bool:
        try:
            self.client.get_collections()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Qdrant healthcheck failed: %s", exc)
            return False
