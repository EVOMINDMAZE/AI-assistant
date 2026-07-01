"""FastAPI router for document ingest + search.

- POST /ingest_document   multipart upload (file + user_id form field)
- POST /search_documents  JSON body
- GET  /list_documents    per user
- DELETE /delete_document removes all chunks for a given doc_id
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from qdrant_client.http import models as qmodels

from ..documents import chunk_text, extract_text
from ..schemas import SearchDocumentsRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["documents"])

# 10 MB cap — large enough for a fat PDF, small enough to not OOM the box.
MAX_FILE_BYTES = 10 * 1024 * 1024


@router.post("/ingest_document")
async def ingest_document(
    request: Request,
    user_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    raw = await file.read()
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    text = extract_text(file.filename or "upload", raw)
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(
            status_code=400,
            detail="No extractable text in file. (Scanned PDFs need OCR.)",
        )

    summary = request.app.state.docstore.ingest(
        user_id=user_id,
        filename=file.filename or "upload",
        chunks=chunks,
    )
    return {
        **summary,
        "filename": file.filename,
        "chars_extracted": len(text),
    }


@router.post("/search_documents")
async def search_documents(
    request: Request, body: SearchDocumentsRequest
) -> dict[str, Any]:
    try:
        results = request.app.state.docstore.search(
            user_id=body.user_id,
            query=body.query,
            limit=body.limit,
        )
        return {"results": results}
    except Exception as exc:  # noqa: BLE001
        logger.exception("search_documents failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/list_documents")
async def list_documents(
    request: Request,
    user_id: str = Query(...),
) -> dict[str, Any]:
    try:
        return {"results": request.app.state.docstore.list_documents(user_id=user_id)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("list_documents failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/delete_document")
async def delete_document(
    request: Request,
    user_id: str = Query(...),
    doc_id: str = Query(...),
) -> dict[str, Any]:
    try:
        client = request.app.state.docstore.client
        client.delete(
            collection_name=request.app.state.settings.documents_collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="user_id",
                            match=qmodels.MatchValue(value=user_id),
                        ),
                        qmodels.FieldCondition(
                            key="doc_id",
                            match=qmodels.MatchValue(value=doc_id),
                        ),
                    ]
                )
            ),
        )
        return {"deleted": doc_id}
    except Exception as exc:  # noqa: BLE001
        logger.exception("delete_document failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
