# Tasks — Production Swarm

Ordered list of small, verifiable work items. Each task has a clear deliverable and a "done when" check.

---

## Phase 0 — V1 verification (no new code, just smoke tests)

- [x] **Task 0.1: V1 MVP smoke test** — verify the existing V1 features work end-to-end in a browser.
  - [x] 0.1.1: Bring up the docker stack (`docker compose up -d`) and confirm all 5 services are healthy.
  - [x] 0.1.2: Open `http://localhost:3000` and confirm the chat UI loads.
  - [x] 0.1.3: Send a message, confirm a streamed response from DeepSeek within 4 s p50.
  - [x] 0.1.4: Refresh the page and confirm the conversation is still there (PocketBase persistence).
  - [x] 0.1.5: Upload a PDF, wait 10 s, search for a word in it, confirm the chunk is returned.
  - [x] 0.1.6: Confirm the Memory Panel lists at least 1 fact learned from the chat.
  - [x] 0.1.7: Confirm the Conversation Sidebar lists at least 1 conversation.

---

## Phase 1 — Framework & infrastructure (V2 core foundations)

- [x] **Task 1.1: Install OpenAI Agents SDK + Tavily** — add the two new npm dependencies.
  - [x] 1.1.1: `cd next-app && npm install @openai/agents tavily` (use latest stable versions).
  - [x] 1.1.2: Add `TAVILY_API_KEY=tvly-replace-me` to `next-app/.env.local.example` and `next-app/.env.example`.
  - [x] 1.1.3: Verify the SDK loads: `node -e "import('@openai/agents').then(m => console.log(Object.keys(m)))"`.

- [x] **Task 1.2: DeepSeek V4 Pro model adapter** — write the custom `Model` for `@openai/agents`.
  - [x] 1.2.1: Create `next-app/lib/agents/model.ts` with `MODEL = "deepseek-v4-pro"`.
  - [x] 1.2.2: Implement `deepseekModel: Model` with `getResponse` and `streamResponse` that call DeepSeek's OpenAI-compat endpoint.
  - [x] 1.2.3: Implement the `reasoningParams(mode)` translation (non_think / think_high / think_max) per the spec.
  - [x] 1.2.4: Run the hello-world test (per SCENARIO in spec.md) and confirm it prints "Hello, world.".
  - [x] 1.2.5: Verify the per-agent reasoning mode is honored (per SCENARIO in spec.md).
  - [x] 1.2.6: Confirm `delta.reasoning_content` is logged at debug level but NOT forwarded to the client.

- [x] **Task 1.3: New PocketBase collections** — add `agent_state` and `agent_messages`.
  - [x] 1.3.1: Edit `memory-service/scripts/pb_bootstrap.py` to add `AGENT_STATE_SCHEMA` and `AGENT_MESSAGES_SCHEMA` per the spec.
  - [x] 1.3.2: Run `python scripts/pb_bootstrap.py` against the running PB and confirm both collections are created.
  - [x] 1.3.3: Re-run the script and confirm it's idempotent (no errors, no duplicate collections).
  - [x] 1.3.4: Test a unique index on `agent_state (conversation_id, agent_name)` by attempting to insert a duplicate.

- [x] **Task 1.4: Mem0 global facts pool** — add the `memories_global` Qdrant collection and the 3 new endpoints.
  - [x] 1.4.1: Edit `memory-service/app/qdrant_client.py` to add the `memories_global` collection (auto-create on startup, same schema as `memories`).
  - [x] 1.4.2: Edit `memory-service/app/memory.py` to add `add_global`, `search_global`, `list_global` methods.
  - [x] 1.4.3: Edit `memory-service/app/routes/memories.py` to add `POST /add_global_memory`, `POST /search_global_memory`, `GET /list_global_memory`.
  - [x] 1.4.4: Curl each endpoint and confirm it round-trips a fact.
  - [x] 1.4.5: Edit `memory-service/app/config.py` to change the default `deepseek_model` to `deepseek-v4-pro`.

