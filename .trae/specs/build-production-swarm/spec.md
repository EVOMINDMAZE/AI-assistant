# Production Swarm — Single Delivery Spec

## Why

The user has a working V1 MVP (Next.js 14 + PocketBase + Qdrant + Mem0 + DeepSeek) and a fully designed V2 swarm plan (Chief of Staff + 12 specialists, V4 Pro, cross-conversation memory, persistent state, A2A messaging, code execution, conflict resolution). They want **one spec** that ships the swarm, the production hardening, and the within-weeks polish in a single delivery — taking the app from "MVP on Oracle Cloud" to "production-ready superhuman VA with a 12-agent team, hard guarantees, and a visible Team Panel".

## What Changes

- **V1 — verify and document** the existing MVP (16 items, already built). No new code; spec verifies what's there.
- **V2 — build the swarm** (15 items, ~1,100 LOC): OpenAI Agents SDK, DeepSeek V4 Pro model adapter, Chief of Staff + 12 specialists, cross-conversation memory, persistent agent state, agent-to-agent messaging, code execution via `node:vm`, conflict resolution (3 strategies), Team Panel UI, ConflictCard UI, chat route rewrite.
- **Tier 1 — production hardening** (7 items): error handling + retry, per-conversation rate limiting, tracing/observability, golden-question eval harness, sandbox-escape security tests, backup/restore, PII purge.
- **Tier 2 — within-weeks polish** (6 items): single-password auth, cost observability widget, search across conversation history, conflict UI polish, unit + integration tests, resilient SSE.

Total: **44 items**, ~1,500 LOC of new code, 1 architecture (OpenAI Agents SDK + DeepSeek V4 Pro), 2 new PB collections, 1 new Qdrant collection, no new infrastructure.

- ❌ **BREAKING**: `DEEPSEEK_MODEL` env var default changes from `deepseek-chat` to `deepseek-v4-pro`. Existing conversations continue working (the model swap is transparent to the user).
- ❌ **BREAKING**: `chat/route.ts` is rewritten from a single DeepSeek call to a CoS-driven stream. The SSE event types change (`token`, `tool_start`, `tool_done`, `handoff`, `agent_message`, `conflict`, `conflict_resolved`, `code_run`, `meta`, `done`). Clients that parsed the old shape need to be updated.
- ❌ **BREAKING**: `memory-service` adds 3 new Mem0 endpoints and 1 new Qdrant collection (`memories_global`). Old endpoints are unchanged.

## Impact

