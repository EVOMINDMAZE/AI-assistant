# Superhuman AI VA — Revised Plan & Architecture Review

## TL;DR — Verdict on the Original Plan

**Direction is right; execution plan has 5 critical gaps that will block the build.** The stack choice is sound and the layered separation (Next.js ↔ FastAPI memory service ↔ Qdrant/PocketBase) is the right call. But the original 4-step plan as written is not implementable as-is.

| # | Original step | Status | What needs to change |
|---|---|---|---|
| 1 | Docker compose with PB + Qdrant + memory-service | 🟡 Incomplete | Missing volumes, healthchecks, image pinning, networking |
| 2 | FastAPI memory service with `/add_memory`, `/search_memory` | 🔴 Missing | **No embedder configured** — Mem0 will silently fall back to OpenAI and break the "no OpenAI" rule. No document endpoints despite needing RAG. |
| 3 | Next.js `/api/chat` calls memory service + DeepSeek | 🟡 Incomplete | Streaming flow not defined. Background `add_memory` should happen *after* the assistant stream completes, not before. No doc RAG context merge. |
| 4 | shadcn/ui chat with streaming | 🟢 OK | Fine as written; minor: pin Vercel AI SDK for `useChat`, add `document-uploader`. |

**Three decisions made with the user:**
- **Embeddings:** Local `fastembed` (BAAI/bge-small-en-v1.5, 384-dim). $0 per-token, no OpenAI dependency, ~400MB RAM in the memory-service container. OpenAI embeddings would be ~$0.0001/1K tokens but breaks the "no OpenAI" rule.
- **Auth:** Single hardcoded `user_id` in env. No PocketBase auth wiring. PocketBase still used for chat/message persistence.
- **Scope:** Document RAG from day one → adds `/ingest_document` and `/search_documents` endpoints + `document-uploader` UI.

---

## 1. Critical Issues With the Original Plan

### 1.1 Mem0 has no embedder configured → silent OpenAI fallback
Mem0's default config is `embedder.provider = "openai"` with `text-embedding-3-small`. If you do `from mem0 import Memory` without overriding, every add/search call hits OpenAI. The original plan never says what embedder to use, which means the "no OpenAI models" rule is broken on the first message.

**Fix:** Explicitly configure Mem0 with `provider: "fastembed"` and a local sentence-transformer model.

### 1.2 `add_memory` is described as "background" but timing is wrong
The original says "Calls Python Memory Service (`/add_memory`) in the background to save the interaction." Two problems:
1. If you `add_memory` *before* the assistant reply, you save a user message with no assistant response — Mem0 extracts facts from the *pair*, so you'll get worse memory.
2. The Next.js handler returns *before* the stream completes, so a fire-and-forget HTTP call will be cut off.

**Fix:** Wait for the assistant's full reply (buffer the stream), then call `add_memory` with the user+assistant message pair. Use a fire-and-forget pattern only after buffering completes — or use Next.js `after()` (Next 14.2+) for clean post-response work.

### 1.3 No mention of document RAG despite it being "superhuman memory"
The plan only handles "remember past chats." A real superhuman VA also needs to recall what's in the user's uploaded PDFs / notes. Adding this *later* means retrofitting a second Qdrant collection, a second retrieval path, and a new UI surface.

**Fix:** Plan it now — separate Qdrant collection `documents`, same embedder (so it lives in the same vector space), a `/search` endpoint that returns both Mem0 hits and document chunks.

### 1.4 No CORS / service networking
The Next.js container, memory service, Qdrant, and PocketBase all need to talk to each other. The original plan implies `localhost:8000` for the memory service, which works locally but breaks inside Docker.

**Fix:** Use Docker service names (`http://memory-service:8000`, `http://qdrant:6333`, `http://pocketbase:8090`) on a shared network. Memory service binds to `0.0.0.0:8000`. Add CORS middleware allowing the Next.js origin only.

### 1.5 PocketBase schema undefined
PocketBase is "the relational DB" but the plan never says what collections exist. Mem0's Qdrant holds the *vector* memory; PocketBase needs to hold the *chat history* (conversational transcript, the raw message log).

**Fix:** Define two PB collections: `conversations` (id, title, created_at, updated_at) and `messages` (id, conversation_id, role, content, created_at, memory_saved bool). Created via a one-time bootstrap JS script that calls the PB API.

---

## 2. Revised Architecture