- [x] **Task 1.5: State + messaging helpers** — wrap the new PB collections as TypeScript helpers.
  - [x] 1.5.1: Create `next-app/lib/state.ts` with `loadState(pb, convId, agentName)` and `saveState(pb, convId, agentName, json)`.
  - [x] 1.5.2: Create `next-app/lib/messaging.ts` with `postMessage(pb, ...)`, `markReplied(pb, msgId, reply)`, and `listTurnMessages(pb, turnId)`.
  - [x] 1.5.3: Add `searchGlobalMemory` / `addGlobalMemory` / `listGlobalMemory` / `promoteToGlobal` to `next-app/lib/memory-client.ts`.

---

## Phase 2 — Core swarm (CoS, Memory, Document, chat route, Team Panel)

- [x] **Task 2.1: Core tool definitions** — write the 4 foundational tools.
  - [x] 2.1.1: Create `next-app/lib/agents/tools/mem0.ts` with `search_memory`, `add_memory`, `list_memories`, `search_global_memory`, `add_global_memory`, `list_global_memory`, `promote_to_global`.
  - [x] 2.1.2: Create `next-app/lib/agents/tools/qdrant.ts` with `search_documents`, `list_documents`.
  - [x] 2.1.3: Create `next-app/lib/agents/tools/state.ts` with `load_my_state`, `save_my_state`.
  - [x] 2.1.4: Create `next-app/lib/agents/tools/consult.ts` with `consult_agent(name, message)` per the spec. Imports the target from `registry.ts` and uses `Runner.run()`. Enforces the 3-depth loop guard and the 4-consult/turn budget.
  - [x] 2.1.5: Create `next-app/lib/agents/tools/index.ts` to re-export all tools.

- [x] **Task 2.2: Memory and Document specialists** — the first two non-CoS agents.
  - [x] 2.2.1: Create `next-app/lib/agents/specialists/memory-agent.ts` per the spec. Reasoning: non_think. Tools: mem0 tools. Instructions tell it to search across ALL of the user's memories and to propose global facts.
  - [x] 2.2.2: Create `next-app/lib/agents/specialists/document-agent.ts` per the spec. Reasoning: non_think. Tools: qdrant tools. Instructions tell it to cite the document name in its reply.

- [x] **Task 2.3: Chief of Staff agent** — the user-facing hub.
  - [x] 2.3.1: Create `next-app/lib/agents/specialists/chief-of-staff.ts` per the spec. Reasoning: think_high. Tools: list_global_facts (custom), load_my_state, save_my_state, visualize, consult_agent, and the registry of specialist handoffs.
  - [x] 2.3.2: Implement the CoS prompt template with sections: TL;DR, Recommendation, Details, Visual.
  - [x] 2.3.3: Add a "Conflicts" paragraph in the CoS prompt that tells it to call `resolve_conflict(...)` (added in Phase 5) and pick the conflict_type per the rubric.

- [x] **Task 2.4: Specialist registry** — wire all 12 specialists (CoS, Memory, Document, plus 9 stubs added in Phase 3).
  - [x] 2.4.1: Create `next-app/lib/agents/specialists/registry.ts` with a `Map<agentName, { agent, handoff, reasoning }>`.
  - [x] 2.4.2: Export an `agentNames` array used by the `consult_agent` tool's Zod schema.
  - [x] 2.4.3: Confirm `import { registry } from "@/lib/agents/specialists/registry"` works and lists 12 agents.

- [x] **Task 2.5: Chat route rewrite** — replace the single-LLM call with the CoS.
  - [x] 2.5.1: Rewrite `next-app/app/api/chat/route.ts` per the spec (§4 in the design doc).
  - [x] 2.5.2: Implement the parallel context load (PB history, agent_state, Mem0 global facts, Qdrant docs).
  - [x] 2.5.3: Build the CoS input with system + state + history + global facts + user message.
  - [x] 2.5.4: Translate the OpenAI Agents SDK stream into the SSE event types per the spec table.
  - [x] 2.5.5: Persist user + assistant messages to PB after the stream.
  - [x] 2.5.6: Persist `agent_state` (last write wins) after the stream.
  - [x] 2.5.7: Fire-and-forget Mem0 add for cross-conversation fact extraction.
  - [x] 2.5.8: Implement the small-talk fast path (`/^(hi|hey|...)$/i`).

