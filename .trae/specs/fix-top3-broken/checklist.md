# Checklist — Fix Top 3 Broken Things

Verification checkpoints for the spec. Each is a single, testable assertion.

## Task 1 — Stream fallback

- [x] SF-1: `lib/agents/model.ts` exports `getResponseSync`.
- [x] SF-2: When the SDK stream yields no `output_text_delta` for ≥ 2 s,
      the chat route breaks out of the for-await loop.
- [x] SF-3: After the break, the route calls `getResponseSync` and emits
      the returned text as a single `token` event followed by `done`.
- [x] SF-4: When the SDK stream throws mid-loop, the route catches and
      emits an `error` event.
- [x] SF-5: The error path persists the partial assistant text to PB
      before closing the stream.
- [x] SF-6: `pnpm test:stream-fallback` passes with a mocked runner that
      yields zero deltas.
- [x] SF-7: A normal (non-broken) stream still streams tokens incrementally;
      the fallback path is dormant.

## Task 2 — TraceStore wired in

- [x] TR-1: `lib/tracing.ts` exports `recordToolCall` and `commitTurn`.
- [x] TR-2: Every `tool_done` event in `chat/route.ts` calls
      `recordToolCall(turnId, agent, tool, args, result, durationMs)`.
- [x] TR-3: `commitTurn` is called after `persistAfterStream` on the
      success, error, and conflict-pause paths.
- [x] TR-4: The trace row in SQLite includes a `payload.tool_calls` array
      with one entry per `tool_done`.
- [x] TR-5: The trace row includes `payload.cost_usd > 0` after one turn
      that used ≥ 100 output tokens.
- [x] TR-6: When the SDK does not return `usage`, the cost is estimated
      from text length and the trace row has `payload.usage.estimated: true`.
- [x] TR-7: After sending one chat turn, `/api/cost/today` returns
      `total_usd > 0` and a non-empty `by_agent`.
- [x] TR-8: The CostWidget in the Team Panel header displays a non-zero
      dollar amount within 30 s of a turn completing.

## Task 3 — Auth sessions in PocketBase

- [x] AU-1: `memory-service/scripts/pb_bootstrap.py` defines
      `AUTH_SESSIONS_SCHEMA` with `token` (unique), `user_id`, `expires_at`,
      `created_at`.
- [x] AU-2: Running `python scripts/pb_bootstrap.py` creates the
      `auth_sessions` collection idempotently.
- [x] AU-3: `lib/auth-store.ts` exports `createSession`, `lookupSession`,
      `deleteSession`.
- [x] AU-4: `POST /api/auth` with the correct password creates a row in
      `auth_sessions` and sets the `va_session` cookie.
- [x] AU-5: `POST /api/auth` with the wrong password returns 401 and
      creates no row.
- [x] AU-6: `DELETE /api/auth` deletes the matching row and clears the
      cookie.
- [x] AU-7: After a Next.js process restart, a request with a valid
      `va_session` cookie is still authenticated (the session row is
      still in PB).
- [x] AU-8: A request with a `va_session` cookie whose `expires_at` is in
      the past is treated as unauthenticated and the row is deleted.
- [x] AU-9: The chat page header has a "Sign out" button that calls
      `DELETE /api/auth` and redirects to `/login`.
- [x] AU-10: `pnpm test` (specifically `tests/auth-store.test.ts`)
      passes for create / lookup / expire-and-cleanup.

## Final acceptance

- [x] FA-1: All 8 acceptance criteria in `spec.md` pass.
- [x] FA-2: All 24 checklist items above are checked.
- [x] FA-3: The CostWidget shows a real (non-zero) number after one turn.
- [x] FA-4: A Next.js restart does not log the user out.
- [x] FA-5: A broken SDK stream still produces a user-visible response
      within 30 s.