- **Affected specs**: none (this is the first spec).
- **Affected code**:
  - [next-app/app/api/chat/route.ts](file:///workspace/superhuman-va/next-app/app/api/chat/route.ts) — rewritten
  - [next-app/lib/deepseek.ts](file:///workspace/superhuman-va/next-app/lib/deepseek.ts) — default model
  - [next-app/lib/pocketbase.ts](file:///workspace/superhuman-va/next-app/lib/pocketbase.ts) — no change
  - [next-app/lib/memory-client.ts](file:///workspace/superhuman-va/next-app/lib/memory-client.ts) — no change
  - [next-app/app/chat/page.tsx](file:///workspace/superhuman-va/next-app/app/chat/page.tsx) — Team Panel + ConflictCard
  - [next-app/components/team-panel.tsx](file:///workspace/superhuman-va/next-app/components/team-panel.tsx) — new
  - [next-app/components/conflict-card.tsx](file:///workspace/superhuman-va/next-app/components/conflict-card.tsx) — new
  - [next-app/lib/agents/](file:///workspace/superhuman-va/next-app/lib/agents/) — new dir (model, tools, specialists)
  - [next-app/lib/state.ts](file:///workspace/superhuman-va/next-app/lib/state.ts) — new
  - [next-app/lib/messaging.ts](file:///workspace/superhuman-va/next-app/lib/messaging.ts) — new
  - [next-app/package.json](file:///workspace/superhuman-va/next-app/package.json) — add `@openai/agents`, `tavily`
  - [memory-service/app/memory.py](file:///workspace/superhuman-va/memory-service/app/memory.py) — add global methods
  - [memory-service/app/qdrant_client.py](file:///workspace/superhuman-va/memory-service/app/qdrant_client.py) — add `memories_global` collection
  - [memory-service/app/routes/memories.py](file:///workspace/superhuman-va/memory-service/app/routes/memories.py) — add 3 endpoints
  - [memory-service/app/config.py](file:///workspace/superhuman-va/memory-service/app/config.py) — default model
  - [memory-service/scripts/pb_bootstrap.py](file:///workspace/superhuman-va/memory-service/scripts/pb_bootstrap.py) — add 2 collections
  - [memory-service/scripts/backup.sh](file:///workspace/superhuman-va/memory-service/scripts/backup.sh) — new
  - [.trae/documents/swarm-orchestrator.md](file:///workspace/.trae/documents/swarm-orchestrator.md) — the master design doc (read-only reference)

---

## ADDED Requirements

### Requirement: V1-MVP-VERIFIED — Existing V1 features work end-to-end

The system SHALL have a working V1 MVP at the time this spec starts. The V1 features (chat, memory, document RAG, persistence) SHALL pass a smoke test before the swarm work begins.

#### Scenario: V1 smoke test passes
- **WHEN** the user opens the chat UI in a browser
- **THEN** they can send a message and receive a streamed response from DeepSeek within 4 s p50
- **AND** the message is persisted in PocketBase and visible after a page refresh
- **AND** the user can upload a PDF and the memory service indexes it within 10 s
- **AND** a second conversation can search documents and find a relevant chunk from the uploaded PDF

---

### Requirement: SWARM-FRAMEWORK — OpenAI Agents SDK with DeepSeek V4 Pro adapter

The system SHALL use the `@openai/agents` TypeScript SDK as the orchestrator framework, with a custom `Model` adapter that points at DeepSeek V4 Pro (`deepseek-v4-pro`).

#### Scenario: Model adapter streams a hello-world
- **WHEN** a test script calls `runner.runStreamed(helloWorldAgent, "hi", { context: { reasoning: "think_high" } })`
- **THEN** the adapter issues a `chat.completions.create` call with `model: "deepseek-v4-pro"`, `stream: true`, `extra_body: { thinking: { type: "enabled" } }`, `reasoning_effort: "high"`
- **AND** the streamed response contains the text "Hello, world."

#### Scenario: Per-agent reasoning mode is honored
- **WHEN** the Critic is invoked with `context.reasoning = "think_max"`
- **THEN** the adapter issues a call with `extra_body: { thinking: { type: "enabled" } }, reasoning_effort: "max"`
- **AND** a specialist invoked with `context.reasoning = "non_think"` gets `extra_body: { thinking: { type: "disabled" } }`

---

### Requirement: COS-AGENT — Chief of Staff is the only user-facing agent

The system SHALL have a single Chief of Staff (CoS) agent that the user always talks to. The CoS SHALL be defined in [next-app/lib/agents/specialists/chief-of-staff.ts](file:///workspace/superhuman-va/next-app/lib/agents/specialists/chief-of-staff.ts) and SHALL:
- Use `reasoning: "think_high"`
- Use `model: "deepseek-v4-pro"`
- Have a system prompt with TLDR / Recommendation / Details / Visual structure
- Have tools: `consult_specialist` (handoff to all specialists), `consult_agent`, `visualize`, `load_my_state`, `save_my_state`, `list_global_facts`, `resolve_conflict`

#### Scenario: CoS responds with structured format
- **WHEN** the user sends any non-trivial message
- **THEN** the streamed assistant response contains sections labeled "TL;DR", "Recommendation", "Details" (and optionally "Visual")
- **AND** the response cites at least one specialist by name (e.g. "(per CTO)")

#### Scenario: Small talk skips the swarm
- **WHEN** the user sends a message matching `/^(hi|hey|thanks|ok|okay|lol|bye)[\s!.]*$/i`
- **THEN** the chat route returns a small-talk reply without calling any specialist

---

### Requirement: SPECIALISTS — 12 specialist agents registered

The system SHALL define 12 specialist agents, all using `model: "deepseek-v4-pro"`. Each SHALL be a single file in [next-app/lib/agents/specialists/](file:///workspace/superhuman-va/next-app/lib/agents/specialists/) and registered in [next-app/lib/agents/specialists/registry.ts](file:///workspace/superhuman-va/next-app/lib/agents/specialists/registry.ts).

| Agent | Reasoning | Required tools |
|---|---|---|
| Memory | non_think | search_memory, search_global_memory, add_memory, add_global_memory, promote_to_global |
| Document | non_think | search_documents, list_documents |
| Researcher | non_think | tavily_search |
| Planner | think_high | decompose, compute, run_code |
| Critic | think_max | flag_issues, arbitrate_conflict (via consult_agent) |
| CTO | think_high | consult_agent, compute, run_code |
| CFO | think_high | consult_agent, compute, run_code |
| CMO | think_high | consult_agent |
| CSO | think_high | consult_agent, run_code |
| ADHD Coach | non_think | (none) |
| Fitness Coach | non_think | (none) |
| Therapist | non_think | (none) |

#### Scenario: All 12 specialists load without errors
- **WHEN** the registry is imported at startup
- **THEN** it exports 12 handoff tools and the CoS can use `consult_specialist("<name>")` for any of them

#### Scenario: Adding a new specialist is a 3-step recipe
- **WHEN** a new file is added to `specialists/` and registered in `registry.ts`
- **THEN** the CoS can route to it without any other code change

---

### Requirement: CROSS-CONV-MEMORY — Memories are shared across all conversations

The system SHALL make the user's memories accessible from any conversation. Memories SHALL be scoped to the user (not the conversation) in Mem0, and a second Qdrant collection (`memories_global`) SHALL hold identity-level facts that are auto-loaded into the CoS's system prompt.

#### Scenario: A fact from conv A surfaces in conv B
- **WHEN** in conversation A, the user says "remember that my dog's name is Rex"
- **THEN** the Memory agent writes "user's dog is named Rex" to Mem0 (user-scoped)
- **AND** when the user opens a brand-new conversation B and asks "what's my dog's name?"
- **THEN** the CoS's response contains "Rex"

#### Scenario: Global facts auto-load
- **WHEN** the user says "I'm a backend engineer at a fintech"
- **THEN** the Memory agent auto-promotes this to `memories_global`
- **AND** on the next turn, the CoS's system prompt contains a "GLOBAL FACTS" section listing it
- **AND** the fact is not pruned by Mem0's normal lifecycle

---

### Requirement: PERSISTENT-STATE — CoS and specialists remember their working context

The system SHALL persist per-conversation working memory for the CoS (and optionally for specialists) in a new PocketBase collection `agent_state`. The state SHALL be loaded at the start of each turn and saved at the end.

#### Scenario: State survives across turns
- **WHEN** the CoS writes `current_focus = "Postgres vs MongoDB for the new app"` to `agent_state`
- **THEN** on the next turn, the CoS's system prompt contains a "WORKING MEMORY" section with that focus verbatim
- **AND** if the user asks "what were we discussing?", the CoS's response cites "Postgres vs MongoDB for the new app"

#### Scenario: State is per-conversation
- **WHEN** the same user has two active conversations with different `current_focus` values
- **THEN** switching between them loads the correct state for each

---

### Requirement: A2A-MESSAGING — Specialists can consult each other directly

The system SHALL allow any specialist to call a `consult_agent(name, message)` tool. The tool SHALL persist the consult in a new PocketBase collection `agent_messages`, invoke the target agent via the OpenAI Agents SDK, and return the reply to the caller.

#### Scenario: CTO consults CSO
- **WHEN** the CoS delegates a security question to CTO
- **AND** CTO calls `consult_agent("CSO", "threat model please")`
- **THEN** a row is inserted in `agent_messages` with `from_agent=CTO, to_agent=CSO, status=pending`
- **AND** the CSO agent is invoked and its reply is written back to the same row with `status=replied`
- **AND** the CSO's reply is returned to the CTO and visible in the Team Panel as "CTO → CSO: …"

#### Scenario: A2A loop guard
- **WHEN** specialist A calls `consult_agent(B)`, which calls `consult_agent(C)`, which calls `consult_agent(A)` at depth 3
- **THEN** the 4th call (depth 3) is rejected with "loop guard exceeded"
- **AND** the A2A call counter is reset between turns

#### Scenario: A2A budget per turn
- **WHEN** more than 4 `consult_agent` calls are made in a single turn
- **THEN** additional calls are rejected with "consult budget exceeded"

---

### Requirement: CODE-EXEC — Specialists can run sandboxed JavaScript

The system SHALL provide a `compute(expression)` tool and a `run_code(snippet, language="javascript")` tool, both backed by `node:vm` with safe globals. Available to CTO, CFO, CSO, and Planner.

#### Scenario: compute returns a number
- **WHEN** the CFO calls `compute("Math.pow(1.07, 30) * 10000")`
- **THEN** the tool returns the number `76122.5510…`

#### Scenario: run_code returns stdout
- **WHEN** the CSO calls `run_code("console.log('hello'); console.log(2+2);")`
- **THEN** the tool returns `{ stdout: "hello\n4\n", value: undefined, error: null }`

#### Scenario: Sandbox blocks require
- **WHEN** a specialist calls `run_code("require('fs')")`
- **THEN** the tool returns `{ stdout: "", value: undefined, error: "require is not defined" }`

#### Scenario: Infinite loop is killed
- **WHEN** a specialist calls `run_code("while(true){}")`
- **THEN** the tool returns within 5.5 seconds with `{ error: "Script execution timed out" }`

---

### Requirement: CONFLICT-RESOLUTION — Specialist disagreements are resolved deterministically

The system SHALL provide a `resolve_conflict({ question, positions, conflict_type })` tool, available only to the CoS. Three strategies SHALL be supported:

| `conflict_type` | Strategy | Visible to user |
|---|---|---|
| `domain_internal` | CoS rules using its own reasoning | "CoS ruled: …" in Team Panel |
| `values_tradeoff` | User picks via `ConflictCard` UI; stream pauses; user choice resumes turn | ConflictCard with options |
| `technical_factual` | Critic arbitrates in Think Max with arbitration prompt suffix | "Critic arbitrated: …" in Team Panel |

#### Scenario: CoS rules on a domain-internal conflict
- **WHEN** the CoS detects that two specialists disagree and one is clearly out of their lane
- **THEN** the CoS calls `resolve_conflict` with `conflict_type: "domain_internal"`
- **AND** the Team Panel shows a `conflict_resolved` event with the winning position

#### Scenario: User picks on a values tradeoff
- **WHEN** the CoS detects that the disagreement is about user priorities
- **THEN** the CoS calls `resolve_conflict` with `conflict_type: "values_tradeoff"`
- **AND** a `conflict` SSE event is emitted with the question, options, and a recommendation
- **AND** the stream pauses
- **AND** the browser shows a `ConflictCard` with the options
- **WHEN** the user clicks an option
- **THEN** a POST to `/api/chat` with `{ kind: "conflict_resolution", conflictId, choice }` resumes the CoS
- **AND** the final assistant message cites the chosen option

#### Scenario: Critic arbitrates a technical factual dispute
- **WHEN** the CoS detects that the disagreement is about a fact or technical claim
- **THEN** the CoS calls `resolve_conflict` with `conflict_type: "technical_factual"`
- **AND** the Critic is invoked with `extra_body: { thinking: { type: "enabled" } }, reasoning_effort: "max"`
- **AND** the Critic's system prompt has the arbitration suffix appended
- **AND** the Team Panel shows a `conflict_resolved` event with the Critic's verdict

---

### Requirement: CHAT-ROUTE — `/api/chat` uses the CoS and emits a rich SSE event stream

The system SHALL rewrite `next-app/app/api/chat/route.ts` to:
1. Load context in parallel: PB history, `agent_state` for this conversation, Mem0 global facts, Qdrant document chunks.
2. Build the CoS input with the system prompt + working memory + global facts + history + user message.
3. Run `runner.runStreamed(coSAgent, input, { context: { conversationId, userId, turnId, reasoning: "think_high" } })`.
4. Translate the OpenAI Agents SDK stream into the SSE event types below.
5. Persist the user + assistant messages, the latest `agent_state`, and the `agent_messages` rows after the stream completes.
6. Fire-and-forget Mem0 add for cross-conversation fact extraction.

SSE event types emitted by the route:

| SDK event | SSE type |
|---|---|
| start | `meta` |
| `raw_model_stream_event` (text delta) | `token` |
| `run_item_stream_event` (tool_call) | `tool_start` |
| `run_item_stream_event` (tool_result) | `tool_done` |
| `run_item_stream_event` (`run_code`/`compute`) | `code_run` |
| `agent_updated_stream_event` (handoff) | `handoff` |
| `consult_agent` tool_call | `agent_message` |
| `resolve_conflict` (values_tradeoff) | `conflict` |
| `resolve_conflict` (domain_internal / technical_factual) | `conflict_resolved` |
| final message | `done` |

#### Scenario: Streaming a turn end-to-end
- **WHEN** the user sends a non-trivial message
- **THEN** the response begins streaming within 1.5 s p50
- **AND** the SSE stream contains a `meta` event with `conversationId` and `turnId`
- **AND** at least one `tool_start`/`tool_done` pair is emitted when a specialist is consulted
- **AND** the final `done` event fires after the assistant message is persisted

---

### Requirement: TEAM-PANEL — Live activity UI for the swarm

The system SHALL provide a `TeamPanel` component (right-side drawer) that renders SSE events as a live activity log. It SHALL handle: `tool_start`, `tool_done`, `handoff`, `agent_message`, `code_run`, `conflict`, `conflict_resolved`.

#### Scenario: Team panel animates a full turn
- **WHEN** the user sends "Should I deploy my fintech DB on a public S3 bucket?"
- **THEN** the Team Panel shows, in order: "CoS consulted: CTO, CSO", "CTO ran: …", "CTO → CSO: …", "CSO: PCI-DSS …", "Conflict detected (technical_factual)", "Critic arbitrated: …", "CoS: streaming final answer…"

---

### Requirement: ERROR-HANDLING — Transient and permanent errors are handled gracefully

The system SHALL wrap each `Runner.runStreamed` call in a try/catch and SHALL:
- Retry transient errors (HTTP 429, 5xx, network) once with exponential backoff (1 s, 2 s).
- On permanent errors, emit an `error` SSE event with a human-readable message, persist the partial assistant text, and update `agent_state` to record the failure.
- Never crash the Next.js process. `node:vm` timeouts and OOM errors are caught and returned to the LLM as tool errors.

#### Scenario: DeepSeek rate limit is retried
- **WHEN** the model adapter receives a 429 response
- **THEN** it waits 1 s and retries
- **AND** if the second attempt also returns 429, it waits 2 s
- **AND** if the third attempt also fails, the route emits `error` with "DeepSeek rate limit exceeded"

#### Scenario: run_code OOM is caught
- **WHEN** a specialist calls `run_code` with a snippet that allocates 1 GB
- **THEN** the tool returns `{ error: "out of memory" }` (or `Script execution timed out` if V8 kills it)
- **AND** the Next.js process does not crash

---

### Requirement: RATE-LIMITING — Per-conversation and per-hour caps

The system SHALL enforce:
- 60 turns per conversation per hour
- 200 turns per user per hour
- A small-talk fast path is exempt from these caps (a turn under 5 words and no specialist calls).

The cap is enforced in the chat route before invoking the CoS. The CoS's `agent_state.turn_count` is the source of truth per conversation.

#### Scenario: A conversation is throttled
- **WHEN** a conversation has 60 turns in the past hour and the user sends another message
- **THEN** the route returns 429 with `{ error: "conversation rate limit exceeded" }` and an `error` SSE event
- **AND** the response suggests the user wait 5 minutes

---

### Requirement: TRACING — Every swarm turn is traceable

The system SHALL record, for each turn, a JSON trace containing:
- `turnId`, `conversationId`, `userId`
- The CoS's input (system + history + state + global facts + user message)
- Every tool call (agent, tool name, args, duration, result)
- Every A2A consult (from, to, message, reply, depth)
- The CoS's final text output
- Token usage (input, output, reasoning)

The trace SHALL be appended to a local SQLite database at `/var/lib/superhuman-va/traces.db` (mounted as a volume in Docker). The default TTL is 30 days.

#### Scenario: A turn's trace is queryable
- **WHEN** the user (or admin) runs `pnpm trace list --turn <turnId>`
- **THEN** the command prints the full JSON trace for that turn

---

### Requirement: EVAL-HARNESS — 20 golden questions gate every prompt change

The system SHALL include a `eval/golden.yaml` file with 20 golden questions, each with:
- `input` (the user message)
- `expected_substrings` (must appear in the final answer)
- `expected_specialists` (must be consulted)
- `expected_no_specialists` (must NOT be consulted)
- `category` (memory, document, code, conflict, etc.)

A `pnpm eval` command SHALL run all 20 and exit non-zero if any fails. The harness SHALL be run before merging any change to a specialist prompt or to the CoS prompt.

#### Scenario: A prompt change is gated by eval
- **WHEN** a developer edits `chief-of-staff.ts` and runs `pnpm eval`
- **THEN** all 20 golden questions are replayed against the new CoS
- **AND** if any of `expected_substrings` is missing or any `expected_specialists` is not consulted, the command exits 1
- **AND** a summary of pass/fail per question is printed

---

### Requirement: SANDBOX-SECURITY — `node:vm` breakouts are blocked and tested

The system SHALL include a security test suite in `eval/sandbox-escape.test.ts` that attempts the following breakouts and asserts each one is blocked:

1. `require("fs")` — blocked
2. `process.exit(0)` — blocked
3. `globalThis.fetch("https://attacker.com")` — blocked
4. `Object.getPrototypeOf({}).constructor.constructor("return process")()` — blocked
5. `while(true){}` — killed within 5 s
6. `new Array(1e9).fill(0)` — OOM caught, Next.js process survives
7. `eval("require('fs')")` — blocked
8. `Reflect.get(globalThis, "process")` — blocked

`pnpm test:sandbox` SHALL run this suite and exit non-zero if any attempt succeeds. The test suite is part of the eval harness and runs in CI.

#### Scenario: A new sandbox attack is caught
- **WHEN** a developer adds a new breakout attempt to the test suite
- **THEN** the test exits 1 if the attempt succeeds
- **AND** the developer must fix the sandbox (e.g. add the blocked name to the `safeGlobals` exclusion list) before merging

---

### Requirement: BACKUP — One-command backup and restore of PB + Qdrant

The system SHALL provide `scripts/backup.sh` that:
- Dumps PocketBase to a timestamped `.pb.tar.gz` (using the PocketBase backup endpoint)
- Snapshots Qdrant to a timestamped `.qdrant.tar.gz` (using `qdrant snapshot create`)
- Writes a `manifest.json` with the timestamp, file sizes, and SHA-256 checksums
- Keeps the last 14 days of backups and prunes older ones

The system SHALL provide `scripts/restore.sh <backup_date>` that:
- Validates the manifest and checksums
- Restores PB and Qdrant from the backup files
- Restarts the affected services

#### Scenario: A backup is taken on schedule
- **WHEN** a cron job runs `scripts/backup.sh` daily at 03:00
- **THEN** two tarballs are written to `/var/lib/superhuman-va/backups/`
- **AND** a `manifest.json` is updated
- **AND** backups older than 14 days are deleted

#### Scenario: A restore works end-to-end
- **WHEN** an admin runs `scripts/restore.sh 2026-07-01`
- **THEN** PB and Qdrant are restored from the backup
- **AND** the next user message is processed normally

---

### Requirement: PII-PURGE — User can delete all their data

The system SHALL provide:
- A "Forget this memory" button on each memory in the Memory Panel
- A "Delete this conversation" button on each conversation in the sidebar
- A "Delete all my data" command (typed in chat: `forget everything`) that:
  - Calls Mem0 `delete_all(userId)` for both `memories` and `memories_global`
  - Calls Qdrant `delete_by_filter` for `documents` and `memories` and `memories_global` for this user
  - Deletes all `conversations` and `messages` rows for this user in PocketBase
  - Deletes all `agent_state` and `agent_messages` rows for this user
  - Returns "All your data has been deleted. The app is now in a fresh state."

#### Scenario: A user deletes a single memory
- **WHEN** the user clicks "Forget this memory" on a memory
- **THEN** the memory is removed from Mem0 and from the Team Panel
- **AND** the next turn does not surface it in the CoS's global facts

#### Scenario: A user deletes everything
- **WHEN** the user types "forget everything"
- **THEN** the CoS calls the `forget_everything` tool
- **AND** all Mem0, Qdrant, and PocketBase data for the user is deleted
- **AND** the CoS's response is "All your data has been deleted."

---

### Requirement: AUTH — A single shared password protects the app

The system SHALL add a single shared password in front of the chat UI and the `/api/chat` route. The password SHALL be stored as a hash in `next-app/.env.local` (`APP_PASSWORD_HASH`) and verified at request time.

The PocketBase admin URL (`/_/`) and the memory service Swagger (`/docs`) SHALL remain gated by the self-signed TLS cert only (no password) — the user explicitly chose this in V1 for admin convenience.

#### Scenario: An unauthenticated user is blocked
- **WHEN** an unauthenticated request hits `/api/chat`
- **THEN** the route returns 401
- **AND** the browser is redirected to `/login`

#### Scenario: A logged-in user is allowed
- **WHEN** the user enters the correct password
- **THEN** a session cookie is set (HttpOnly, SameSite=Strict, 30-day expiry)
- **AND** subsequent requests pass through

---

### Requirement: COST-OBSERVABILITY — Per-turn / per-agent token usage is visible

The system SHALL record, for every turn, the input tokens, output tokens, and reasoning tokens consumed by each agent. The total daily cost is computed using V4 Pro pricing ($1.74/1M input, $0.55/1M output, $4.40/1M reasoning — May 2026 rates).

A `CostWidget` component SHALL display in the Team Panel header:
- Today's cost (USD)
- This week's cost
- Last 7 days, per-agent breakdown (click to expand)
- Median cost per turn

#### Scenario: The cost widget renders real numbers
- **WHEN** the user has sent 50 turns today at a median of $0.02/turn
- **THEN** the widget shows "Today: $1.00" and "This week: $7.20"
- **AND** clicking the per-agent breakdown shows "CoS: 60%, CTO: 15%, …"

---

### Requirement: MSG-SEARCH — User can search across conversation history

The system SHALL index every assistant and user message in a new Qdrant collection `messages` and expose a `searchMessages(query)` tool to the Memory agent. A search bar SHALL appear at the top of the sidebar.

#### Scenario: A user finds an old message
- **WHEN** the user types "postgres" in the search bar
- **THEN** the sidebar shows a list of conversations where "postgres" was mentioned, ranked by relevance
- **AND** clicking a result opens that conversation scrolled to the matching message

---

### Requirement: CONFLICT-UI — ConflictCard is polished and supports re-pick

The system SHALL polish the `ConflictCard` component to:
- Show the full context of the disagreement (the question, both positions with reasoning, and the CoS's recommendation)
- Allow the user to click "Other — let me explain" to type a custom response
- Show a history of past conflicts for this conversation
- Persist the user's choice to the `agent_messages` row

#### Scenario: A user re-picks after seeing the recommendation
- **WHEN** the user clicks the option marked "CoS recommends" and then changes their mind
- **THEN** the ConflictCard shows a "Change your choice" button
- **AND** clicking it re-opens the picker and updates the `agent_messages` row

---

### Requirement: TESTS — Unit and integration tests for the swarm

The system SHALL include:

| Test file | What it covers |
|---|---|
| `tests/compute.test.ts` | compute returns correct numbers, rejects non-math inputs |
| `tests/run_code.test.ts` | sandbox escapes blocked, infinite loops killed, stdout captured |
| `tests/state.test.ts` | state load/save round-trip, unique-per-(conv, agent) enforced |
| `tests/messaging.test.ts` | consult_agent inserts row, invokes target, returns reply |
| `tests/consult-depth.test.ts` | depth limit enforced, budget limit enforced |
| `tests/fast-path.test.ts` | small talk skips specialists, regex matches /^(hi|hey|...)$/i |
| `tests/cos-input.test.ts` | global facts + working memory injected correctly |
| `tests/rate-limit.test.ts` | 60 turns/conv cap and 200 turns/hour cap enforced |

`pnpm test` SHALL run all of them. CI runs them on every push to `main`.

#### Scenario: All tests pass on a clean checkout
- **WHEN** a developer runs `pnpm test` on a fresh clone
- **THEN** all 8 test files pass
- **AND** coverage of `lib/agents/` is at least 60%

---

### Requirement: RESILIENT-SSE — SSE streams survive client disconnects

The system SHALL:
- Add a `Last-Event-Id` header on every SSE event
- On client reconnect, replay any events with id > `Last-Event-Id` from a 5-minute buffer
- Close the stream cleanly with a `done` event when the client disconnects
- The browser-side `EventSource` SHALL automatically reconnect with `Last-Event-Id` set

#### Scenario: A user closes the tab mid-turn and reopens
- **WHEN** the user closes the tab while a turn is streaming
- **AND** reopens it within 5 minutes
- **THEN** the EventSource reconnects with `Last-Event-Id: <last-id>`
- **AND** the server replays any events that were emitted during the disconnect
- **AND** the assistant bubble shows the complete final answer

---

## MODIFIED Requirements

None — this is the first spec.

## REMOVED Requirements

None — this is the first spec.

---

## Acceptance criteria (this spec is "done" when)

1. All 8 test files in `tests/` pass with `pnpm test`.
2. All 20 golden questions pass with `pnpm eval`.
3. All 8 sandbox-escape attempts are blocked with `pnpm test:sandbox`.
4. The 7 V1 smoke tests pass in a browser.
5. The 8 V2 smoke tests pass in a browser (cross-conversation memory, persistent state, A2A messaging, V4 Pro, reasoning mode, code exec, conflict resolution, Critic arbitration).
6. The 7 Tier 1 items are implemented (error handling, rate limit, tracing, eval, sandbox tests, backup, PII purge).
7. The 6 Tier 2 items are implemented (auth, cost widget, msg search, conflict UI polish, tests, resilient SSE).
8. The 13 performance SLOs from §18 of the design doc are met in a 50-turn workload test.
9. The cloud deployment at Oracle Free Tier boots from a fresh instance with a single `./install.sh`.
10. A non-technical user can use the app without reading the docs.