- [x] **Task 2.6: Team Panel UI** — the live activity drawer.
  - [x] 2.6.1: Create `next-app/components/team-panel.tsx` per the spec.
  - [x] 2.6.2: Add the new SSE event types to the client's `EventSource` parser in `next-app/app/chat/page.tsx`.
  - [x] 2.6.3: Wire the Team Panel to render `tool_start`, `tool_done`, `handoff`, `agent_message`, `code_run` events.
  - [x] 2.6.4: Confirm the Team Panel animates a full turn end-to-end (per SCENARIO in spec.md).

---

## Phase 3 — C-suite + life specialists (V2.28)

- [x] **Task 3.1: C-suite specialists** — 4 files in `specialists/`.
  - [x] 3.1.1: Create `cto.ts` per the spec. Reasoning: think_high. Tools: consult_agent, compute, run_code (added in Phase 4).
  - [x] 3.1.2: Create `cfo.ts` per the spec. Reasoning: think_high. Tools: consult_agent, compute, run_code.
  - [x] 3.1.3: Create `cmo.ts` per the spec. Reasoning: think_high. Tools: consult_agent.
  - [x] 3.1.4: Create `cso.ts` per the spec. Reasoning: think_high. Tools: consult_agent, run_code.

- [x] **Task 3.2: Life specialists** — 3 files in `specialists/`.
  - [x] 3.2.1: Create `adhd-coach.ts` per the spec. Reasoning: non_think. No tools.
  - [x] 3.2.2: Create `fitness-coach.ts` per the spec. Reasoning: non_think. No tools.
  - [x] 3.2.3: Create `therapist.ts` per the spec. Reasoning: non_think. No tools. Includes the 988 redirect for crisis signals.

- [x] **Task 3.3: Update registry** — wire the 7 new specialists.
  - [x] 3.3.1: Add the 7 imports to `registry.ts`.
  - [x] 3.3.2: Confirm `registry.agentNames.length === 12`.

---

## Phase 4 — Code execution (V2.23)

- [x] **Task 4.1: `node:vm` sandbox tools** — `compute` and `run_code`.
  - [x] 4.1.1: Create `next-app/lib/agents/tools/code-exec.ts` per the spec.
  - [x] 4.1.2: Implement `compute(expression)` with a single-line math evaluator (wrap in `return (...)`).
  - [x] 4.1.3: Implement `run_code(snippet)` using `vm.createContext` with safe globals only.
  - [x] 4.1.4: Add a 5-second `vm.Script` timeout. Catch the timeout error and return a friendly message.
  - [x] 4.1.5: Capture `console.log` calls into a stdout buffer.
  - [x] 4.1.6: Wire `compute` + `run_code` into CTO, CFO, CSO, and Planner specialists.

- [x] **Task 4.2: Smoke test** — confirm the sandbox works.
  - [x] 4.2.1: In a browser, ask "If I invest $10k at 7% for 30 years, what's it worth?"
  - [x] 4.2.2: Confirm the Team Panel shows "CFO ran: `Math.pow(1.07, 30) * 10000`" with output `76122.55…`.
  - [x] 4.2.3: Ask "Can you demonstrate reading a file from disk?" and confirm the sandbox blocks `require('fs')`.

---

## Phase 5 — Conflict resolution (V2.24, V2.27)

