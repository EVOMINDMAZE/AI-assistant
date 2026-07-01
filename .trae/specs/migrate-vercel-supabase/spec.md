# Migrate to Vercel + Supabase Spec

## Why

The current architecture (Next.js on Oracle Cloud ARM A1 + PocketBase in
Docker + Qdrant in Docker + FastAPI memory-service + Caddy reverse proxy
+ self-signed TLS) is **~1,750 lines of infra code** that exists solely to
make the agent code run. The user has accounts on Vercel and Supabase and
prefers to install both CLIs rather than manage a Linux box.

Migrating to Vercel + Supabase collapses 5 services into 2 managed
platforms, removes all TLS / DNS / firewall / systemd work, and replaces
the custom bcrypt + `auth_sessions` PocketBase table with Supabase Auth
(email + password + magic link out of the box).

## What Changes

**Removed entirely (no code kept):**
- `memory-service/` (FastAPI Python) — ported to Next.js API routes
- Caddy / self-signed TLS — Vercel handles HTTPS
- Docker Compose orchestration — Vercel + Supabase handle deploys
- `pb_bootstrap.py` — replaced by Supabase SQL migrations
- `qdrant_client.py` — replaced by pgvector SQL functions
- `lib/pocketbase.ts` and `lib/auth-store.ts` — replaced by Supabase clients
- `app/api/auth/route.ts` and `middleware.ts` (custom auth) — replaced by Supabase Auth + `@supabase/ssr`
- `scripts/backup.sh` and `scripts/restore.sh` — Supabase has built-in PITR

**Added:**
- `supabase/` directory: `migrations/`, `seed.sql`, `config.toml`
- `vercel.json` with cron schedules, function region, max duration
- `lib/supabase/server.ts` and `lib/supabase/client.ts` (server + browser clients)
- `lib/supabase/vector.ts` (pgvector helpers: upsert, search, delete)
- A "run_code" Edge Function in Supabase for the sandbox (since Vercel's
  serverless function limits make `node:vm` awkward; Edge Functions run
  Deno and are more sandbox-friendly). **Fallback:** keep `node:vm` inline
  with a 5s timeout — Vercel Pro 60s timeout is enough.

**Migrated (in-place rewrite):**
- `next-app/app/api/memories/*` — calls the memory-service today; rewrite to call Supabase directly
- `next-app/app/api/documents/*` — same
- `next-app/app/api/conversations/*` — same
- `next-app/app/api/cost/today` — same
- `next-app/app/api/search-messages` — same
- `next-app/app/api/chat/route.ts` — replace `pbAsAdmin()` with Supabase server client; replace `memoryClient` calls with direct Supabase calls

**Migration strategy:**
- **Fresh start:** no data migration. The current "production" data is
  throwaway test data; we'll start with empty Supabase tables and let
  the eval + smoke tests re-seed.
- If the user later wants to bring history over, the one-time
  `scripts/pb-export.ts` script reads from PB SQLite + Qdrant snapshots
  and writes SQL inserts (out of scope for this spec, can be a follow-up).

## Impact

- Affected specs: `build-production-swarm` (amended — fewer infra
  requirements), `fix-top3-broken` (amended — `auth-store.ts` and
  `auth_sessions` schema removed)
- Affected code:
  - Removed: `memory-service/` (entire), `lib/pocketbase.ts`, `lib/auth-store.ts`, `pb_bootstrap.py`, `qdrant_client.py`, `app/api/auth/route.ts`, `middleware.ts`, `scripts/backup.sh`, `scripts/restore.sh`
  - Added: `supabase/`, `vercel.json`, `lib/supabase/*`
  - Rewritten: `next-app/app/api/chat/route.ts`, `next-app/app/api/memories/*`, `next-app/app/api/documents/*`, `next-app/app/api/conversations/*`, `next-app/app/api/cost/today`, `next-app/app/api/search-messages`, `next-app/lib/memory-client.ts`
  - Unchanged: all of `next-app/lib/agents/*`, all UI components, `eval/`, `tests/`

## ADDED Requirements

### Requirement: Supabase project provisioned

