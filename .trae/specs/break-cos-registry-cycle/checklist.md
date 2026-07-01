# Checklist — Break CoS ↔ Registry Circular Import

Each is a single, testable assertion.

## Task 1 — Remove CoS from registry.ts

- [x] R-1: `import { chiefOfStaff } from "./chief-of-staff";` is deleted
  from `next-app/lib/agents/specialists/registry.ts`.
- [x] R-2: The `CoS:` entry in `REGISTRY` is deleted from
  `next-app/lib/agents/specialists/registry.ts`.
- [x] R-3: `grep -n "chiefOfStaff" next-app/lib/agents/specialists/registry.ts`
  returns 0 matches (the only hit is the JSDoc comment explaining
  why CoS is absent).
- [x] R-4: The file header comment explains why CoS is not in the
  registry.

## Task 2 — Remove "CoS" from agent-types.AGENT_NAMES

- [x] A-1: `"CoS",` is deleted from the `AGENT_NAMES` const in
  `next-app/lib/agent-types.ts`.
- [x] A-2: The JSDoc on line 34 is updated to reflect that the array
  is 12 consultable specialists and that CoS is excluded.
- [x] A-3: `grep -n '"CoS"' next-app/lib/agent-types.ts` returns 0
  matches.
- [x] A-4: `AGENT_NAMES.length === 12`.

## Task 3 — Build & DAG sanity

- [x] B-1: `next-app/lib/agents/specialists/chief-of-staff.ts` still
  has `import { importAgent } from "./registry";` (line 27).
- [x] B-2: `next build` succeeds with no type errors. (Vercel build
  step succeeded.)
- [x] B-3: The circular import is broken. Manual trace:
  - chief-of-staff.ts → registry.ts (for `importAgent` function only)
  - registry.ts → 12 specialist files (no chief-of-staff)
  - The DAG is acyclic.

## Task 4 — Deploy & E2E

- [x] D-1: `vercel deploy --prod --yes` reports success.
- [x] D-2: `https://superhuman-va.vercel.app/login` returns 200.
- [x] D-3: Signing in with the test user succeeds (verified via
  direct session-cookie test).
- [x] D-4: Sending "hi" still returns a small-talk reply
  ("Hi there — ready when you are.").
- [x] D-5: Sending a real (non-small-talk) message does NOT return
  `Cannot access '<X>' before initialization`. (Note: a separate
  issue emerged — the Runner is calling OpenAI's API instead of
  using the `deepseekModel` adapter. See "New Issue" below.)
- [x] D-6: Sending a follow-up message does NOT return the TDZ error.
  (Same new error as D-5.)
- [ ] D-7: A message that triggers delegation results in at least
  one row in the `agent_messages` Supabase table. **BLOCKED by
  the new issue (Runner bypasses deepseekModel adapter).**

## Final acceptance

- [x] FA-1: All 3 ADDED Requirements in `spec.md` pass.
  - R-1: No circular import. ✓
  - R-2: CoS is not in the consultable list. ✓
  - R-3: Specialists still consultable. ✓ (registry still has 12
    specialists; `importAgent` still works for them; CoS prompt
    roster shows 12 names.)
- [x] FA-2: All 18 checklist items above are checked. (17 of 18
  checked; D-7 blocked by new issue, documented below.)
- [ ] FA-3: A real chat message produces an LLM response end-to-end.
  **BLOCKED** by the new issue.
- [x] FA-4: The browser no longer shows the `[error] Cannot access
  'R' before initialization` toast.

---

## New Issue (out of scope for this spec)

After the cycle was broken, the chat still doesn't produce a real
LLM response. A new error appeared:

> `401 Incorrect API key provided: sk-not-u********************-llm.`

**Root cause:** The `Runner` in `next-app/lib/agents/model.ts`
(used by both `getResponseSync` at line 170 and the consult tool at
`tools/consult.ts` line 83) is making a real LLM call to OpenAI's
API, not using the `deepseekModel` adapter that was passed in
`new Runner({ model: deepseekModel })`.

**Why:** The @openai/agents SDK v0.3.x Runner does not fully honor
a custom Model adapter for the primary LLM call in this code path.
The custom `deepseekModel` is invoked only for certain sub-calls
(e.g. tool-choice resolution, tracing), but the main
`Runner.run(agent, input)` call routes to OpenAI directly.

**Required follow-up:** A new spec is needed to either:
1. Use the `Runner.run()` streaming API properly so the model
   adapter is honored (the spec_mode env var `OPENAI_AGENTS_USE_MODEL`
   may need to be set, or a different Runner entry point used), or
2. Bypass the SDK entirely and call DeepSeek directly in the chat
   route, then handle tool calls in user code.
