# Checklist — Migrate to Vercel + Supabase

Verification checkpoints for the spec. Each is a single, testable assertion.

## Task 1 — Supabase bootstrap

- [x] SB-1: `supabase --version` returns ≥ 1.200.
- [x] SB-2: `supabase login` completes without error.
- [x] SB-3: `supabase init` creates `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql`.
- [x] SB-4: A Supabase project named `superhuman-va` exists in the user's dashboard.
- [x] SB-5: `supabase link --project-ref <ref>` exits 0.
- [x] SB-6: `supabase status` shows the project is linked and the DB is reachable.

## Task 2 — SQL migrations

- [x] MG-1: `supabase/migrations/0001_init.sql` exists.
- [x] MG-2: The migration creates all 7 tables (`conversations`, `messages`, `agent_state`, `agent_messages`, `memories`, `documents`, `message_index`, `cost_traces`).
- [x] MG-3: The migration creates the `vector` extension.
- [x] MG-4: The migration creates HNSW indexes on `memories.embedding`, `documents.embedding`, `message_index.embedding`.
- [x] MG-5: RLS is enabled on all 7 tables.
- [x] MG-6: RLS policies exist that scope reads to `auth.uid() = user_id` (or via conversation_id for messages).
- [x] MG-7: `supabase db push` applies the migration to the remote project without error.
- [x] MG-8: Querying the dashboard Table Editor shows all 7 tables.

## Task 3 — Supabase clients

- [x] CL-1: `@supabase/supabase-js` and `@supabase/ssr` are in `next-app/package.json`.
- [x] CL-2: `lib/supabase/server.ts` exports `createServerClient()`.
- [x] CL-3: `lib/supabase/client.ts` exports `createBrowserClient()`.
- [x] CL-4: `lib/supabase/admin.ts` exports `createAdminClient()` (uses service role key).
- [x] CL-5: `.env.local.example` has the 3 Supabase env vars documented.

## Task 4 — pgvector helpers

- [x] PV-1: `lib/supabase/vector.ts` exports `upsertMemory`, `searchMemories`, `upsertDocument`, `searchDocuments`, `indexMessage`, `searchMessages`.
- [x] PV-2: Each helper takes a `userId` and uses the admin client.
- [x] PV-3: Each vector helper calls the corresponding `match_<table>` SQL function from 0002.
- [x] PV-4: `searchMemories` returns `{ id, fact, score, metadata }[]` sorted by `score ASC` (cosine distance — lower is better).

## Task 5 — Match functions

- [x] MF-1: `supabase/migrations/0002_match_functions.sql` exists.
- [x] MF-2: `match_memories(embedding, user_id, match_count)`, `match_documents(...)`, `match_message_index(...)` are defined.
- [x] MF-3: Each function uses `ORDER BY embedding <=> $1 ASC LIMIT $3`.
- [x] MF-4: Each function returns a typed `TABLE(...)` with `score FLOAT` (the distance).
- [x] MF-5: `supabase db push` applies 0002 without error.

## Task 6 — Memory client rewrite

- [x] MC-1: `lib/memory-client.ts` no longer calls `fetch()` for any route.
- [x] MC-2: All public methods (`addMemory`, `searchMemory`, `addGlobalMemory`, `searchGlobalMemory`, `listGlobalFacts`, `clearMemories`, `clearGlobalMemories`, `searchDocuments`, `listDocuments`, `indexMessage`, `searchMessages`, `clearMessages`) still exist with the same signatures.
- [x] MC-3: Unit tests in `tests/messaging.test.ts` and `tests/state.test.ts` still pass (now with `@/lib/supabase/admin` mocked instead of `@/lib/pocketbase`).

## Task 7 — Chat route rewrite

- [x] CR-1: `app/api/chat/route.ts` no longer imports `pbAsAdmin` or `lib/pocketbase`.
- [x] CR-2: `loadHistory` uses `supabase.from("messages").select(...)`.
- [x] CR-3: `loadStateSafe` uses `supabase.from("agent_state").select(...)`.
- [x] CR-4: `persistAfterStream` uses `supabase.from("messages").insert(...)` and `supabase.from("agent_state").upsert(...)`.
- [x] CR-5: `forget_everything` branch uses `supabase.from(<table>).delete()` for all 6 user-scoped tables.
- [x] CR-6: The SSE stream still works (token, tool_start, tool_done, handoff, agent_message, code_run, conflict, conflict_resolved, error, done).
- [x] CR-7: The 2-second stream watchdog + `getResponseSync` fallback still works (inherited from `fix-top3-broken`).

## Task 8 — API route rewrites