```
/superhuman-va
├── docker-compose.yml          # PB (8090), Qdrant (6333), memory-service (8000)
├── .env.example                # DEEPSEEK_API_KEY, USER_ID, etc.
├── README.md
│
├── memory-service/             # Python 3.11, FastAPI, Mem0
│   ├── Dockerfile              # multi-stage; pre-downloads embedder model
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── __init__.py
│       ├── main.py             # FastAPI app, CORS, lifespan
│       ├── config.py           # pydantic-settings + Mem0 config dict
│       ├── schemas.py          # Pydantic request/response models
│       ├── memory.py           # Mem0 wrapper (init once at startup)
│       ├── documents.py        # PDF/text chunking + raw Qdrant
│       ├── qdrant_client.py    # Two collections: 'memories', 'documents'
│       └── routes/
│           ├── memories.py     # /add_memory, /search_memory, /list_memories
│           └── documents.py    # /ingest_document, /search_documents
│
└── next-app/                   # Next.js 14 App Router, TS, Tailwind, shadcn/ui
    ├── package.json
    ├── tsconfig.json
    ├── next.config.mjs
    ├── tailwind.config.ts
    ├── postcss.config.mjs
    ├── components.json         # shadcn/ui config
    ├── .env.local.example      # DEEPSEEK_API_KEY, MEMORY_SERVICE_URL, PB_URL
    ├── app/
    │   ├── layout.tsx          # dark mode, fonts, providers
    │   ├── globals.css         # tailwind + shadcn theme
    │   ├── page.tsx            # redirect → /chat
    │   ├── chat/
    │   │   └── page.tsx        # main chat UI
    │   └── api/
    │       ├── chat/route.ts           # POST: stream DeepSeek with merged context
    │       ├── upload/route.ts         # POST: forward file to /ingest_document
    │       ├── memories/route.ts       # GET: list, DELETE: clear
    │       └── conversations/route.ts  # GET/POST: list/create PB conversations
    ├── components/
    │   ├── ui/                 # shadcn/ui (button, input, card, scroll-area, dialog)
    │   ├── chat-window.tsx     # message list + auto-scroll
    │   ├── message-bubble.tsx
    │   ├── chat-input.tsx      # textarea + send button
    │   ├── document-uploader.tsx
    │   ├── memory-panel.tsx    # modal showing what VA remembers
    │   └── sidebar.tsx         # conversation list (from PocketBase)
    └── lib/
        ├── deepseek.ts         # OpenAI SDK configured for DeepSeek
        ├── pocketbase.ts       # PB JS SDK client
        ├── memory-client.ts    # fetch wrapper for memory service
        └── types.ts
```

### Data flow (one chat turn)
```
User types message in <chat-input />
  ↓
POST /api/chat { userId, conversationId, message }
  ↓
1. Next.js fetches last N messages from PocketBase (conversation context)
2. Parallel:
   a) POST memory-service /search_memory    → "I prefer dark mode and Python"
   b) POST memory-service /search_documents → PDF chunk about "Q3 OKRs"
3. Build system prompt with both contexts + conversation history
4. Call DeepSeek (stream:true) via OpenAI SDK
5. Stream tokens to client as SSE
6. After stream completes:
   - Save assistant message to PocketBase
   - Fire-and-forget POST memory-service /add_memory (user + assistant pair)
7. Return
```

---

## 3. Revised Step-by-Step Plan

### Step 0 — Repo & env bootstrap
- `mkdir superhuman-va && cd superhuman-va && git init`
- Create root `.env.example` with: `DEEPSEEK_API_KEY=`, `USER_ID=local-user`, `HF_HOME=/app/.cache/huggingface`
- Add `.gitignore` (node_modules, .next, .env, .venv, qdrant_storage, pb_data)

**Verify:** `cat .env.example` shows all keys; `git status` clean.

### Step 1 — Docker infrastructure
Build `docker-compose.yml` with three services on a `va-net` network, all named volumes:

| Service | Image | Internal port → Host | Volume | Healthcheck |
|---|---|---|---|---|
| `pocketbase` | `ghcr.io/muchobien/pocketbase:v0.23.0` | 8090 → 8090 | `pb_data:/pb_data` | `wget -q http://localhost:8090/api/health` |
| `qdrant` | `qdrant/qdrant:v1.12.0` | 6333 → 6333, 6334 → 6334 | `qdrant_storage:/qdrant/storage` | `wget -q http://localhost:6333/healthz` |
| `memory-service` | local build (Step 2) | 8000 → 8000 | `hf_cache:/app/.cache/huggingface` | `wget -q http://localhost:8000/health` |

**Critical details to include:**
- `healthcheck` blocks for each so `memory-service` waits for Qdrant to be ready
- `pocketbase` command: `["/pocketbase", "serve", "--http=0.0.0.0:8090"]`
- `qdrant` with `--sparse-vectors` not needed for v1; just default config
- All services on the same user-defined bridge network
- `restart: unless-stopped` only for PB + Qdrant (memory-service can be stateless)