The user SHALL be able to run `supabase init` + `supabase link --project-ref <ref>` against a real Supabase project they own.

#### Scenario: First-time setup
- **WHEN** the user runs `supabase login` followed by `supabase link`
- **THEN** the CLI confirms the link with the project's ref + region

### Requirement: SQL migrations create all 6 tables

`supabase/migrations/0001_init.sql` SHALL create:
- `conversations` (id uuid pk, user_id uuid fk → auth.users, title text, created_at timestamptz, updated_at timestamptz)
- `messages` (id uuid pk, conversation_id uuid fk, role text check in (user/assistant/system), content text, created_at timestamptz)
- `agent_state` (id uuid pk, conversation_id uuid fk, agent_name text, state_json jsonb, unique(conversation_id, agent_name))
- `agent_messages` (id uuid pk, conversation_id uuid fk, turn_id text, from_agent text, to_agent text, message text, reply text, status text, created_at timestamptz)
- `memories` (id uuid pk, user_id uuid fk, conversation_id uuid fk nullable, fact text, embedding vector(384), metadata jsonb, created_at timestamptz) — pgvector for both Mem0-backed and global
- `documents` (id uuid pk, user_id uuid fk, filename text, content text, embedding vector(384), metadata jsonb, created_at timestamptz)
- `message_index` (id uuid pk, user_id uuid fk, conversation_id uuid fk, message_id uuid fk, role text, text text, embedding vector(384), created_at timestamptz) — replaces the Qdrant `messages` collection
- `cost_traces` (id uuid pk, user_id uuid fk, turn_id text, payload jsonb, created_at timestamptz) — replaces the local SQLite traces

#### Scenario: Migration applied
- **WHEN** the user runs `supabase db push` (or `supabase migration up` locally)
- **THEN** all 7 tables exist and are queryable

### Requirement: Row-Level Security is enabled

Every table SHALL have RLS enabled with policies scoped to `auth.uid() = user_id` (or via `conversation_id` join for the `messages` table).

#### Scenario: User reads their own data
- **WHEN** an authenticated user runs `SELECT * FROM messages` via the Supabase client
- **THEN** only their own rows are returned (RLS enforced)

#### Scenario: User reads another user's data
- **WHEN** user A queries messages from a conversation owned by user B
- **THEN** the query returns 0 rows (RLS blocks it)

### Requirement: Supabase Auth replaces custom auth

`/api/auth` and `middleware.ts` SHALL be deleted. Login is handled by `supabase.auth.signInWithPassword()` on the client, and the Supabase JS client manages the session cookie automatically.

#### Scenario: User signs in
- **WHEN** the user enters their email + password on `/login` and submits
- **THEN** Supabase Auth validates the credentials and sets a HttpOnly
  session cookie scoped to the app's domain
- **AND** the user is redirected to `/chat`

#### Scenario: Middleware redirects unauthenticated requests
- **WHEN** an unauthenticated request hits `/chat`
- **THEN** the new `middleware.ts` (using `@supabase/ssr`) redirects to `/login`

### Requirement: pgvector replaces Qdrant

`lib/supabase/vector.ts` SHALL expose `upsertMemory`, `searchMemories`, `upsertDocument`, `searchDocuments`, `indexMessage`, `searchMessages` — all backed by pgvector with an HNSW index for cosine similarity.

#### Scenario: Vector search returns relevant results
- **WHEN** `searchDocuments(userId, "retention policy", 3)` is called
- **THEN** it runs a SQL query against the `documents` table with
  `embedding <=> $1` (cosine distance) and returns the top 3 rows
  filtered by `user_id = $2`

### Requirement: Vercel deployment works

`vercel.json` SHALL configure:
- `buildCommand`: `next build`
- `functions`: `{ "app/api/chat/route.ts": { "maxDuration": 60 } }`
- `crons`: `[{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]`
- `regions`: `iad1` (US East; adjust if Supabase is in a different region)

#### Scenario: Vercel build succeeds
- **WHEN** the user runs `vercel --prod`
- **THEN** the build completes and the URL returns 200 on `/login`

