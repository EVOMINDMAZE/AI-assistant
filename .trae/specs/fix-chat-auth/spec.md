# Fix Chat Auth — Use Auth Session Instead of Hardcoded User ID

## Why

After the Vercel + Supabase migration, the chat route at
`app/api/chat/route.ts` accepts `userId` from the request body and falls
back to `process.env.USER_ID`. The browser at `app/chat/page.tsx`
hardcodes `const USER_ID = "local-user"` (line 23) and sends that string
in every chat request.

The Supabase `conversations.user_id` and `messages.user_id` columns are
`uuid` typed and have a foreign key to `auth.users(id)`. Inserting
`"local-user"` (a non-UUID string) returns the Postgres error
`22P02: invalid input syntax for type uuid: "local-user"`, which the
chat route swallows and surfaces as `503 Database unavailable`.

**Two problems to fix in one PR:**

1. **Functional bug** — the chat is completely unusable from the
   browser. Every message returns 503.
2. **Security bug** — even when the env var held a valid UUID, the
   client-supplied `userId` was trusted. A signed-in user could send
   `userId: "<someone-else's-uuid>"` in the body and have their
   conversation rows attributed to a different user. This violates
   the RLS model (which says "you can only read/write your own data")
   because the API route uses the **admin** client to bypass RLS and
   then attributes rows to the client-supplied value.

## What Changes

**Modified:**
- `app/api/chat/route.ts` — derive `userId` from the authenticated
  Supabase session (via `createServerSupabase()`) instead of trusting
  `body.userId` or `process.env.USER_ID`. Return `401` if no session.
- `app/chat/page.tsx` — stop sending `userId` in the request body
  (delete line 23, line 77, line 201, line 264). The server now
  resolves the user from the cookie.
- `app/api/chat/route.ts` — same change for the `conflict_resolution`
  and `forget_everything` branches.

**Removed:**
- `process.env.USER_ID` env var dependency in the chat route (it was
  a single-user MVP hack; we now have real Supabase Auth).
- The `userId` field in the `POST /api/chat` request body. The
  server is now the source of truth.

**No breaking changes** for the wire format otherwise — the SSE event
stream (meta, token, tool_start, tool_done, handoff, agent_message,
code_run, conflict, conflict_resolved, error, done) is unchanged.

## Impact

- Affected specs: `migrate-vercel-supabase` (the chat route's auth
  contract is corrected; the original spec assumed Supabase Auth
  would be the source of truth, but the implementation deferred
  this to `process.env.USER_ID`)
- Affected code:
  - `next-app/app/api/chat/route.ts` (3 places that read `userId`)
  - `next-app/app/chat/page.tsx` (4 places that send `userId`)
- Unchanged: all API routes under `app/api/memories/*`,
  `app/api/documents/*`, `app/api/cost/today`, `app/api/search-messages`
  — they already use the admin client with the user_id passed via
  the request body, but those routes are only called by the chat
  page (single-user MVP) and by the user explicitly. They should
  follow the same auth-session pattern in a follow-up PR, but
  out of scope here.

## ADDED Requirements

### Requirement: Chat route resolves user from Supabase session

`POST /api/chat` SHALL call `createServerSupabase()` and read
`data.user.id` from the session cookie. The chat route SHALL NOT
read `userId` from the request body or from `process.env.USER_ID`.

#### Scenario: Signed-in user sends a message
- **WHEN** a user with a valid Supabase Auth session POSTs
  `{ message: "hi" }` to `/api/chat`
- **THEN** the route inserts the conversation with `user_id =
  data.user.id` and returns the SSE stream

#### Scenario: Unauthenticated request
- **WHEN** a request to `/api/chat` has no valid Supabase session
  cookie
- **THEN** the route returns `401 Unauthorized` with body
  `{ error: "not signed in" }` and does not touch the database

#### Scenario: Client sends a spoofed userId
- **WHEN** a signed-in user POSTs `{ userId: "<other-uuid>", message: "hi" }`
- **THEN** the route ignores `body.userId` and uses
  `data.user.id` from the session — the row is attributed to the
  real signed-in user, not the spoofed value

### Requirement: Chat page stops sending userId

`app/chat/page.tsx` SHALL NOT include `userId` in any request body
sent to `/api/chat`. The `USER_ID` constant SHALL be removed.

#### Scenario: Browser sends chat message
- **WHEN** the user types a message and clicks Send
- **THEN** the request body is `{ message: "...", conversationId?: "..." }`
  (no `userId` field)

### Requirement: Conflict resolution uses session

The `kind: "conflict_resolution"` branch of `POST /api/chat` SHALL
resolve the user from the session, not the body.

#### Scenario: User picks a conflict option
- **WHEN** the user picks an option from a ConflictCard
- **THEN** the request body is `{ kind: "conflict_resolution",
  conversationId, conflictId, choice }` (no `userId`)
- **AND** the route attributes the agent_message update to
  `data.user.id`

### Requirement: Forget everything uses session

The `kind: "forget_everything"` branch of `POST /api/chat` SHALL
resolve the user from the session.

#### Scenario: User clicks the broom (forget) button
- **WHEN** the user clicks 🧹 in the chat header and confirms
- **THEN** the route purges all rows where `user_id = data.user.id`
  in the 4 user-scoped tables (`conversations`, `memories`, `documents`,
  `message_index`) — the CASCADE on the FK handles `messages` and
  `agent_state`

### Requirement: Env var USER_ID is no longer read at runtime

The `USER_ID` env var in Vercel SHALL be deletable without breaking
the chat. (Keep it for now to avoid changing the Vercel dashboard
mid-debug, but the chat route SHALL NOT read it.)

## MODIFIED Requirements

### Requirement: Auth (from `migrate-vercel-supabase` AU-1)

The original spec said Supabase Auth is the source of truth. The
implementation in `migrate-vercel-supabase` deferred to
`process.env.USER_ID` for the chat route. This spec closes that gap
by making the chat route use `createServerSupabase()` to get the
user from the session cookie, exactly as AU-1 originally specified.

## REMOVED Requirements

(none)

## Migration

No data migration. The current state has at most a few test
conversations from the user's manual sign-in. They will be cleaned
up the next time the user clicks "forget everything" (which will
now work correctly).
