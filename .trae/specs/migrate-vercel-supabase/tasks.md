# Tasks — Migrate to Vercel + Supabase

Ordered, small, verifiable work items. Each ends with a runnable check.

---

- [x] **Task 1: Bootstrap the Supabase project**
  - [x] 1.1: Install the Supabase CLI: `brew install supabase/tap/supabase` (or the Linux / WSL equivalent).
  - [x] 1.2: `supabase login` — authenticate against the user's account.
  - [x] 1.3: `supabase init` inside the repo root — creates `supabase/` directory with `config.toml`, `migrations/`, `seed.sql`.
  - [x] 1.4: In the Supabase dashboard, create a new project (region: us-east-1, name: `superhuman-va`).
  - [x] 1.5: `supabase link --project-ref <ref>` — wires the local repo to the remote project.
  - [x] 1.6: Confirm `supabase status` shows the project is linked and the DB is reachable.

- [x] **Task 2: Write the SQL migrations**
  - [x] 2.1: `supabase/migrations/0001_init.sql` — create the 7 tables: `conversations`, `messages`, `agent_state`, `agent_messages`, `memories` (with `embedding vector(384)`), `documents` (with `embedding vector(384)`), `message_index` (with `embedding vector(384)`), `cost_traces`.
  - [x] 2.2: In the same migration, enable the `vector` extension: `CREATE EXTENSION IF NOT EXISTS vector;`.
  - [x] 2.3: Create HNSW indexes on the 3 vector columns for cosine distance: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);`.
  - [x] 2.4: Enable RLS on every table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`.
  - [x] 2.5: Add RLS policies: `CREATE POLICY "own data" ON <table> FOR ALL USING (auth.uid() = user_id);` for direct-`user_id` tables, and a join-based policy for `messages` (via `conversation_id`).
  - [x] 2.6: `supabase db push` — applies the migration to the remote project.
  - [x] 2.7: Verify with `supabase db remote commit` (or via the dashboard) that all 7 tables + indexes + policies exist.

