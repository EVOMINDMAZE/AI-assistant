# Fix Top 3 Broken Things Spec

## Why

The `build-production-swarm` spec was implemented end-to-end, but a candid
status review surfaced three high-risk defects that will block production use:

1. **Chat route stream translation** — the `for await` loop in
   `app/api/chat/route.ts` assumes a specific OpenAI Agents SDK 0.3 stream
   event shape. If the shape is different, no tokens stream and the user
   sees a hung request.
2. **Tracing not wired** — `lib/tracing.ts` and the cost widget both read
   from `TraceStore`, but `chat/route.ts` never calls `TraceStore.append()`.
   The Cost Widget will always show $0.00 and we have no observability.
3. **Auth sessions in-memory** — `SESSIONS` map in `app/api/auth/route.ts`
   dies on every Next.js restart, logging out the user. Acceptable for dev,
   blocking for prod.

## What Changes

- **Pin the SDK stream event shape** with a thin shim + a fallback
  `getResponse()` path. If the stream yields zero `output_text_delta`
  events within 2s, fall back to a non-streaming call and emit the
  full text as a single `token` event. This guarantees the user always
  sees a response.
- **Wire `TraceStore.append()` into `chat/route.ts`** at end-of-stream and
  on every `tool_start`/`tool_done`. Capture the `result.usage` from the
  SDK (or estimate from text length if missing) and write the trace.
- **Persist auth sessions in PocketBase** instead of in-memory. Add an
  `auth_sessions` collection (token, user_id, expires_at, created_at) and
  a 60-day TTL cleanup. Sessions survive process restarts.

## Impact

- Affected specs: `build-production-swarm` (amends, does not replace)
- Affected code:
  - `next-app/app/api/chat/route.ts` (stream fallback + trace writes)
  - `next-app/lib/tracing.ts` (add `recordToolCall()` helper)
  - `next-app/lib/agents/model.ts` (expose `getResponseSync()` for fallback)
  - `next-app/app/api/auth/route.ts` (replace SESSIONS map with PB)
  - `memory-service/scripts/pb_bootstrap.py` (add `auth_sessions` schema)
  - `next-app/app/login/page.tsx` (handle "session expired, please re-login")

## ADDED Requirements

### Requirement: SSE stream fallback

The chat route SHALL guarantee a user-visible response within 30 seconds,
even if the OpenAI Agents SDK stream emits no `output_text_delta` events.

#### Scenario: SDK stream yields no deltas
- **WHEN** `runner.runStreamed()` produces no `raw_model_stream_event`
  with `type === "output_text_delta"` for ≥ 2 seconds
- **THEN** the route falls back to a non-streaming `runner.run()` and
  emits the final text as a single `token` event followed by `done`

#### Scenario: SDK throws mid-stream
- **WHEN** the for-await loop over SDK events throws
- **THEN** the route catches the error, emits an `error` SSE event, and
  persists whatever partial text was accumulated

### Requirement: Tracing is wired into the chat route

Every chat turn SHALL be recorded in `TraceStore` with at least:
- CoS input (system prompt + user message, first 500 chars)
- All `tool_start` events (agent, tool, args)
- All `tool_done` events (agent, tool, result, duration_ms)
- Final assistant text
- Token usage estimate (input chars / 4, output chars / 4, reasoning = 0
  unless reported by SDK)
- Cost in USD computed from usage

#### Scenario: Chat turn completes
- **WHEN** a turn finishes (success, error, or pause)
- **THEN** exactly one `TraceStore.append()` call is made with the full
  trace payload

#### Scenario: CostWidget requested
- **WHEN** the user opens the chat page
- **THEN** `/api/cost/today` returns today's total cost and per-agent
  breakdown based on the actual traces (not zeros)

### Requirement: Auth sessions persist across restarts

`/api/auth` SHALL store sessions in PocketBase, not in process memory.

#### Scenario: User signs in
- **WHEN** `POST /api/auth` with the correct password
- **THEN** a row is created in `auth_sessions` with `token` (32 random
  bytes hex), `expires_at` (60 days from now), `created_at` (now)
- **AND** a HttpOnly + SameSite=Strict cookie is set

#### Scenario: User reloads after a server restart
- **WHEN** the user has a valid `va_session` cookie and the Next.js
  process has been restarted
- **THEN** they remain signed in (the cookie token is still present in
  the `auth_sessions` table and not expired)

#### Scenario: Expired session
- **WHEN** a request has a `va_session` cookie whose `expires_at < now`
- **THEN** the row is deleted and the user is redirected to `/login`
  with a toast "Your session expired, please sign in again."

## MODIFIED Requirements

### Requirement: Rate limiting (already in `build-production-swarm`)

No changes — the existing 60/conv/h and 200/user/h limits stay.

### Requirement: Resilient SSE buffer (already in `build-production-swarm`)

The 5-min in-memory `SSE_BUFFER` stays. The `Last-Event-Id` replay path
is unaffected by this fix.

## REMOVED Requirements

None.

## Migration

No data migration needed. The old in-memory `SESSIONS` map is replaced
by PocketBase rows from this point forward. Pre-existing browser cookies
become invalid (users must sign in once after deploy) — acceptable.
