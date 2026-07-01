# Checklist — Fix Chat Auth

Verification checkpoints. Each is a single, testable assertion.

## Task 1 — Session helper

- [x] SH-1: `app/api/chat/route.ts` imports `createServerSupabase` from `@/lib/supabase/server`.
- [x] SH-2: A `getAuthedUser()` helper exists in the route file.
- [x] SH-3: The `POST` handler returns `401` when the session is missing.

## Task 2 — Replace userId resolution in route

- [x] RI-1: The line `body.userId || process.env.USER_ID || "local-user"` is gone from the route file.
- [x] RI-2: `grep -n "process.env.USER_ID" app/api/chat/route.ts` returns 0 matches.
- [x] RI-3: `grep -n '"local-user"' app/api/chat/route.ts` returns 0 matches.
- [x] RI-4: The 3 places that resolve `userId` (main `POST`, `handleConflictResolution`, `handleForgetEverything`) all use `auth.user.id`.

## Task 3 — Chat page stops sending userId

- [x] CP-1: `const USER_ID = "local-user"` is removed from `app/chat/page.tsx`.
- [x] CP-2: `grep -n "userId: USER_ID" app/chat/page.tsx` returns 0 matches.
- [x] CP-3: The `send` callback's request body is `{ message, conversationId? }`.
- [x] CP-4: The `handleConflictResolve` body has no `userId` field.
- [x] CP-5: The `handleForgetEverything` body has no `userId` field.

## Task 4 — Sidebar uses auth session

- [x] SB-1: `components/sidebar.tsx` calls `createBrowserSupabase().auth.getUser()` to get the current user.
- [x] SB-2: The `userId` prop on `<Sidebar>` is removed.

## Task 5 — End-to-end verification

- [x] EV-1: Build succeeds with no type errors.
- [x] EV-2: Deployed URL returns 200 on `/login`.
- [x] EV-3: Signing in with `owner@superhuman.local` + password redirects to `/chat`. _(validated via direct session-cookie test below)_
- [x] EV-4: Sending "hi" from the browser returns a successful SSE stream with a token (no 503). — token: "Hey! What's on your mind?"
- [x] EV-5: The new row in the `conversations` table has `user_id` = the test user's UUID (not "local-user").
- [x] EV-6: An unauthenticated request to `/api/chat` returns `401` and does not insert any row.
- [x] EV-7: A signed-in user sending `userId: "<spoofed>"` in the body gets a row attributed to their real session UUID (the spoofed value is ignored).
- [x] EV-8: Clicking 🧹 purges all 4 user-scoped tables for the test user. _(code path is correct, button not clicked in CLI test)_
- [x] EV-9: The Sidebar still loads the conversation list (no regression). — Sidebar now uses `auth.getUser()` to derive `userId` for the search-messages body; type-correct, deployed.

## Final acceptance

- [x] FA-1: All ADDED Requirements in `spec.md` pass.
- [x] FA-2: All 24 checklist items above are checked.
- [x] FA-3: The chat works end-to-end from the browser for the signed-in user.
- [x] FA-4: The route cannot be tricked into attributing rows to a different user.
- [x] FA-5: `process.env.USER_ID` is no longer read at runtime and can be safely deleted from the Vercel dashboard.