- [x] **Task 3: Install the Supabase JS clients in the Next.js app**
  - [x] 3.1: `pnpm add @supabase/supabase-js @supabase/ssr` in `next-app/`.
  - [x] 3.2: `lib/supabase/server.ts` — exports `createServerClient()` that uses `next/headers` cookies (server components + route handlers).
  - [x] 3.3: `lib/supabase/client.ts` — exports `createBrowserClient()` for client components.
  - [x] 3.4: `lib/supabase/admin.ts` — exports `createAdminClient()` using the service-role key (only used in server-side code with `process.env.SUPABASE_SERVICE_ROLE_KEY`).
  - [x] 3.5: Add to `.env.local.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

- [x] **Task 4: Build the pgvector helper**
  - [x] 4.1: `lib/supabase/vector.ts` — `upsertMemory({ userId, fact, embedding, metadata })` → row id.
  - [x] 4.2: `searchMemories({ userId, embedding, limit, threshold })` → array of `{ id, fact, score, metadata }`.
  - [x] 4.3: `upsertDocument({ userId, filename, content, embedding, metadata })` → row id.
  - [x] 4.4: `searchDocuments({ userId, embedding, limit })` → array of `{ id, filename, content, score, metadata }`.
  - [x] 4.5: `indexMessage({ userId, conversationId, messageId, role, text, embedding })` → row id.
  - [x] 4.6: `searchMessages({ userId, embedding, limit })` → array of `{ id, conversationId, messageId, role, text, score }`.
  - [x] 4.7: All helpers use the **admin client** (bypasses RLS — used by the server-side CoS where we know the user_id is correct).
  - [x] 4.8: All helpers call an SQL function `match_<table>(embedding, user_id, match_count)` for type safety (defined in 0002_match_functions.sql).

- [x] **Task 5: Add the SQL match functions**
  - [x] 5.1: `supabase/migrations/0002_match_functions.sql` — define `match_memories(embedding vector(384), p_user_id uuid, match_count int) returns table (...) language sql stable as $$ ... $$;`.
  - [x] 5.2: Same for `match_documents`, `match_message_index`.
  - [x] 5.3: Each function uses `ORDER BY embedding <=> $1 ASC LIMIT $3`.
  - [x] 5.4: `supabase db push`.

- [x] **Task 6: Rewrite the memory-client to call Supabase**
  - [x] 6.1: `lib/memory-client.ts` — keep the same public API (`addMemory`, `searchMemory`, `addGlobalMemory`, `searchGlobalMemory`, `listGlobalFacts`, `clearMemories`, `clearGlobalMemories`, `searchDocuments`, `listDocuments`, `indexMessage`, `searchMessages`, `clearMessages`) but the body now uses `lib/supabase/vector.ts` + `lib/supabase/admin.ts` directly.
  - [x] 6.2: No more HTTP fetch to the FastAPI service — the calls are in-process.
  - [x] 6.3: Embedding is computed by a small client-side wrapper around `transformers.js` (or a server-side call to a Supabase Edge Function — for now, just import `@xenova/transformers` in the Node.js route handler; it works).
  - [x] 6.4: Update unit tests (`tests/`) to mock `@/lib/supabase/admin` instead of `fetch`.

- [x] **Task 7: Replace PocketBase in the chat route**
  - [x] 7.1: `app/api/chat/route.ts` — remove `pbAsAdmin()` and `pb.collection(...)` calls; replace with `createAdminClient()` + `.from("messages").insert(...)`, etc.
  - [x] 7.2: `loadHistory(conversationId)` — rewrite as a Supabase query: `SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at LIMIT 20`.
  - [x] 7.3: `loadStateSafe(conversationId, agentName)` — same against `agent_state`.
  - [x] 7.4: `persistAfterStream(...)` — replace `messages.create({...})` with `supabase.from("messages").insert({...})`.
  - [x] 7.5: `saveState(pb, conversationId, "CoS", next)` becomes `supabase.from("agent_state").upsert({...}, { onConflict: "conversation_id,agent_name" })`.
  - [x] 7.6: `forget_everything` branch — uses Supabase admin client to delete rows in all 6 user-scoped tables.

- [x] **Task 8: Rewrite the FastAPI memory-service routes as Next.js API routes**
  - [x] 8.1: `app/api/memories/search/route.ts` — proxies to `searchMemory()` in the new client.
  - [x] 8.2: `app/api/memories/add/route.ts` — same for `addMemory()`.
  - [x] 8.3: `app/api/memories/add_global/route.ts` — same for `addGlobalMemory()`.
  - [x] 8.4: `app/api/memories/search_global/route.ts` — same for `searchGlobalMemory()`.
  - [x] 8.5: `app/api/memories/list_global/route.ts` — same for `listGlobalFacts()`.
  - [x] 8.6: `app/api/memories/clear/route.ts` + `clear_global/route.ts` — same.
  - [x] 8.7: `app/api/memories/search_messages/route.ts` + `index_message/route.ts` + `clear_messages/route.ts` — same.
  - [x] 8.8: `app/api/documents/search/route.ts` + `list/route.ts` + `upload/route.ts` + `delete/route.ts` — same.
  - [x] 8.9: `app/api/cost/today/route.ts` — rewrite to query `cost_traces` directly.
  - [x] 8.10: `app/api/search-messages/route.ts` — rewrite to call `searchMessages()` directly.

- [x] **Task 9: Delete the FastAPI service and the old infra files**
  - [x] 9.1: `rm -rf memory-service/` (entire directory).
  - [x] 9.2: `rm memory-service/scripts/pb_bootstrap.py` (already gone with 9.1, but explicit).
  - [x] 9.3: `rm -rf lib/pocketbase.ts` (or replace with `lib/supabase/admin.ts` if not already done).
  - [x] 9.4: `rm lib/auth-store.ts`.
  - [x] 9.5: `rm app/api/auth/route.ts` (replaced by Supabase Auth).
  - [x] 9.6: `rm middleware.ts` (replaced by `@supabase/ssr` middleware).
  - [x] 9.7: `rm scripts/backup.sh` and `scripts/restore.sh` (Supabase handles backup).
  - [x] 9.8: `rm caddy/Caddyfile` if present.

- [x] **Task 10: Replace middleware with @supabase/ssr**
  - [x] 10.1: `pnpm add @supabase/ssr` (already done in Task 3).
  - [x] 10.2: `middleware.ts` — uses `createServerClient` with `next/headers` cookies; redirects unauthenticated requests to `/login` (using the cookie check from the spec).
  - [x] 10.3: `app/login/page.tsx` — rewrite to call `supabase.auth.signInWithPassword({ email, password })`.
  - [x] 10.4: Chat page "Sign out" button — call `supabase.auth.signOut()`.

- [x] **Task 11: Update Vercel config**
  - [x] 11.1: `vercel.json` at repo root with:
        - `buildCommand: "next build"`
        - `functions: { "app/api/chat/route.ts": { "maxDuration": 60 } }`
        - `crons: [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]`
        - `regions: ["iad1"]`
  - [x] 11.2: `app/api/cron/cleanup/route.ts` — purges expired `auth.sessions` and trims `cost_traces` older than 30 days. Verifies `Authorization: Bearer ${process.env.CRON_SECRET}`.
  - [x] 11.3: Set `CRON_SECRET` in Vercel project env vars.
  - [x] 11.4: Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel env vars.
  - [x] 11.5: Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel env vars.

- [x] **Task 12: Install the Vercel CLI and deploy**
  - [x] 12.1: `pnpm add -g vercel` (or `npm i -g vercel`).
  - [x] 12.2: `vercel login`.
  - [x] 12.3: `vercel link` — wires the repo to a Vercel project.
  - [x] 12.4: `vercel env pull .env.local` — pulls production env vars to local.
  - [x] 12.5: `vercel --prod` — deploys to production.

- [x] **Task 13: Verify end-to-end**
  - [x] 13.1: Sign in on the deployed URL with a test Supabase user.
  - [x] 13.2: Send "hi" — small-talk fast path returns "Hey!" within 1s.
  - [x] 13.3: Send "what is 7 squared?" — CoS uses CFO or Planner to compute; `run_code` runs on Vercel within 6s.
  - [x] 13.4: Send "remember my favorite color is teal" — Mem0-style or local memory stores it; next turn "what's my favorite color?" returns "teal".
  - [x] 13.5: Upload a small PDF; ask "what's in the PDF?" — Document agent finds a chunk.
  - [x] 13.6: Team Panel shows all SSE events (tool_start, tool_done, handoff, agent_message, code_run).
  - [x] 13.7: CostWidget shows a non-zero amount after 1 turn.
  - [x] 13.8: Sign out → redirected to `/login`. Sign in again → `messages` from before are still there (RLS + persistent storage work).
  - [x] 13.9: Run `pnpm test` — all 10 vitest files pass with Supabase mocks.

---

# Task Dependencies

- Task 1 (Supabase bootstrap) → Task 2 (migrations) → Task 3 (clients) → Task 4 (vector helpers) → Task 6 (rewrite memory-client) → Task 7 (rewrite chat route)
- Task 5 (match functions) → Task 4 (vector helpers) — they can be developed in parallel; the helpers just won't return data until 5 is applied
- Task 8 (rewrite FastAPI routes) depends on Task 6 (memory-client done) and Task 3 (clients installed)
- Task 9 (delete old files) must come AFTER Task 7 and Task 8 are complete (otherwise the app breaks mid-migration)
- Task 10 (middleware) depends on Task 3
- Task 11 (Vercel config) depends on Task 7 and Task 8
- Task 12 (Vercel deploy) depends on Task 11
- Task 13 (verify) depends on Task 12

**Recommended parallelization:**
- Week 1: Tasks 1-6 in sequence (foundation)
- Week 2: Tasks 7, 8, 10, 11 in parallel (rewrite + config)
- Week 3: Tasks 9, 12, 13 in sequence (cutover + deploy + verify)

Total: ~3 weeks for a careful migration, or ~1 week if you skip the cutover testing and just deploy the new code in place.
