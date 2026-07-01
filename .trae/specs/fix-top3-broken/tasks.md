# Tasks — Fix Top 3 Broken Things

Ordered, small, verifiable work items. Each ends with a runnable check.

---

- [x] **Task 1: Add stream-fallback path to the chat route**
  - [x] 1.1: In `lib/agents/model.ts`, export `getResponseSync(agent, input, ctx)`
        that calls `runner.run()` (non-streaming) and returns `{ text, usage }`.
  - [x] 1.2: In `app/api/chat/route.ts`, wrap the `for await` loop with a
        2-second watchdog: track `lastDeltaAt` and if no delta arrives
        within 2s, break out and call `getResponseSync()` instead.
  - [x] 1.3: After the fallback, emit the text as a single `token` event,
        then a `done` event, then close the stream.
  - [x] 1.4: Wrap the entire `for await` block in a try/catch that emits
        an `error` event and persists whatever partial text was captured.
  - [x] 1.5: Add a `pnpm test:stream-fallback` test (vitest) that mocks
        the runner to emit zero deltas and asserts the route still
        produces a `done` event with text.

- [x] **Task 2: Wire TraceStore into the chat route**
  - [x] 2.1: In `lib/tracing.ts`, add `recordToolCall(turnId, agent, tool,
        args, result, durationMs)` helper that appends to an in-memory
        buffer keyed by `turnId`.
  - [x] 2.2: In `lib/tracing.ts`, add `commitTurn(turnId, conversationId,
        userId, finalText, usage)` that writes the buffered tool calls +
        final text + cost to the trace table.
  - [x] 2.3: In `app/api/chat/route.ts`, call `recordToolCall` on every
        `tool_done` event (passing the agent + tool + result + duration).
  - [x] 2.4: In `app/api/chat/route.ts`, call `commitTurn` after
        `persistAfterStream` completes (success, error, and conflict-pause
        paths).
  - [x] 2.5: Estimate token usage from text length (`Math.ceil(text.length
        / 4)`) when the SDK doesn't return `usage`; mark it as `estimated:
        true` in the trace payload.
  - [x] 2.6: Verify the CostWidget now shows non-zero values by sending
        one turn and watching `/api/cost/today`.

- [x] **Task 3: Move auth sessions to PocketBase**
  - [x] 3.1: In `memory-service/scripts/pb_bootstrap.py`, add
        `AUTH_SESSIONS_SCHEMA` with fields: `token` (text, unique index),
        `user_id` (text), `expires_at` (date), `created_at` (date, auto).
  - [x] 3.2: Add a `lib/auth-store.ts` module with `createSession(userId,
        ttlDays)` → `{ token, expiresAt }` and `lookupSession(token)` →
        `{ userId, expiresAt } | null` and `deleteSession(token)`.
  - [x] 3.3: In `app/api/auth/route.ts`, replace the in-memory `SESSIONS`
        map with calls to `auth-store.ts`. Keep the same cookie name and
        HttpOnly + SameSite=Strict attributes.
  - [x] 3.4: In `app/api/auth/route.ts`, add a `DELETE` handler that
        deletes the session row matching the request's cookie and clears
        the cookie (for the "Sign out" button).
  - [x] 3.5: Add a "Sign out" button to the chat page header that calls
        `DELETE /api/auth` and redirects to `/login`.
  - [x] 3.6: Add a vitest test `tests/auth-store.test.ts` with a mock PB
        that creates a session, looks it up, expires it (set `expires_at`
        to the past), and asserts the lookup returns null and the row is
        deleted.

---

# Task Dependencies

- Task 1 (stream fallback) is independent.
- Task 2 (tracing) depends on `lib/tracing.ts` already existing (yes, from
  `build-production-swarm`).
- Task 3 (PB sessions) depends on PB bootstrap (already exists) and the
  PocketBase admin helper `pbAsAdmin()` (already exists).

All three tasks can be developed in parallel after this spec is approved.
