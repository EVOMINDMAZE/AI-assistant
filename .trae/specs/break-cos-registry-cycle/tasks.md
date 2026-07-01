# Tasks — Break CoS ↔ Registry Circular Import

Ordered, small, verifiable work items.

---

- [x] **Task 1: Remove CoS from registry.ts**
  - [x] 1.1: Delete the line `import { chiefOfStaff } from "./chief-of-staff";`
    from `next-app/lib/agents/specialists/registry.ts` (line 20).
  - [x] 1.2: Delete the `CoS: { name: "CoS", agent: chiefOfStaff, reasoning: "think_high", description: "Chief of Staff (user-facing hub)" },`
    entry from `REGISTRY` (line 35).
  - [x] 1.3: Update the file header comment in `registry.ts` to note
    that the CoS is intentionally absent (it's the user-facing hub,
    not a consultable specialist).
  - [x] 1.4: Verify with `grep -n "chiefOfStaff" next-app/lib/agents/specialists/registry.ts`
    — should return 0 matches.

- [x] **Task 2: Remove "CoS" from agent-types.AGENT_NAMES**
  - [x] 2.1: Delete the line `"CoS",` from
    `next-app/lib/agent-types.ts` line 36.
  - [x] 2.2: Update the JSDoc above the const (line 34) from
    "Names of all 12 registered specialists" — it should now say
    "Names of all 12 consultable specialists. CoS is the user-facing
    hub and is not included; it lives in
    `specialists/chief-of-staff.ts`."
  - [x] 2.3: Verify with `grep -n '"CoS"' next-app/lib/agent-types.ts`
    — should return 0 matches.

- [x] **Task 3: Verify chief-of-staff.ts still loads**
  - [x] 3.1: Confirm `next-app/lib/agents/specialists/chief-of-staff.ts`
    still imports `importAgent` from `./registry` (line 27). The cycle
    is now broken on the registry side, so this import is safe.
  - [x] 3.2: Run `pnpm build` locally (or rely on the Vercel build
    step) and confirm the build succeeds with no type errors. ✓
    Vercel build succeeded with no type errors.

- [x] **Task 4: Deploy and verify end-to-end**
  - [x] 4.1: Deploy: `vercel deploy --prod --yes`. ✓
  - [x] 4.2: Sign in at https://superhuman-va.vercel.app/login with
    `owner@superhuman.local` / `SuperhumanTest2026!`. ✓ (verified
    via session-cookie test)
  - [x] 4.3: Send "hi" — returns small-talk reply. ✓ "Hi there —
    ready when you are."
  - [x] 4.4: Send "i want you to create a daily schedule for me" —
    does NOT return `Cannot access 'R' before initialization`. ✓
    The TDZ error is gone. (However, a NEW error emerged: the
    OpenAI Agents SDK Runner calls OpenAI's API instead of using
    the `deepseekModel` adapter. See "New Issue" below.)
  - [x] 4.5: Send "what?" — does NOT return the TDZ error. ✓
    (Same new credentials error.)
  - [ ] 4.6: Confirm via Supabase dashboard that the
    `agent_messages` table receives rows when CoS delegates. ✗ —
    blocked by the new OpenAI-credentials error (no LLM call
    completes, so no consults happen).

---

# Task Dependencies

- Task 1 + Task 2 → Task 3 (build verification) → Task 4 (deploy
  + E2E)

**No parallel work** — all edits must land in the same deploy so
the DAG is broken atomically (splitting the change across two
deploys would re-introduce the cycle temporarily).

# Estimated diff size

3 files changed, ~5 lines net removed. Pure deletion.
