"""Document parsing + chunking helpers.

Two file types supported by default:
- PDF   → pypdf
- txt/md → plain read

Output is a list of text chunks. We use a simple char-window chunker
instead of pulling in langchain, to keep the dependency surface small.
"""

from __future__ import annotations

import io
import logging
from typing import Iterable

logger = logging.getLogger(__name__)

# Default chunking parameters — overlap helps retrieval when a fact
# straddles two chunks.
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 200


def extract_text(filename: str, raw: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        return _extract_pdf(raw)
    # Treat everything else as UTF-8 text (txt, md, markdown, log, csv, etc.)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="ignore")


def _extract_pdf(raw: bytes) -> str:
    # Imported lazily so non-PDF workflows don't pay the cost.
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    parts: list[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception as exc:  # noqa: BLE001
            logger.warning("PDF page extract failed: %s", exc)
    return "\n\n".join(parts)


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    if chunk_size <= 0:
        return [text]
    overlap = max(0, min(overlap, chunk_size - 1))
    step = chunk_size - overlap

    out: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        chunk = text[start:end].strip()
        if chunk:
            out.append(chunk)
        if end == n:
            break
        start += step
    return out
