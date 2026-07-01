# Tasks — Fix Chat Auth

Ordered, small, verifiable work items.

---

- [x] **Task 1: Add a session helper in the chat route**
  - [x] 1.1: At the top of `app/api/chat/route.ts`, import
    `createServerSupabase` from `@/lib/supabase/server`.
  - [x] 1.2: Add a helper function `async function getAuthedUser():
    Promise<{ user: { id: string } } | { error: string }>` that calls
    `createServerSupabase().auth.getUser()` and returns either the
    user or an error string.
  - [x] 1.3: At the very top of the `POST` handler, call
    `getAuthedUser()`. If it returns an error, respond `401` with
    `{ error: "not signed in" }` and `return`.

- [x] **Task 2: Replace userId resolution in the chat route**
  - [x] 2.1: Replace the line `const userId: string = body.userId ||
    process.env.USER_ID || "local-user";` with `const userId: string =
    auth.user.id;` using the result of `getAuthedUser()`.
  - [x] 2.2: In the `handleConflictResolution` helper, do the same
    replacement.
  - [x] 2.3: In the `handleForgetEverything` helper, do the same
    replacement.
  - [x] 2.4: Remove all references to `process.env.USER_ID` in
    `app/api/chat/route.ts`. `grep -n USER_ID app/api/chat/route.ts`
    should return 0 matches.

- [x] **Task 3: Update the chat page to stop sending userId**
  - [x] 3.1: Delete line 23: `const USER_ID = "local-user"; // single-user MVP`.
  - [x] 3.2: In the `send` callback, remove `userId: USER_ID` from
    the body sent to `/api/chat` (line 77).
  - [x] 3.3: In the `handleConflictResolve` callback, remove
    `userId: USER_ID` from the body (line 201).
  - [x] 3.4: In the `handleForgetEverything` callback, remove
    `userId: USER_ID` from the body (line 264).
  - [x] 3.5: Update the `<Sidebar userId={USER_ID} />` prop (line
    303) — pass an empty string or fetch the user from the client
    Supabase session and pass `user.id`. (Sidebar currently uses
    this to load the conversation list; it should also be fixed to
    use the session.)
  - [x] 3.6: `grep -n "USER_ID\|userId" app/chat/page.tsx` should
    show 0 hits in the body fields.

- [x] **Task 4: Update Sidebar to use the auth session**
  - [x] 4.1: `components/sidebar.tsx` — read the user from
    `createBrowserSupabase().auth.getUser()` in a `useEffect`, and
    use `user.id` for the API call. Remove the `userId` prop.
  - [x] 4.2: Update the `SidebarProps` interface accordingly.

- [x] **Task 5: Verify end-to-end**
  - [x] 5.1: Deploy to Vercel: `vercel deploy --prod --yes`.
  - [x] 5.2: Open the deployed URL, sign in with the test user.
  - [x] 5.3: Send "hi" — should get "Hi there — ready when you are."
    back within 1s. No 503.
  - [x] 5.4: Open browser DevTools → Network tab → inspect the
    request body. It should be `{ message: "hi" }` (no `userId`).
  - [x] 5.5: Open Supabase dashboard → `conversations` table — the
    new row's `user_id` should be the test user's UUID, not
    "local-user".
  - [x] 5.6: Sign out → request without a session cookie → 401.
  - [x] 5.7: Click 🧹 → all rows for the test user are deleted.

---

# Task Dependencies

- Task 1 (helper) → Task 2 (replace in route) → Task 5 (verify)
- Task 3 (chat page) is independent of Task 2 but should land
  together so the wire format matches
- Task 4 (Sidebar) can be done in parallel with Task 2/3

**Recommended order:** 1 → 2 → 3 + 4 (parallel) → 5.
