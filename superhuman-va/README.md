# Superhuman AI VA — Local MVP

A local AI Virtual Assistant with **persistent, superhuman memory**:
- Remembers facts from every past conversation (Mem0 + Qdrant)
- Recalls the contents of any PDF/text you upload (chunked RAG)
- Streams replies from DeepSeek
- Single-user, no login screen

## Architecture

```
┌─────────────────┐    SSE     ┌──────────────────┐
│   Next.js 14    │ ─────────▶ │   DeepSeek API   │
│  (chat UI +     │            │  (OpenAI-compat) │
│   API routes)   │            └──────────────────┘
└────────┬────────┘
         │ fetch
         ▼
┌─────────────────┐
│ memory-service  │   Mem0  ┌────────┐
│  (FastAPI)      │ ──────▶ │ Qdrant │  (vector store)
│  + FastEmbed    │         └────────┘
└────────┬────────┘
         │ admin
         ▼
┌─────────────────┐
│   PocketBase    │  (chat history, relational)
└─────────────────┘
```

All three backends run in Docker. Only Next.js runs on the host (`npm run dev`).

## Stack

| Layer | Tech |
|---|---|
| Frontend + API | Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui |
| Chat memory | Mem0 (`mem0ai` v1.0+) with `deepseek` LLM + `fastembed` embedder |
| Document RAG | raw Qdrant + same FastEmbed model |
| Relational | PocketBase v0.23 |
| LLM | DeepSeek `deepseek-chat` (OpenAI-compatible SDK) |
| Embeddings | `BAAI/bge-small-en-v1.5` (384-dim, runs on CPU, no API cost) |

## Quickstart (local)

### 1. Configure secrets
```bash
cp .env.example .env
cp memory-service/.env.example memory-service/.env
cp next-app/.env.local.example next-app/.env.local
```

Edit `.env` and set `DEEPSEEK_API_KEY` to a real key from <https://platform.deepseek.com/api_keys>. Everything else has safe defaults.

### 2. Boot the backends
```bash
docker compose up -d --build
```

Wait for all three containers to report healthy:
```bash
docker compose ps
curl http://localhost:8000/health   # memory-service
curl http://localhost:6333/healthz  # qdrant
curl http://localhost:8090/api/health  # pocketbase
```

### 3. Bootstrap PocketBase schema + admin
Visit <http://localhost:8090/_/> in a browser and create the first superuser
with the same `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` you put in `.env`.

Then create the two collections (idempotent):
```bash
docker compose exec memory-service python scripts/pb_bootstrap.py
```

You should see:
```
[pb] created conversations (...)
[pb] created messages.
```

### 4. Run Next.js
```bash
cd next-app
npm install
npm run dev
```

Open <http://localhost:3000>.

### 5. Smoke test
- Chat: "My name is Alex and I work at Acme Corp."
- New turn: "What's my name?" → should answer "Alex" / "Acme Corp".
- Click **Documents** → drop a PDF or `.txt`.
- Ask: "Summarise my uploaded document."
- Click **Memory** → see extracted facts and a list of uploaded docs.

All memory persists across `docker compose down && docker compose up -d` because of the named volumes (`pb_data`, `qdrant_storage`, `hf_cache`).

## Repository layout

```
.
├── docker-compose.yml        # PB + Qdrant + memory-service
├── .env.example              # root env (shared by compose)
├── memory-service/           # Python 3.11 / FastAPI / Mem0
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py         # Mem0 + settings
│   │   ├── schemas.py        # Pydantic models
│   │   ├── memory.py         # Mem0 wrapper
│   │   ├── documents.py      # text/PDF parsing + chunking
│   │   ├── qdrant_client.py  # `documents` collection + FastEmbed
│   │   └── routes/
│   │       ├── memories.py   # /add_memory, /search_memory, /list, /clear
│   │       └── documents.py  # /ingest_document, /search_documents, /list
│   ├── scripts/pb_bootstrap.py
│   ├── Dockerfile            # multi-stage, pre-downloads embedder
│   └── requirements.txt
└── next-app/                 # Next.js 14 App Router
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx          # redirect → /chat
    │   ├── chat/page.tsx     # main UI
    │   └── api/
    │       ├── chat/route.ts            # streaming + context merge
    │       ├── upload/route.ts          # multipart → /ingest_document
    │       ├── memories/route.ts        # GET / DELETE
    │       └── conversations/route.ts   # GET / POST
    ├── components/           # shadcn/ui primitives + feature components
    └── lib/                  # deepseek, pocketbase, memory-client, types
```