#### Scenario: Vercel cron fires
- **WHEN** the cron schedule `0 3 * * *` triggers
- **THEN** Vercel calls `/api/cron/cleanup` with the `Authorization: Bearer <CRON_SECRET>` header; the route purges expired auth sessions and trims `cost_traces` older than 30 days

### Requirement: node:vm sandbox works on Vercel

The `run_code` tool SHALL continue to use `node:vm` with a 5s timeout. Vercel Pro's 60s function timeout is sufficient.

#### Scenario: Vercel serverless runs user-submitted code
- **WHEN** the CoS calls `run_code` with `snippet: "console.log(2+2)"`
- **THEN** Vercel runs the snippet in a `node:vm` context with safe
  globals, returns the captured stdout ("4\n") in < 6s, and the route
  emits a `code_run` SSE event

### Requirement: All 5 PB/Qdrant API routes are rewritten as Supabase-backed

The following routes SHALL be rewritten to use Supabase directly (no FastAPI service):
- `app/api/memories/*` (search, add, add_global, search_global, list_global, clear, clear_global, search_messages, index_message, clear_messages)
- `app/api/documents/*` (search, list, upload, delete)
- `app/api/conversations/*` (list, create, delete)
- `app/api/cost/today`
- `app/api/search-messages`

#### Scenario: chat route works end-to-end
- **WHEN** the user sends a message in the chat
- **THEN** the route reads/writes against Supabase directly (no
  FastAPI hop), the SSE stream fires, and the assistant message is
  persisted in the `messages` table

## MODIFIED Requirements

### Requirement: Tracing (from `fix-top3-broken`)

`lib/tracing.ts` SHALL write to the `cost_traces` Supabase table instead of local SQLite. The `recordToolCall` / `commitTurn` API stays the same; only the storage backend changes.

### Requirement: Auth (from `fix-top3-broken` + `build-production-swarm` T2.1)

The custom bcrypt + `auth_sessions` table approach is replaced by Supabase Auth. The `lib/auth-store.ts` file is deleted. The `POST /api/auth` route is deleted (Supabase JS client handles sign-in). The `DELETE /api/auth` route is deleted (Supabase JS client `signOut()` handles sign-out). The "Sign out" button in the chat header calls `supabase.auth.signOut()` instead of `DELETE /api/auth`.

## REMOVED Requirements

### Requirement: Single password auth (from `build-production-swarm` T2.1)
**Reason:** Replaced by Supabase Auth, which supports email + password
+ magic link + OAuth out of the box. Single-password was always a
limitation; the migration drops it.
**Migration:** Existing users (if any) get a Supabase account created on
first sign-in via the magic-link flow, or the user runs a one-time
`supabase auth admin invite <email>` to send a setup link.

### Requirement: PocketBase as a service
**Reason:** Replaced by Supabase Postgres.
**Migration:** N/A — fresh start, no PB data carries over.

### Requirement: Qdrant as a service
**Reason:** Replaced by Supabase pgvector.
**Migration:** N/A — fresh start, no Qdrant data carries over.

### Requirement: FastAPI memory-service
**Reason:** All routes port to Next.js API routes backed by Supabase.
**Migration:** N/A — no service-level data.

### Requirement: Backup / restore scripts (T1.6)
**Reason:** Supabase has Point-in-Time Recovery built into the Pro plan.
**Migration:** N/A — Supabase handles it.

## Migration

No data migration. The current state has no real user data to preserve.
The user will sign up via Supabase Auth, get a fresh empty database,
and the eval + golden questions will re-seed the test fixtures.

The two existing specs (`build-production-swarm` and `fix-top3-broken`)
remain in `.trae/specs/` as historical references. Their **acceptance
criteria** are re-stated below as part of this spec's checklist so the
final state can be verified end-to-end.

## Cost

- Vercel Hobby: $0 (100K function invocations/mo, 10s timeout)
- Supabase Free: $0 (500MB DB, 50K MAU, 50MB storage)
- **$0/mo** to start, assuming < 100K agent invocations / month

Upgrade path: Vercel Pro ($20/mo) + Supabase Pro ($25/mo) = $45/mo for
1M invocations, 60s timeout, 8GB DB, custom domain.