- [x] AR-1: `app/api/memories/*` (8 routes) call `lib/memory-client.ts` instead of the FastAPI service.
- [x] AR-2: `app/api/documents/*` (4 routes) call `lib/memory-client.ts`.
- [x] AR-3: `app/api/cost/today` queries `cost_traces` directly.
- [x] AR-4: `app/api/search-messages` calls `searchMessages()` directly.
- [x] AR-5: No route still fetches a `MEMORY_SERVICE_URL` (the env var is no longer needed).

## Task 9 — Old infra deleted

- [x] DL-1: `memory-service/` directory is gone.
- [x] DL-2: `lib/pocketbase.ts` is gone (or empty).
- [x] DL-3: `lib/auth-store.ts` is gone.
- [x] DL-4: `app/api/auth/route.ts` is gone.
- [x] DL-5: `middleware.ts` no longer references the custom cookie check (replaced by Supabase one).
- [x] DL-6: `scripts/backup.sh` and `scripts/restore.sh` are gone.
- [x] DL-7: `caddy/Caddyfile` is gone (if it existed).
- [x] DL-8: `grep -r "pbAsAdmin\|MEMORY_SERVICE_URL\|pocketbase\|caddy" .` returns no hits in the Next.js app code.

## Task 10 — Supabase Auth + middleware

- [x] AU-1: `middleware.ts` uses `@supabase/ssr` `createServerClient` with cookie passthrough.
- [x] AU-2: Unauthenticated requests to `/chat` are redirected to `/login`.
- [x] AU-3: `app/login/page.tsx` calls `supabase.auth.signInWithPassword({ email, password })`.
- [x] AU-4: On success, the user is redirected to `/chat`.
- [x] AU-5: The chat header "Sign out" button calls `supabase.auth.signOut()` and redirects to `/login`.
- [x] AU-6: No `APP_PASSWORD_HASH` env var is needed anymore (the bcrypt flow is gone).

## Task 11 — Vercel config

- [x] VC-1: `vercel.json` exists at the repo root.
- [x] VC-2: `vercel.json` configures `functions[app/api/chat/route.ts].maxDuration = 60`.
- [x] VC-3: `vercel.json` configures a cron schedule for `/api/cron/cleanup` at `0 3 * * *`.
- [x] VC-4: `app/api/cron/cleanup/route.ts` exists and verifies the `Authorization: Bearer ${CRON_SECRET}` header.
- [x] VC-5: `CRON_SECRET` is set in the Vercel project's env vars.
- [x] VC-6: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are set in the Vercel project's env vars.

## Task 12 — Vercel deploy

- [x] VD-1: `vercel --version` returns ≥ 33.
- [x] VD-2: `vercel login` completes.
- [x] VD-3: `vercel link` is run; a `.vercel/` directory exists.
- [x] VD-4: `vercel env pull .env.local` populates the local env file.
- [x] VD-5: `vercel --prod` builds and deploys; the URL responds 200 on `/login`.
- [x] VD-6: The deployed URL has a valid HTTPS certificate (Vercel-managed).

## Task 13 — End-to-end verification

- [x] EV-1: A test Supabase user can sign up (via the dashboard or `supabase auth admin invite`).
- [x] EV-2: Sign in with email + password on `/login` → redirected to `/chat`.
- [x] EV-3: "hi" returns "Hey!" within 1s (small-talk fast path).
- [x] EV-4: "what is 7 squared?" returns "49" via the `run_code` or `compute` tool within 6s.
- [x] EV-5: "remember my favorite color is teal" followed by "what's my favorite color?" returns "teal".
- [x] EV-6: Upload a small PDF and ask "what's in the PDF?" → Document agent returns a relevant chunk.
- [x] EV-7: Team Panel shows the SSE events for the above turns.
- [x] EV-8: CostWidget shows a non-zero amount after 1 turn.
- [x] EV-9: Sign out → redirected to `/login`. Sign in again → previous messages are still there.
- [x] EV-10: `pnpm test` passes (all 10 vitest files) with Supabase mocks.
- [x] EV-11: RLS test: a second user cannot see the first user's data.

## Final acceptance

- [x] FA-1: All 11 ADDED Requirements in `spec.md` pass.
- [x] FA-2: All 60+ checklist items above are checked.
- [x] FA-3: The app runs end-to-end on Vercel + Supabase at < $0/mo (free tier).
- [x] FA-4: No `pocketbase`, `qdrant`, `caddy`, `memory-service` references remain in the active codebase.
- [x] FA-5: The 10 golden questions in `eval/golden.yaml` pass against the deployed app.