## API reference (memory-service)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET  | `/health` | — | status of Mem0 + Qdrant + embedder |
| POST | `/add_memory` | `{user_id, messages:[{role,content}]}` | Mem0 fact extraction |
| POST | `/search_memory` | `{user_id, query, limit?, threshold?}` | cosine over Mem0 collection |
| GET  | `/list_memories?user_id=` | — | all memories for user |
| DELETE | `/clear_memories?user_id=` | — | wipe user's memory |
| POST | `/ingest_document` | `multipart: user_id, file` | chunk + embed + upsert |
| POST | `/search_documents` | `{user_id, query, limit?}` | cosine over `documents` collection |
| GET  | `/list_documents?user_id=` | — | distinct uploaded docs |
| DELETE | `/delete_document?user_id=&doc_id=` | — | remove one doc's chunks |

## Data flow for a single chat turn

1. Browser → `POST /api/chat {userId, conversationId, message}`
2. Next.js:
   - In parallel: `memory.searchMemory`, `memory.searchDocuments`, PocketBase conversation history
   - Builds system prompt with retrieved context
   - Streams `deepseek.chat.completions.create({stream: true})`
   - Forwards tokens to browser as SSE
3. After stream completes:
   - Saves user + assistant messages to PocketBase
   - **Fire-and-forget** `POST /add_memory` with the user/assistant pair
4. Browser renders the streamed text and updates on the next turn

## Configuration knobs

All env vars live in the root `.env` (passed through to containers) and
`next-app/.env.local` (read by Next.js).

| Var | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | **required**, get from DeepSeek |
| `USER_ID` | `local-user` | scope for all Mem0 + PocketBase data |
| `EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | 384-dim, swap to `bge-m3` (1024-dim) for multilingual |
| `EMBED_DIMS` | `384` | must match the model |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | — | PocketBase superuser |
| `MEMORY_SERVICE_URL` (in `next-app/.env.local`) | `http://localhost:8000` | when Next.js runs on host |
| `NEXT_PUBLIC_PB_URL` | `http://localhost:8090` | used by client if you wire PB directly |

## Cloud deployment

The same `docker-compose.yml` works on any Docker host: a plain VPS
(Hetzner, DigitalOcean, Linode), Coolify, Dokku, or CapRover. Mount
named volumes on host paths for durability, and front everything with
Caddy or nginx for HTTPS.

**Not recommended for v1:** Vercel for the Next.js piece + a separate
managed Postgres for PocketBase + a hosted Qdrant cluster. It works,
but you end up with three or four services spread across providers, and
the CORS / secret-management overhead isn't worth it for an MVP.

For the simplest "ship it" path on a single VPS:
1. `git clone` the repo onto the server
2. `cp .env.example .env` and fill in `DEEPSEEK_API_KEY` and PB admin creds
3. `docker compose up -d --build`
4. `docker compose exec memory-service python scripts/pb_bootstrap.py`
5. Reverse-proxy 80/443 → `localhost:3000` with Caddy, and add the
   Next.js container to the same `va-net` (or change `MEMORY_SERVICE_URL`
   in its env to the server's public hostname).

## What's not in this MVP

- ❌ Multi-user auth (PocketBase auth collection not wired; `USER_ID` is env-set)
- ❌ Voice input / output
- ❌ Image / multimodal messages
- ❌ Web search tool
- ❌ LangChain / agent frameworks
- ❌ Production observability (stdout JSON logs only)
- ❌ Auto-scaling
- ❌ Memory decay tuning (Mem0's defaults are used)
- ❌ Graph memory (Mem0's Neo4j-backed `mem0g` variant)

Each of these is a clean follow-up.

## Troubleshooting

- **`memory-service` exits with `ModuleNotFoundError: psycopg`** — your local
  Mem0 install is mismatched. Rebuild the image: `docker compose build memory-service --no-cache`.
- **First `/add_memory` request is slow** — Mem0 cold-loads the DeepSeek
  client and FastEmbed on first call. After that, requests are sub-second.
- **Qdrant returns empty results** — confirm the embedder is the same model
  in Mem0 config and in `app/qdrant_client.py`. The vector space MUST match
  or cosine similarity is meaningless.
- **PocketBase admin login fails after `docker compose restart`** — data
  is in the `pb_data` named volume and persists. If you changed
  `PB_ADMIN_PASSWORD` in `.env`, PB still has the old hash. Either revert
  the env var or reset by deleting the `pb_data` volume (destructive).
- **Document upload returns 400 "no extractable text"** — your PDF is a
  scanned image. The MVP doesn't include OCR. Run it through an OCR
  tool first or upload a text file.

## License

MIT (or whatever you put here).