**Verify:** `docker compose up -d` → all three healthy (`docker compose ps`); `curl http://localhost:6333/healthz` returns `{"title":"qdrant",...,"status":"ok"}`; `curl http://localhost:8090/api/health` returns `{"code":200,...}`.

### Step 2 — Memory service (Python FastAPI)
**`memory-service/Dockerfile`** — multi-stage:
- Base: `python:3.11-slim`
- Install: `fastapi`, `uvicorn[standard]`, `mem0ai[fastembed]`, `pydantic-settings`, `python-multipart`, `pypdf`, `qdrant-client`
- `RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"` to pre-download model into image
- `EXPOSE 8000`, `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`

**`app/config.py`** — Mem0 config dict:
```python
{
  "llm": {"provider": "deepseek", "config": {
      "model": "deepseek-chat", "api_key": settings.deepseek_api_key, "temperature": 0.0}},
  "embedder": {"provider": "fastembed", "config": {
      "model": "BAAI/bge-small-en-v1.5"}},
  "vector_store": {"provider": "qdrant", "config": {
      "host": "qdrant", "port": 6333,
      "collection_name": "memories",
      "embedding_model_dims": 384}},
}
```

**`app/main.py`** — FastAPI app:
- `lifespan` context: instantiate `Memory.from_config(config)` once, store on `app.state.memory`; instantiate `QdrantClient(host="qdrant", port=6333)`; create `documents` collection if missing (384-dim, cosine)
- `CORSMiddleware` allowing `http://localhost:3000` (dev) and `NEXT_PUBLIC_APP_URL` (prod)
- Mount routers: `/memories`, `/documents`
- `GET /health` → `{"status":"ok","mem0_loaded":true,"qdrant_ok":true}`

**`app/routes/memories.py`**:
- `POST /add_memory` — body `{user_id, messages: [{role, content}, ...]}` → `await memory.add(messages, user_id=user_id)`. Returns `{"results": [...]}`.
- `POST /search_memory` — body `{user_id, query, limit=5, threshold=0.3}` → `await memory.search(query, user_id=user_id, limit=limit, threshold=threshold)`. Returns `{"results": [{"memory": "...", "score": 0.81}, ...]}`.
- `GET /list_memories` — query `user_id` → `await memory.get_all(user_id=user_id)`.
- `DELETE /clear_memories` — query `user_id` → `await memory.delete_all(user_id=user_id)`.

**`app/routes/documents.py`**:
- `POST /ingest_document` — `multipart/form-data` with `user_id`, `file`. Parse: PDF → `pypdf`; txt/md → read. Chunk: 1000 chars, 200 overlap (langchain `RecursiveCharacterTextSplitter` or simple). Embed each chunk with the same fastembed model. Upsert into Qdrant `documents` collection with payload `{user_id, doc_id, filename, chunk_index, text}`. Returns `{doc_id, chunks_created}`.
- `POST /search_documents` — body `{user_id, query, limit=5}` → embed query, search Qdrant with `must=[{key: "user_id", match: {value: user_id}}]`, return top-k `{text, score, filename, chunk_index}`.

**Verify:** `docker compose logs memory-service` shows model loaded + Qdrant connected; `curl localhost:8000/health` returns 200; manual `curl` against `/add_memory` and `/search_memory` round-trips.

### Step 3 — PocketBase schema bootstrap
**`memory-service/scripts/pb_bootstrap.py`** (or run via PocketBase JS hooks — but a Python script is simpler):
- One-time script that:
  1. POSTs to `http://pocketbase:8090/api/admins/auth-with-password` to log in as superuser (env `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`)
  2. Creates `conversations` collection: fields `title` (text), `user_id` (text, indexed), `created_at`, `updated_at`
  3. Creates `messages` collection: fields `conversation_id` (relation → conversations), `role` (select: user/assistant), `content` (text), `memory_saved` (bool), `created_at`
  4. Sets API rules: `list/view` for both requires `user_id == @request.auth.id` (or just allow-all for single-user MVP)

**Verify:** Log into PocketBase admin UI at `http://localhost:8090/_/`, see the two collections with correct fields.

### Step 4 — Next.js backend (`/api` routes)
**`lib/deepseek.ts`** — singleton OpenAI client pointed at DeepSeek:
```ts
import OpenAI from "openai";
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: "https://api.deepseek.com",
});
```

