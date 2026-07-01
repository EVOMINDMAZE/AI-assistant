# syntax=docker/dockerfile:1.7

# ── Stage 1: install deps and pre-download the embedder ──
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# Pre-download the embedding model so the container is self-contained
# and the first request doesn't pay the model download cost.
RUN /install/bin/python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

# ── Stage 2: slim runtime image ────────────────────────
FROM python:3.11-slim AS runtime

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface \
    PATH="/install/bin:${PATH}" \
    PYTHONPATH="/install/lib/python3.11/site-packages"

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 app

WORKDIR /app

# Copy installed packages + pre-downloaded model from builder
COPY --from=builder /install /install
COPY --from=builder /app/.cache /app/.cache

# Copy app source
COPY app ./app

# Pre-create HF cache dir with correct ownership
RUN mkdir -p /app/.cache/huggingface && chown -R app:app /app

USER app

EXPOSE 8000

# Liveness probe used by docker-compose healthcheck
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