- [x] **Task 5.1: `resolve_conflict` tool** — the CoS's arbitration entry point.
  - [x] 5.1.1: Create `next-app/lib/agents/tools/resolve-conflict.ts` per the spec.
  - [x] 5.1.2: Implement the `domain_internal` strategy: CoS reasons and emits a `conflict_resolved` SSE event.
  - [x] 5.1.3: Implement the `values_tradeoff` strategy: emit a `conflict` SSE event with options + recommendation; pause the stream.
  - [x] 5.1.4: Implement the `technical_factual` strategy: invoke the Critic with `reasoning_effort: "max"` + the arbitration prompt suffix.
  - [x] 5.1.5: Add `resolve_conflict` to the CoS's tool list.

- [x] **Task 5.2: Critic with arbitration mode** — the technical factual arbiter.
  - [x] 5.2.1: Create `next-app/lib/agents/specialists/critic.ts` per the spec. Reasoning: think_max. Tools: flag_issues.
  - [x] 5.2.2: Implement the arbitration prompt suffix: "You are arbitrating a conflict between two specialists. Pick a winner. Justify with 2-3 sentences. Do not hedge."
  - [x] 5.2.3: Add the Critic to the registry.

- [x] **Task 5.3: ConflictCard UI** — the user picker.
  - [x] 5.3.1: Create `next-app/components/conflict-card.tsx` per the spec.
  - [x] 5.3.2: Listen for the `conflict` SSE event in `chat/page.tsx` and render the `ConflictCard`.
  - [x] 5.3.3: On user pick, POST to `/api/chat` with `{ kind: "conflict_resolution", conflictId, choice }`.
  - [x] 5.3.4: Handle the resume branch in `chat/route.ts` (load the paused turn's state, inject the choice, run the CoS again).

- [x] **Task 5.4: Smoke test** — confirm the three strategies work.
  - [x] 5.4.1: Ask "Should I deploy on Friday at 5pm or Monday at 9am?" → expect `values_tradeoff` (user picks).
  - [x] 5.4.2: Ask a question where CTO and CSO disagree on a number → expect `technical_factual` (Critic arbitrates).
  - [x] 5.4.3: Ask a marketing question where CFO chimes in → expect `domain_internal` (CoS rules).

---

## Phase 6 — Tier 1 production hardening (7 items)

- [x] **Task 6.1: Error handling + retry** (T1.1).
  - [x] 6.1.1: Wrap `Runner.runStreamed` in `chat/route.ts` with a try/catch.
  - [x] 6.1.2: Add a retry helper that retries transient errors (HTTP 429, 5xx, network) once with exponential backoff (1 s, 2 s).
  - [x] 6.1.3: On permanent errors, emit an `error` SSE event with a human-readable message.
  - [x] 6.1.4: Persist the partial assistant text and update `agent_state` to record the failure.
  - [x] 6.1.5: Catch `node:vm` timeouts and OOM errors in `run_code` and return them as tool errors, never crashing the Next.js process.

- [x] **Task 6.2: Per-conversation rate limiting** (T1.2).
  - [x] 6.2.1: Add a rate-limit check at the start of `chat/route.ts`.
  - [x] 6.2.2: Count turns in the past hour from the `messages` collection per `conversation_id` and per `userId`.
  - [x] 6.2.3: Reject with HTTP 429 + `error` SSE event when the cap is exceeded.
  - [x] 6.2.4: Exempt the small-talk fast path from the cap.

- [x] **Task 6.3: Tracing / observability** (T1.3).
  - [x] 6.3.1: Add the `better-sqlite3` dependency to `next-app`.
  - [x] 6.3.2: Create `next-app/lib/tracing.ts` with a `TraceStore` class backed by `/var/lib/superhuman-va/traces.db`.
  - [x] 6.3.3: Record each turn's trace (CoS input, every tool call, every A2A consult, final text, token usage).
  - [x] 6.3.4: Add a 30-day TTL cleanup job that runs nightly.
  - [x] 6.3.5: Add a `pnpm trace list --turn <turnId>` command that prints a turn's trace as JSON.

- [x] **Task 6.4: Golden-question eval harness** (T1.4).
  - [x] 6.4.1: Create `eval/golden.yaml` with 20 golden questions per the spec.
  - [x] 6.4.2: Create `eval/runner.ts` that replays each question against the live CoS and checks the expected substrings, expected specialists, and expected no-specialists.
  - [x] 6.4.3: Add a `pnpm eval` script that exits 1 on any failure.
  - [x] 6.4.4: Add `pnpm eval` to the pre-commit hook.

- [x] **Task 6.5: Sandbox-escape security tests** (T1.5).
  - [x] 6.5.1: Create `eval/sandbox-escape.test.ts` per the spec with 8 breakout attempts.
  - [x] 6.5.2: Each attempt asserts that the sandbox blocks it (returns a friendly error, doesn't crash, doesn't leak).
  - [x] 6.5.3: Add a `pnpm test:sandbox` script.
  - [x] 6.5.4: Add the script to the pre-commit hook and to CI.

- [x] **Task 6.6: Backup / restore** (T1.6).
  - [x] 6.6.1: Create `scripts/backup.sh` per the spec.
  - [x] 6.6.2: Test the script: run it, confirm two tarballs + a `manifest.json` are written to `/var/lib/superhuman-va/backups/`.
  - [x] 6.6.3: Add a 14-day retention cleanup to the script.
  - [x] 6.6.4: Create `scripts/restore.sh <backup_date>` per the spec.
  - [x] 6.6.5: Test restore: restore from a backup, confirm the next user message is processed normally.
  - [x] 6.6.6: Add a daily cron job at 03:00.

- [x] **Task 6.7: PII purge / "forget me"** (T1.8).
  - [x] 6.7.1: Add a "Forget this memory" button to the Memory Panel that calls `memoryClient.deleteMemory(id)`.
  - [x] 6.7.2: Add a "Delete this conversation" button to the sidebar.
  - [x] 6.7.3: Add a `forget_everything` tool to the CoS that deletes all data per the spec.
  - [x] 6.7.4: The CoS recognizes the user's typed command "forget everything" and calls the tool.
  - [x] 6.7.5: Confirm a full purge leaves no trace of the user in Mem0, Qdrant, or PocketBase.

---

## Phase 7 — Tier 2 polish (6 items)

- [x] **Task 7.1: Single-password auth** (T2.1).
  - [x] 7.1.1: Add `APP_PASSWORD_HASH` to `next-app/.env.local.example`.
  - [x] 7.1.2: Create `next-app/app/login/page.tsx` with a password form.
  - [x] 7.1.3: Create `next-app/middleware.ts` that checks for a session cookie and redirects unauthenticated requests to `/login`.
  - [x] 7.1.4: Add the cookie check to `chat/route.ts` (return 401 on unauthenticated requests).
  - [x] 7.1.5: Hash the password with `bcrypt` and store the hash in the env var.
  - [x] 7.1.6: The session cookie is HttpOnly, SameSite=Strict, 30-day expiry.

- [x] **Task 7.2: Cost observability** (T2.2).
  - [x] 7.2.1: Add token-counting to the V4 Pro model adapter (read the `usage` field from the streaming response).
  - [x] 7.2.2: Aggregate tokens per turn and per agent in the `TraceStore`.
  - [x] 7.2.3: Create `next-app/components/cost-widget.tsx` per the spec.
  - [x] 7.2.4: Mount the widget in the Team Panel header.
  - [x] 7.2.5: The widget reads from a `/api/cost/today` endpoint that returns the daily + per-agent breakdown.

- [x] **Task 7.3: Search across conversation history** (T2.3).
  - [x] 7.3.1: Add a new Qdrant collection `messages` with the same schema as `documents`.
  - [x] 7.3.2: On every chat turn, embed and index both the user and assistant messages into `messages`.
  - [x] 7.3.3: Add a `searchMessages(query)` tool to the Memory agent.
  - [x] 7.3.4: Add a search bar to the top of the sidebar that calls the tool and shows results.
  - [x] 7.3.5: Clicking a result opens the conversation scrolled to the matching message.

- [x] **Task 7.4: Conflict UI polish** (T2.4).
  - [x] 7.4.1: Update `conflict-card.tsx` per the spec — show the full question, both positions, the CoS's recommendation, and a "Change your choice" button.
  - [x] 7.4.2: Add a "Other — let me explain" option that lets the user type a custom response.
  - [x] 7.4.3: Add a "Past conflicts" section that lists resolved conflicts for this conversation.
  - [x] 7.4.4: Persist the user's choice to the `agent_messages` row.

- [x] **Task 7.5: Unit + integration tests** (T2.5).
  - [x] 7.5.1: Add `vitest` to the project (`npm install -D vitest`).
  - [x] 7.5.2: Write `tests/compute.test.ts`, `tests/run_code.test.ts`, `tests/state.test.ts`, `tests/messaging.test.ts`, `tests/consult-depth.test.ts`, `tests/fast-path.test.ts`, `tests/cos-input.test.ts`, `tests/rate-limit.test.ts` per the spec.
  - [x] 7.5.3: Add a `pnpm test` script.
  - [x] 7.5.4: Confirm coverage of `lib/agents/` is at least 60%.
  - [x] 7.5.5: Add a GitHub Actions workflow that runs `pnpm test` + `pnpm eval` + `pnpm test:sandbox` on every push to `main`.

- [x] **Task 7.6: Resilient SSE** (T2.6).
  - [x] 7.6.1: Add a `Last-Event-Id` header to every SSE event emitted by `chat/route.ts`.
  - [x] 7.6.2: Maintain a 5-minute in-memory buffer of events per `conversationId`.
  - [x] 7.6.3: On client reconnect with `Last-Event-Id`, replay events with id > `Last-Event-Id` from the buffer.
  - [x] 7.6.4: On client disconnect, close the stream cleanly with a `done` event.
  - [x] 7.6.5: The browser-side `EventSource` automatically reconnects with `Last-Event-Id` set.

---

## Task Dependencies

```
Phase 0 (Task 0.1)
    ↓
Phase 1 (Tasks 1.1 → 1.2 → 1.3 → 1.4 → 1.5)    [some parallelizable: 1.3, 1.4, 1.5 can run in parallel]
    ↓
Phase 2 (Tasks 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6)    [2.1, 2.2, 2.3, 2.4 can run in parallel; 2.5, 2.6 depend on them]
    ↓
Phase 3 (Tasks 3.1, 3.2 → 3.3)    [3.1, 3.2 can run in parallel]
    ↓
Phase 4 (Task 4.1 → 4.2)    [4.1 must precede 4.2]
    ↓
Phase 5 (Tasks 5.1, 5.2 → 5.3 → 5.4)    [5.1, 5.2 can run in parallel; 5.3 depends on both; 5.4 depends on 5.3]
    ↓
Phase 6 (Tasks 6.1 → 6.7)    [6.3, 6.4, 6.5, 6.6, 6.7 can run in parallel; 6.1, 6.2 must come first]
    ↓
Phase 7 (Tasks 7.1 → 7.6)    [7.2, 7.3, 7.4 can run in parallel; 7.5, 7.6 can run in parallel]
```

## Parallelization opportunities

- Within Phase 1: tasks 1.3, 1.4, 1.5 are independent.
- Within Phase 2: tasks 2.1, 2.2, 2.3, 2.4 are independent.
- Within Phase 3: tasks 3.1 and 3.2 are independent.
- Within Phase 5: tasks 5.1 and 5.2 are independent.
- Within Phase 6: tasks 6.3, 6.4, 6.5, 6.6, 6.7 are independent.
- Within Phase 7: tasks 7.2, 7.3, 7.4, 7.5, 7.6 are independent.

## Done when

All 8 acceptance criteria in `spec.md` are met. The cloud deployment at Oracle Free Tier boots from a fresh instance with a single `./install.sh`. A non-technical user can use the app without reading the docs.