**`app/api/chat/route.ts`** — the critical route:
1. Read body: `{userId, conversationId, message}`
2. Parallel fetch: `memoryClient.searchMemory({userId, query: message})` AND `memoryClient.searchDocuments({userId, query: message})`
3. Fetch last 10 messages from PocketBase for the conversation
4. Build messages array: `[{role: "system", content: SYSTEM_PROMPT}, ...history, {role: "user", content: message}]` where `SYSTEM_PROMPT` includes the retrieved memories + document chunks
5. Call `deepseek.chat.completions.create({model: "deepseek-chat", stream: true, messages})`
6. Use `ReadableStream` to forward SSE chunks to client
7. Buffer the full assistant reply in a variable
8. After stream ends:
   - `await pocketbase.collection("messages").create({conversation_id, role: "user", content: message, memory_saved: false})`
   - `await pocketbase.collection("messages").create({conversation_id, role: "assistant", content: buffered, memory_saved: false})`
   - **Fire-and-forget:** `memoryClient.addMemory({userId, messages: [{role:"user", content:message}, {role:"assistant", content:buffered}]})` — do NOT await; return response to client immediately

**`app/api/upload/route.ts`** — `POST` accepts `multipart/form-data`, forwards to memory service `/ingest_document` via `fetch` with `FormData`.

**`app/api/memories/route.ts`** — `GET` returns list, `DELETE` clears.

**`app/api/conversations/route.ts`** — `GET` lists, `POST` creates new conversation with `user_id` and `title="New chat"`.

**Verify:** `curl -X POST localhost:3000/api/chat -d '{"userId":"local-user","conversationId":"...","message":"hi"}'` returns SSE; first message lacks memory context (empty), second message shows the VA remembers; upload a PDF, then ask a question about it.

### Step 5 — Next.js frontend
**Bootstrap:**
```bash
cd next-app
npx create-next-app@14 . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
npx shadcn@latest init   # pick "Slate" base, yes to dark mode
npx shadcn@latest add button input card scroll-area dialog textarea sonner
npm i openai pocketbase @ai-sdk/openai
```

**`app/layout.tsx`** — set `<html className="dark">`, wrap in `Toaster` for upload progress toasts.

**`app/chat/page.tsx`** — three-column layout (Tailwind grid):
- Left: `<Sidebar>` (conversation list, "New chat" button, "Documents" link, "Memory" button)
- Center: `<ChatWindow>` (scrollable message list, `<ChatInput>` at bottom)
- Right (collapsible drawer): `<DocumentUploader>` and `<MemoryPanel>`

**`components/chat-input.tsx`** — uses Vercel AI SDK `useChat` hook (or hand-rolled SSE consumer) to:
- POST to `/api/chat`
- Stream assistant reply
- Submit on Enter (Shift+Enter for newline)

**`components/document-uploader.tsx`** — drag-and-drop area → POST `/api/upload` → toast success with `chunks_created` count.

**`components/memory-panel.tsx`** — modal that calls `GET /api/memories` and lists what the VA has remembered, with a "Clear memories" button.

**Verify:** Open `http://localhost:3000`, send a message "I prefer Python over JavaScript", send another "what do I prefer?" — VA recalls it. Upload `notes.txt`, ask "summarize my notes" — VA retrieves from the document collection.

### Step 6 — Cloud deployment notes
- For any Docker-Compose-supporting host (Coolify, Dokku, CapRover, a plain VPS with Docker), the same `docker-compose.yml` works. Mount named volumes on host paths for durability.
- For Vercel/Netlify hosting of *only* the Next.js piece: split — deploy memory-service + Qdrant + PocketBase on a single VPS (or Railway fly), point `MEMORY_SERVICE_URL` env at it. **Not recommended for v1** — adds CORS, secret management, and TLS in the middle of the stack. Stick with monolithic Docker for MVP.
- Add a `Caddyfile` or `nginx.conf` reverse proxy in front of all three services for HTTPS if exposing to internet. (Optional for MVP, but flag it.)

---

## 4. Mem0 Configuration — Why These Choices

| Component | Choice | Rationale |
|---|---|---|
| LLM provider | `deepseek` (native adapter) | `mem0ai` v1.0+ ships a `deepseek` LLM adapter. No need for OpenAI-compat shim. |
| LLM model | `deepseek-chat` | Sufficient for fact extraction; `deepseek-reasoner` is overkill for Mem0's structured extraction and slower. |
| Embedder | `fastembed` / `BAAI/bge-small-en-v1.5` | 384-dim, ~50MB, runs on CPU. No API cost. Same model for Mem0 *and* document RAG → shared vector space. |
| Vector store | `qdrant` (Mem0 config) | Already in the stack. Mem0's `qdrant` provider writes to a single collection `memories`; we add a second collection `documents` via raw `qdrant-client` calls in `app/documents.py`. |
| Vector dims | 384 | Must match the embedder. Both Mem0 and the raw Qdrant collection must use the same `embedding_model_dims` or search breaks. |

---

## 5. Strict Rules Compliance

Original rules vs revised plan:

| Rule | Original | Revised | Compliant? |
|---|---|---|---|
| No Supabase | ✓ | ✓ Uses PocketBase only | ✅ |
| No OpenAI models | ✓ (LLM) but ❌ (embedder would silently default to OpenAI) | DeepSeek chat + FastEmbed local embedder | ✅ |
| Next.js for UI/routing only, AI logic in Python | ✓ | ✓ All Mem0/Qdrant logic in memory-service | ✅ |
| `.env.local` for keys | ✓ | ✓ `.env.local` for Next.js, `.env` for compose, env-passed into memory-service | ✅ |

---

## 6. What's Intentionally NOT in Scope (v1)

To keep this proportional to an MVP:
- ❌ Multi-user auth (PocketBase auth collection not wired; user_id is env-set)
- ❌ Voice input/output
- ❌ Image/multimodal message support
- ❌ Web search tool
- ❌ LangChain / agent frameworks
- ❌ Production-grade observability (just stdout JSON logs)
- ❌ Auto-scaling, load balancing
- ❌ Memory decay/importance tuning (Mem0's defaults are fine)
- ❌ Graph memory (Mem0's `mem0g` with Neo4j — overkill for chat memory)

Each of these is a clean follow-up. None of them blocks the core "talk to your VA, it remembers" demo.

---

## 7. Assumptions & Open Questions

**Assumed (flag if wrong):**
- Cloud = Docker-hosting platform (VPS, Coolify, etc.) — not Vercel + managed DBs.
- "Superhuman memory" = chat memory + uploaded documents. No screen capture, browser history, calendar, etc.
- DeepSeek API key is already obtainable (DeepSeek has a tier-1 free tier but does require account + top-up eventually).
- English-only content. FastEmbed `bge-small-en-v1.5` is English-tuned. For multilingual, swap to `bge-m3` (multilingual, 1024-dim, ~2GB).

**Open (low risk, can decide during build):**
- Memory search `threshold` — start at `0.3`, tune from there.
- Conversation history length in prompt — start at last 10 messages, add summarization if it gets long.
- Document chunk size — 1000/200 is a safe default; revisit if retrieval quality is poor.

---

## 8. Verification Checklist (End-to-End)

After all steps, this should work:

1. `docker compose up -d` — all three services healthy.
2. `curl http://localhost:8090/api/health` — PocketBase OK.
3. `curl http://localhost:6333/healthz` — Qdrant OK.
4. `curl http://localhost:8000/health` — memory-service OK, reports Mem0 loaded.
5. `cd next-app && npm run dev` — Next.js on `http://localhost:3000`.
6. Open browser → chat:
   - "My name is Alex and I work at Acme Corp"
   - "What's my name?" → "Your name is Alex."
   - Upload `notes.txt` containing "Q3 OKR: ship V2 by Sept 30"
   - "What's my Q3 OKR?" → "Ship V2 by Sept 30."
   - Click Memory panel → see "User's name is Alex", "User works at Acme Corp", and the Q3 OKR document chunk.
7. `docker compose down` then `docker compose up -d` — all memory persists (Qdrant storage + PocketBase data volumes).

---

## 9. File-by-File Deliverables (for executor)

**Root:**
- `docker-compose.yml`, `.env.example`, `.gitignore`, `README.md`

**`memory-service/`** (8 files):
- `Dockerfile`, `requirements.txt`, `.env.example`
- `app/main.py`, `app/config.py`, `app/schemas.py`
- `app/memory.py`, `app/documents.py`, `app/qdrant_client.py`
- `app/routes/memories.py`, `app/routes/documents.py`

**`next-app/`** (Next.js boilerplate + 11 custom files):
- `lib/deepseek.ts`, `lib/pocketbase.ts`, `lib/memory-client.ts`, `lib/types.ts`
- `app/api/chat/route.ts`, `app/api/upload/route.ts`, `app/api/memories/route.ts`, `app/api/conversations/route.ts`
- `components/chat-window.tsx`, `components/chat-input.tsx`, `components/document-uploader.tsx`, `components/memory-panel.tsx`, `components/sidebar.tsx`
- `app/chat/page.tsx` (replaces default)

Total: ~24 files. Achievable in one focused session.
