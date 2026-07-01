# Subagent Swarm — Chief-of-Staff Architecture (V2.1)

## TL;DR

Replace the single DeepSeek call in `chat/route.ts` with a **hub-and-spoke orchestrator** powered by the **OpenAI Agents SDK** and **DeepSeek V4 Pro**:

```
USER ──► Chief of Staff (CoS, V4-Pro/Think-High) ──► [specialists, in parallel]
              │
              ├── TLDRs every response
              ├── Visualizes (tables, Mermaid, charts)
              ├── Recommends a clear next step
              ├── Remembers across conversations (Mem0 user-scope)
              ├── Holds working memory per conversation (PB agent_state)
              ├── Lets specialists consult each other directly (PB agent_messages)
              ├── Specialists can run sandboxed JS (node:vm)
              └── Resolves specialist disagreements (3 strategies)
```

The user **only ever talks to the CoS**. Specialists can also **talk to each other** through a shared, persisted message bus — not just through the CoS.

**Four new requirements (round 1), now in scope:**

| # | Requirement | Mechanism |
|---|---|---|
| 1 | **Cross-conversation memory sharing** | Mem0 is already user-scoped; add a `global_facts` collection + the Memory agent always queries across all conversations. |
| 2 | **Persistent agent state across turns** | New PB `agent_state` collection. CoS and specialists read at turn start, write at turn end. |
| 3 | **Agent-to-agent messaging** | New PB `agent_messages` collection + `consult_agent(name, msg)` tool that any specialist can call. |
| 4 | **DeepSeek V4 Pro for all agents** | `model = "deepseek-v4-pro"` everywhere. Per-agent `thinking` mode (Non-Think / Think High / Think Max). |

**Two new requirements (round 2), also now in scope:**

| # | Requirement | Mechanism |
|---|---|---|
| 5 | **Tool-use for code execution** | `node:vm`-sandboxed `compute(expr)` and `run_code(snippet)` tools available to CTO, CFO, and Planner. Python sandbox is a v2 follow-up. |
| 6 | **Conflict resolution between specialists** | New `resolve_conflict(...)` tool. CoS picks the strategy: domain-internal → CoS decides; values/tradeoffs → escalate to the user via a `conflict` SSE event; technical/factual → Critic arbitrates (Think Max). |

**Stack**: OpenAI Agents SDK (TypeScript) + DeepSeek V4 Pro + Tavily + Mem0 + Qdrant + PocketBase.

**Ship order**: framework + DeepSeek V4-Pro adapter → state + messaging infra → code-exec sandbox → CoS + 2 core agents → C-suite → conflict resolution → life specialists → Researcher/Planner/Critic.

**Files touched**: 2 new dirs, 7 new lib modules, 1 new API route, 2 new UI components, 1 PB bootstrap change, 2 small env edits. ~1,100 LOC. No new infrastructure.

---

## 0. Quickstart — first 90 minutes

If you want to see the swarm end-to-end in one sitting, do this in order. After step 5 you'll have a working CoS + Memory + Document on your local docker stack. Everything after step 5 is incremental.

| Min | Step | Command / file |
|---|---|---|
| 0-5 | Confirm DeepSeek V4 Pro is in your account. | `curl -sS https://api.deepseek.com/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY" \| jq '.data[].id' \| grep v4-pro` |
| 5-10 | Install the SDK and Tavily. | `cd next-app && npm i @openai/agents tavily` |
| 10-25 | Write the model adapter. | Create [next-app/lib/agents/model.ts](file:///workspace/superhuman-va/next-app/lib/agents/model.ts) (sketch in §2.2). Run the hello-world script: `node -e "import('./lib/agents/model.js').then(m => m.runHelloWorld())"` — should print "Hello, world." streamed. |
| 25-35 | Add the new PB collections. | Edit [memory-service/scripts/pb_bootstrap.py](file:///workspace/superhuman-va/memory-service/scripts/pb_bootstrap.py) to add `agent_state` and `agent_messages` (schemas in §16). `docker compose up -d pocketbase && python scripts/pb_bootstrap.py`. |
| 35-45 | Add the Mem0 global pool. | Edit [memory-service/app/qdrant_client.py](file:///workspace/superhuman-va/memory-service/app/qdrant_client.py) (add `memories_global`), [memory-service/app/memory.py](file:///workspace/superhuman-va/memory-service/app/memory.py) (3 new methods), [memory-service/app/routes/memories.py](file:///workspace/superhuman-va/memory-service/app/routes/memories.py) (3 new endpoints). |
| 45-55 | Build the state + messaging helpers. | Create [next-app/lib/state.ts](file:///workspace/superhuman-va/next-app/lib/state.ts) and [next-app/lib/messaging.ts](file:///workspace/superhuman-va/next-app/lib/messaging.ts). Wire to PB. |
| 55-65 | Build the four core tools. | Create `tools/{mem0,qdrant,state,consult}.ts` (sketches in §2.3). All ~250 LOC combined. |
| 65-80 | Define the CoS + Memory + Document agents. | Create the three specialist files. The CoS prompt is in §3.3. |
| 80-90 | Rewrite [chat/route.ts](file:///workspace/superhuman-va/next-app/app/api/chat/route.ts) to use the CoS (sketch in §4.2). | Open the browser, send a message. Team panel shows the swarm in action. |

At min 90 you have a working swarm. Everything after is the additional agents, code exec, and conflict resolution from the ship order.

---

## 1. Architecture

### 1.1 The team

All agents use **DeepSeek V4 Pro** (`deepseek-v4-pro`). They differ only in **reasoning mode** and **tools**.

| Agent | Role | Reasoning mode | Tools | Always runs? |
|---|---|---|---|---|
| **Chief of Staff** (CoS) | User-facing orchestrator. TLDRs, visualizes, recommends. Loads/saves `agent_state` per turn. | **Think High** | `consult_specialist`, `consult_agent`, `visualize`, `load_state`, `save_state` | ✅ Every turn |
| **Memory Agent** | Mem0 retrieval + writes. **Searches across all conversations** (not just current). | Non-Think | `search_memory`, `save_memory`, `promote_to_global` | When context is relevant |
| **Document Agent** | Searches uploaded PDFs/notes in Qdrant. | Non-Think | `search_documents`, `list_documents` | When context is relevant |
| **Researcher** | Live web search. | Non-Think | `web_search` (Tavily) | When current info needed |
| **Planner** | Breaks complex tasks into steps. | Think High | `decompose_task`, `compute` | For multi-step requests |
| **Critic** | Reviews the final answer. | **Think Max** | `flag_issues`, `arbitrate_conflict` (v2 — see 1.6) | Optional, for high-stakes |
| **CTO** | Architecture, code, tech decisions. | Think High | `consult_agent` (so CTO can ping CSO about risk), `run_code`, `compute` | For tech questions |
| **CFO** | Finance, budget, ROI, runway. | Think High | `consult_agent`, `compute`, `run_code` | For finance questions |
| **CMO** | Marketing, growth, brand. | Think High | `consult_agent` | For marketing questions |
| **CSO** | Security, compliance, risk. | Think High | `consult_agent`, `run_code` (for proof-of-concept exploits / payloads) | For security questions |
| **ADHD Coach** | Productivity, focus. | Non-Think | — | When user signals overwhelm |
| **Fitness Coach** | Training, nutrition, recovery. | Non-Think | — | For health questions |
| **Therapist** | Active listening, reflection, CBT-lite. | Non-Think | — | When user signals distress |

**Why all V4 Pro?** Single model = single API key, single pricing tier, one place to upgrade later. V4 Pro's reasoning-mode knob gives us the equivalent of "use Sonnet for X, Haiku for Y" without a second account. The 1M-token context window also lets us stuff more working memory + retrieved context per turn without aggressive RAG.

Adding a new agent = one file in `lib/agents/specialists/` + one line in `registry.ts`.

### 1.2 Message flow (one turn, V2)

```
1. User sends message
2. chat/route.ts loads context in parallel:
   a. PocketBase: conversation history (last 10 msgs)
   b. PocketBase: agent_state for this conversation (working memory)
   c. Mem0: relevant memories for this user (cross-conversation)
   d. Qdrant: relevant document chunks
3. CoS receives [system, ...history, agent_state, user]
4. CoS picks 0..N specialists to consult (parallel where possible)
   - Memory + Document always considered
   - Specialists called based on CoS's read of the question
5. Any specialist can call `consult_agent(name, msg)` mid-flow:
   - The CoS pass-through tool inserts a message into PB agent_messages,
     invokes the named agent via Runner.run(), and returns the reply
   - This is the new A2A path
6. CoS drafts a TLDR + structured answer that weaves in specialist output
7. (Optional) Critic reviews, CoS revises
8. CoS streams the final answer to the browser
9. (After stream) in parallel:
   a. Save user + assistant messages to PB
   b. Save agent_state to PB (the CoS's last write wins)
   c. Fire-and-forget Mem0 add (cross-conversation memory)
   d. Mark agent_messages for this turn as resolved
```

### 1.3 UI

- **Main chat** — unchanged.
- **Team panel** (new, right drawer) — shows live activity:
  - "CoS consulted: Memory, Document, CTO"
  - "CTO → CSO: can you risk-assess this migration?"
  - "CSO: medium risk, see notes"
  - "CoS: final answer streaming..."
- The team panel is fed by typed SSE events from the OpenAI Agents SDK stream (`run_item_stream_event` for tool calls/results, `agent_updated_stream_event` for handoffs, plus a new `agent_message` event for the A2A bus).

### 1.4 Memory, state & inter-agent messaging (THE NEW STUFF)

This section is the meat of V2. Each subsection maps to one of the four new requirements.

#### 1.4.1 Cross-conversation memory

**Goal**: every conversation has access to the same memory pool. A fact learned in chat A should surface in chat B.

**Design**:

- **Mem0 is already user-scoped.** `searchMemory(user_id, query)` already returns all of the user's memories, regardless of which conversation they came from. The current `chat/route.ts` only calls it with `userId` (no `conversation_id` filter) — so it is *already* cross-conversation in practice. We make this explicit in the Memory agent's prompt and tools.
- **Global facts** (subset that should never be pruned): a new `metadata.global = true` flag. The Memory agent has a `promote_to_global(memory_id, reason)` tool that sets it. The CoS prompt tells it to auto-promote stable, identity-level facts (e.g. "user is a backend engineer", "user's mother is named Sara", "user has ADHD"). The CoS also has direct access to `list_global_facts` so it can include them in its system prompt for any conversation.
- **Two Mem0 collections** (we add a second one to keep the global pool clean):
  - `memories` — per-conversation episodic facts. Default. Pruned by Mem0's normal lifecycle.
  - `memories_global` — promoted identity facts. Never pruned. Smaller, always included in the CoS system prompt.
- **Cost**: we add a second Qdrant collection, but the embedding is the same fastembed model and the global pool is small (~hundreds of facts at most). No real cost change.

**Why not one collection with a flag?** Mem0's auto-pruning operates on the whole collection. We want different retention policies. Two collections is the cleanest split.

**File: [memory-service/app/memory.py](file:///workspace/superhuman-va/memory-service/app/memory.py)** — add `add_global`, `search_global`, `list_global` methods. Mirror the existing surface.

**File: [memory-service/app/routes/memories.py](file:///workspace/superhuman-va/memory-service/app/routes/memories.py)** — add three new endpoints: `POST /add_global_memory`, `POST /search_global_memory`, `GET /list_global_memory`.

**File: [memory-service/app/qdrant_client.py](file:///workspace/superhuman-va/memory-service/app/qdrant_client.py)** — add a `memories_global` collection. Auto-create on startup (idempotent).

#### 1.4.2 Persistent agent state across turns

**Goal**: the CoS and specialists remember their working context within a conversation, even though each turn is a fresh LLM call.

**Design**:

- **New PocketBase collection `agent_state`**. Schema:
  ```
  id              (auto)
  conversation_id (relation → conversations, cascadeDelete, unique-per-(conv, agent))
  agent_name      (text, e.g. "CoS", "CTO")
  state_json      (json, free-form)
  updated_at      (date, auto)
  ```
  Unique index on `(conversation_id, agent_name)`.
- **State shape for the CoS** (canonical, defined in code):
  ```ts
  type CosState = {
    current_focus: string | null;          // the topic we're working on
    open_questions: string[];              // things the user asked but we haven't resolved
    recent_specialist_outputs: {           // rolling log, last 10
      agent: string;
      summary: string;
      turn: number;
    }[];
    user_preferences_this_session: Record<string, string>;
    turn_count: number;
  };
  ```
- **State shape for specialists** is smaller (just their last output + a "context" string). Each specialist can read and write its own state via `load_state(agent_name)` / `save_state(agent_name, json)`.
- **Lifecycle**:
  - Turn start: chat/route.ts loads `agent_state` rows for this `conversation_id` and injects them into the CoS's input as a system message ("Your working memory from previous turns: ...").
  - During the turn: the CoS can read/write its own state via tools. Specialists read/write their own.
  - Turn end: the CoS's last `save_state` call is the authoritative one. We do NOT auto-save the full state on every tool call — last write wins.
  - Specialists' state is updated in their own turn-end hook (only if the Runner exposes one; otherwise we just `save_state` as the last step of the specialist's `consult_agent` invocation).

**Why not Mem0 for state?** Mem0 is for facts. State is structured, per-conversation, and changes every turn — it would pollute the fact store and be expensive to retrieve. A PB collection is the right tool.

**File: [memory-service/scripts/pb_bootstrap.py](file:///workspace/superhuman-va/memory-service/scripts/pb_bootstrap.py)** — add a third collection `agent_state` with the schema above. Re-running the script is idempotent.

**File: [next-app/lib/state.ts](file:///workspace/superhuman-va/next-app/lib/state.ts)** — new file. `loadState(pb, convId, agentName)` and `saveState(pb, convId, agentName, json)` thin wrappers.

**File: [next-app/lib/agents/tools/state.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/state.ts)** — new file. Wraps `state.ts` as OpenAI Agents SDK tools: `load_my_state(agentName)`, `save_my_state(agentName, json)`.

#### 1.4.3 Agent-to-agent messaging

**Goal**: specialists can consult each other directly, not only through the CoS.

**Design**:

- **New PocketBase collection `agent_messages`**. Schema:
  ```
  id              (auto)
  conversation_id (relation → conversations, cascadeDelete)
  turn_id         (text, e.g. ULID; groups messages of one turn)
  from_agent      (text, e.g. "CoS", "CTO", "CSO")
  to_agent        (text, e.g. "CSO", "CoS", "User")
  message         (text, up to 20000 chars)
  reply           (text, up to 20000 chars, nullable)
  status          (select: pending / replied / errored)
  created_at      (date, auto)
  ```
- **The `consult_agent` tool** (one definition, used by every specialist):
  ```ts
  // pseudo-Zod
  consult_agent({
    agent_name: z.enum([/* all registered agent names */]),
    message: z.string(),
    context_hint: z.string().optional(),
  })
  ```
  Handler:
  1. Insert a row into `agent_messages` with `status=pending`, `from_agent=<caller>`, `to_agent=<target>`.
  2. Look up the target agent in `registry.ts`.
  3. Call `Runner.run(targetAgent, message, { context: { ..., fromAgent: caller } })`.
  4. Insert the reply into the same row (`status=replied`, `reply=<output>`).
  5. Stream a `agent_message` SSE event so the Team Panel shows the exchange live.
  6. Return the reply text to the caller.
- **Round-tripping the conversation_id**: every agent invocation needs to know which conversation it belongs to. We pass it through the OpenAI Agents SDK's `RunContext`. The chat/route.ts handler creates a fresh `RunContext` per turn with `{ conversationId, userId, turnId }`.
- **Loop guard**: a specialist cannot call `consult_agent` recursively more than 3 deep (e.g. CTO → CSO → CFO is fine; CTO → CSO → CFO → CTO is not). We enforce with a simple depth counter in the RunContext.
- **Cost control**: a specialist that calls `consult_agent` adds an extra LLM round-trip. The CoS prompt guides specialists to only consult when the question is genuinely cross-domain. We also expose a per-turn `max_agent_consults` (default 4) in the RunContext.

**File: [memory-service/scripts/pb_bootstrap.py](file:///workspace/superhuman-va/memory-service/scripts/pb_bootstrap.py)** — add the `agent_messages` collection.

**File: [next-app/lib/messaging.ts](file:///workspace/superhuman-va/next-app/lib/messaging.ts)** — new file. `postMessage(pb, ...)` and `markReplied(pb, msgId, reply)` thin wrappers. Also `listTurnMessages(pb, turnId)` for the Team Panel.

**File: [next-app/lib/agents/tools/consult.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/consult.ts)** — new file. Defines the `consult_agent` tool. Imports the target agent from `registry.ts` and invokes it.

#### 1.4.4 DeepSeek V4 Pro for all agents

**Goal**: every agent uses `deepseek-v4-pro`. Per-agent reasoning mode (Non-Think / Think High / Think Max) is the only dial.

**Design**:

- **Single constant** `MODEL = "deepseek-v4-pro"` in [next-app/lib/agents/model.ts](file:///workspace/superhuman-va/next-app/lib/agents/model.ts).
- **Reasoning mode per agent** is passed via two parameters on each `chat.completions.create` call. The model adapter reads it from the `RunContext` (set by chat/route.ts) and translates it to DeepSeek's V4 Pro API shape:
  - **Non-Think** → `extra_body: { thinking: { type: "disabled" } }`, `reasoning_effort` omitted.
  - **Think High** → `extra_body: { thinking: { type: "enabled" } }`, `reasoning_effort: "high"`.
  - **Think Max** → `extra_body: { thinking: { type: "enabled" } }`, `reasoning_effort: "max"`.
- **The OpenAI Agents SDK's `Agent` constructor doesn't have a built-in `thinking` field** — but our `Model` adapter gets to translate the `AgentInputItem[]` into an OpenAI-shaped request, so we add the two parameters there. (V4 Pro's official spec also accepts `thinking_mode: "non-thinking" | "thinking" | "thinking_max"` as a shortcut, but we stick to the explicit `extra_body` form for clarity.)
- **Default reasoning mode per agent** lives in `registry.ts` (alongside the agent definition):
  ```ts
  export const ctoAgent = new Agent({
    name: "CTO",
    instructions: ...,
    model: MODEL,
  });
  export const ctoConfig = { reasoning: "think_high" as const };
  ```
  The chat/route.ts runner sets the default on the RunContext. A specialist can override when it calls `consult_agent` (e.g. Critic always uses Think Max regardless of who calls it).
- **Env change**: `DEEPSEEK_MODEL=deepseek-v4-pro` in `.env.local.example` and `.env.example`.

**File: [next-app/lib/deepseek.ts](file:///workspace/superhuman-va/next-app/lib/deepseek.ts)** — change default from `"deepseek-chat"` to `"deepseek-v4-pro"`.

**File: [memory-service/app/config.py](file:///workspace/superhuman-va/memory-service/app/config.py)** — change default from `"deepseek-chat"` to `"deepseek-v4-pro"` (so Mem0's internal LLM uses V4 Pro too).

---

#### 1.4.5 Tool-use for code execution (NEW — round 2)

**Goal**: CTO, CFO, CSO, and Planner can actually run code — not just talk about it. Math, quick prototypes, payload simulations, scenario analysis.

**Design**:

- **Two tools**, both backed by the same sandbox:
  - `compute(expression: string)` — fast, single-expression math. Returns a number or string. Used for ROI, NPV, runway calcs. < 200 ms typical.
  - `run_code(snippet: string, language: "javascript")` — multi-line JS, returns stdout. Used for prototypes, simulations, payload demos. 5-second timeout default.
- **Sandbox**: `node:vm` with a fresh `vm.createContext` per call. No `require`, no `globalThis.process`, no `fetch`, no `fs`. A curated `safeGlobals` object exposes only: `Math`, `Date`, `JSON`, `console.log` (captured into stdout), `Array`, `Object`, `String`, `Number`, `Boolean`.
- **Resource limits** (set via `vm.Script` + a watchdog timer):
  - Wall clock: 5 s default; 30 s hard cap.
  - Memory: rely on V8's default heap; for stricter control we can set `--max-old-space-size=128` on the Node process (already small in the docker image). For the MVP this is good enough; a v2 follow-up adds `isolated-vm` for true per-call memory caps.
  - No network, no filesystem, no child processes — node:vm enforces this naturally because the context has no `require` and no Node primitives.
- **Cost control**: `compute` is cheap; `run_code` adds latency. The CTO and CFO prompts guide them to prefer `compute` for math. A `RunContext.max_run_code_calls` (default 3) per turn caps abuse.
- **What CSO can do with it**: red-team a payload, simulate a brute-force timing, parse a JWT to demonstrate a vulnerability. All sandboxed. The user's existing CSO prompt already frames this as advisory — `run_code` is a teaching tool, not an attack tool.
- **What about Python?** Out of scope for v1. The sandbox is JS-only. A v2 follow-up could embed Pyodide (~10 MB cold start) or run a separate Python worker in Docker with `docker exec` + seccomp.

**Why not a separate worker process?** `node:vm` is enough for the math + small-script use case, and it adds zero new infrastructure. We're already running Node. If a specialist needs real Python (e.g. data analysis on a CSV), we add a worker in v2.

**File: [next-app/lib/agents/tools/code-exec.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/code-exec.ts)** — new file. Defines `compute` and `run_code` tools. The `run_code` handler:
  1. Wraps the snippet in `(function() { "use strict"; ${snippet} })()`.
  2. Creates a fresh `vm.Context` with safe globals.
  3. Compiles a `vm.Script` with a 5-second timeout.
  4. Captures `console.log` calls into an in-memory buffer.
  5. Returns `{ stdout, value, error }`.
  6. Catches any `Script execution timed out` and returns a friendly error.

**Wire-up**: import in [cto.ts](file:///workspace/superhuman-va/next-app/lib/agents/specialists/cto.ts), [cfo.ts](file:///workspace/superhuman-va/next-app/lib/agents/specialists/cfo.ts), [cso.ts](file:///workspace/superhuman-va/next-app/lib/agents/specialists/cso.ts), [planner.ts](file:///workspace/superhuman-va/next-app/lib/agents/specialists/planner.ts).

---

#### 1.4.6 Conflict resolution between specialists (NEW — round 2)

**Goal**: when two specialists disagree, the CoS resolves it deterministically — not by ignoring the disagreement and not by picking whichever it saw first.

**Design**:

- **The `resolve_conflict` tool** (available only to the CoS):
  ```ts
  resolve_conflict({
    question: string,
    positions: z.array(z.object({
      agent: z.string(),
      stance: z.string(),       // one-sentence summary
      reasoning: z.string(),    // 2-3 sentence defense
    })).min(2),
    conflict_type: z.enum(["domain_internal", "values_tradeoff", "technical_factual"]),
  })
  ```
- **Three strategies**, picked by `conflict_type`:
  1. **`domain_internal`** — one specialist clearly owns the question (e.g. CFO says "$5k/month" and CMO says "we should spend $50k/month on ads"). The CoS **decides** in its own turn using the `CoS` reasoning. Returns the winning position + a one-sentence justification. The Team Panel shows it as "CoS ruled: ...".
  2. **`values_tradeoff`** — the disagreement is about what the *user* wants (e.g. ADHD Coach says "do it now" + CFO says "sleep on it"). The CoS **escalates to the user**. The tool:
     - Emits a special SSE event `conflict` with `{ question, options: [...], recommendation }`.
     - Pauses the CoS's stream (close it, do not finalize the answer).
     - Returns a synthetic "user will pick" marker; the CoS's next turn (after the user clicks) continues.
     - The Team Panel renders a `ConflictCard` component with the options and a "Pick" button per option.
  3. **`technical_factual`** — the disagreement is about a fact or a technical claim (e.g. CTO says "Postgres scales to 100 TB" and CSO says "Postgres caps at 50 TB"). The CoS **delegates to the Critic in arbitration mode** (Think Max, with a specific arbitration prompt). Returns the Critic's verdict + reasoning. Team Panel shows "Critic arbitrated: ...".
- **How the CoS picks the `conflict_type`**: this is the hard part. We don't expect the CoS to always get it right. The CoS's prompt gets a rubric:
  - If both specialists' answers are about the **same metric or fact** → `technical_factual`.
  - If both specialists' answers are **recommendations that depend on user priorities** → `values_tradeoff`.
  - If one specialist is **clearly out of their lane** (e.g. CFO answering a marketing question) → `domain_internal`.
  - If unsure → `values_tradeoff` (escalate; the cost of asking is low).
- **Critic arbitration mode**: when the CoS calls `consult_agent("Critic", <arbitration-prompt>)`, the consult.ts tool uses a different `REASONING` for the Critic (forces Think Max) and a different system prompt suffix: "You are arbitrating a conflict between two specialists. Pick a winner. Justify with 2-3 sentences. Do not hedge." The Critic's regular `flag_issues` tool is not available in this mode.
- **State persistence**: each resolved conflict is recorded as an `agent_message` row with `to_agent = "ConflictResolution"` (or a dedicated `to_agent` value like `"__conflict__"`). Visible in the Team Panel history.
- **Cost**: domain_internal is free (CoS reasons). values_tradeoff pauses the stream — net cost ≈ 0 until the user replies. technical_factual adds one Critic call (Think Max, expensive but bounded). Worst case a turn costs 1×CoS + 1×Critic.

**File: [next-app/lib/agents/tools/resolve-conflict.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/resolve-conflict.ts)** — new file. Defines the `resolve_conflict` tool. Imports the Critic via the registry for the `technical_factual` path. Emits the `conflict` SSE event for the `values_tradeoff` path.

**File: [next-app/components/conflict-card.tsx](file:///workspace/superhuman-va/next-app/components/conflict-card.tsx)** — new file. Renders the picker UI for the `values_tradeoff` case. Posts the user's choice back to `/api/chat` as a synthetic message.

**File: [next-app/app/api/chat/route.ts](file:///workspace/superhuman-va/next-app/app/api/chat/route.ts)** — handle a new request shape: `{ kind: "conflict_resolution", conflictId, choice }` in addition to the regular `{ message, conversationId, userId }` shape. The handler loads the paused turn's state, injects the user's choice as a synthetic user message, and resumes the CoS stream.

**Wire-up**: `resolve_conflict` is added only to the CoS agent's tool list (no other specialist needs it). `arbitrate_conflict` is a thin re-export of the Critic with a forced prompt suffix; it lives in the same `resolve-conflict.ts` file.

---

## 2. Framework setup

### 2.1 Add the OpenAI Agents SDK

**Edit** [next-app/package.json](file:///workspace/superhuman-va/next-app/package.json):

```diff
   "dependencies": {
+    "@openai/agents": "^0.3.0",
+    "tavily": "^0.5.0",
     ...
   }
```

(Use the real latest versions when implementing; `@openai/agents` is at 0.3.x as of late 2025.)

### 2.2 DeepSeek V4 Pro model adapter

The SDK is provider-agnostic. We wrap our existing DeepSeek client and add a `thinking` parameter.

**New file**: [next-app/lib/agents/model.ts](file:///workspace/superhuman-va/next-app/lib/agents/model.ts)

```ts
import { Agent, Runner, setDefaultModel, type Model } from "@openai/agents";
import OpenAI from "openai";

export const MODEL = "deepseek-v4-pro";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
});

export type ReasoningMode = "non_think" | "think_high" | "think_max";

export const deepseekModel: Model = {
  async getResponse(messages, options) {
    // SDK calls this when streamResponse is not available.
    // Translate AgentInputItem[] → OpenAI chat messages, attach
    // `thinking` from the per-agent config, return a ModelResponse.
  },
  async *streamResponse(messages, options) {
    // Forward to deepseek.chat.completions.create({stream: true, model: MODEL, ...})
    // Translate the SSE chunks to ModelResponse events the SDK understands.
    // Pull `thinking` from the RunContext to decide the reasoning mode.
  },
};

export { Agent, Runner, setDefaultModel };
```

**Reasoning mode plumbing**: the adapter receives the `RunContext` (passed by the Runner). We attach a `reasoning` field to the context when we start the run:

```ts
const runner = new Runner({ model: deepseekModel });
const stream = await runner.runStreamed(coAgent, input, {
  context: {
    conversationId,
    userId,
    turnId,
    reasoning: "think_high" as ReasoningMode, // CoS default
  },
});
```

The adapter reads `context.reasoning` and translates to DeepSeek's V4 Pro API:

```ts
// Translate our internal ReasoningMode → DeepSeek's API shape.
function reasoningParams(mode: ReasoningMode) {
  switch (mode) {
    case "non_think":
      return { reasoning_effort: undefined, extra_body: { thinking: { type: "disabled" } } };
    case "think_high":
      return { reasoning_effort: "high", extra_body: { thinking: { type: "enabled" } } };
    case "think_max":
      return { reasoning_effort: "max", extra_body: { thinking: { type: "enabled" } } };
  }
}

const completion = await deepseek.chat.completions.create({
  model: MODEL,
  stream: true,
  temperature: 1.0,   // DeepSeek recommends 1.0; default OpenAI temp 0.7 is suboptimal
  top_p: 1.0,         // ditto
  ...reasoningParams(context.reasoning),
  messages,
});
```

The stream yields two kinds of chunks: `delta.reasoning_content` (the CoT) and `delta.content` (the final answer). We forward only `content` to the client; `reasoning_content` stays server-side for debugging (we log it at debug level).

### 2.3 Tool definition convention

The SDK defines tools as Zod schemas + async handlers. We centralise tool factories so specialists just import what they need.

**New file**: [next-app/lib/agents/tools/index.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/index.ts) — re-exports everything.

| New file | Wraps |
|---|---|
| [next-app/lib/agents/tools/mem0.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/mem0.ts) | `memoryClient.searchMemory`, `addMemory`, `listMemories`, plus the new `searchGlobalMemory`, `addGlobalMemory`, `listGlobalMemory`, `promoteToGlobal` (for the Memory agent). |
| [next-app/lib/agents/tools/qdrant.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/qdrant.ts) | `memoryClient.searchDocuments`, `listDocuments`. |
| [next-app/lib/agents/tools/web-search.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/web-search.ts) | Tavily SDK. New env var `TAVILY_API_KEY`. |
| [next-app/lib/agents/tools/visualize.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/visualize.ts) | `render_visual({type, data})` → Markdown / Mermaid string. |
| [next-app/lib/agents/tools/state.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/state.ts) | `load_my_state`, `save_my_state` (1.4.2). |
| [next-app/lib/agents/tools/consult.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/consult.ts) | `consult_agent(name, message)` (1.4.3). This tool is the *bridge* between specialists. |
| [next-app/lib/agents/tools/code-exec.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/code-exec.ts) | `compute(expr)` + `run_code(snippet)` via `node:vm` (1.4.5). |
| [next-app/lib/agents/tools/resolve-conflict.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/resolve-conflict.ts) | `resolve_conflict(...)` for the CoS (1.4.6). |

---

## 3. Specialist agents

### 3.1 The pattern

Every specialist is a single file in [next-app/lib/agents/specialists/](file:///workspace/superhuman-va/next-app/lib/agents/specialists/) with the same shape:

```ts
// cto.ts
import { Agent } from "@openai/agents";
import { MODEL, type ReasoningMode } from "@/lib/agents/model";
import { consultAgentTool } from "@/lib/agents/tools/consult";

export const REASONING: ReasoningMode = "think_high";

export const ctoAgent = new Agent({
  name: "CTO",
  instructions: `You are the CTO on the user's advisory team.
You advise on architecture, technology choices, code review, and engineering trade-offs.
You are decisive. You give concrete recommendations with one-paragraph reasoning.
You never hedge with "it depends" without explaining what it depends on.
If a question touches security, compliance, or risk, call consult_agent("CSO", <your question>).`,
  tools: [consultAgentTool],
  model: MODEL,
});

export const ctoHandoff = ctoAgent.asHandoffTool({
  toolName: "consult_cto",
  toolDescription: "Consult the CTO for architecture, code, or technical decisions.",
});
```

### 3.2 Files to create

| File | Agent | Reasoning | Tools |
|---|---|---|---|
| `chief-of-staff.ts` | **CoS** | Think High | `consult_specialist` (handoff to all), `consult_agent`, `visualize`, `load_my_state`, `save_my_state`, `list_global_facts`, **`resolve_conflict`** |
| `memory-agent.ts` | Memory | Non-Think | `search_memory`, `search_global_memory`, `add_memory`, `add_global_memory`, `promote_to_global` |
| `document-agent.ts` | Document | Non-Think | `search_documents`, `list_documents` |
| `researcher.ts` | Web | Non-Think | `tavily.search` |
| `planner.ts` | Planner | Think High | `decompose`, `compute`, `run_code` |
| `critic.ts` | Critic | **Think Max** | `flag_issues` (+ arbitration mode invoked via `consult_agent` from CoS) |
| `cto.ts` | CTO | Think High | `consult_agent`, `compute`, `run_code` |
| `cfo.ts` | CFO | Think High | `consult_agent`, `compute`, `run_code` |
| `cmo.ts` | CMO | Think High | `consult_agent` |
| `cso.ts` | CSO | Think High | `consult_agent`, `run_code` (for PoC exploits / payload analysis) |
| `adhd-coach.ts` | ADHD | Non-Think | — |
| `fitness-coach.ts` | Fitness | Non-Think | — |
| `therapist.ts` | Therapist | Non-Think | — |
| `registry.ts` | — | — | Maps agent name → handoff + reasoning mode + arbitration prompt |

### 3.3 The CoS prompt (V2 — explicitly cross-conversation, stateful, A2A-aware)

```text
You are the user's Chief of Staff and their only point of contact.

You are NOT a knowledge base. You never answer from your own training.
You consult the right specialist(s) on the team, then write a TLDR + a
structured answer for the user.

# How you work

- Cross-conversation memory: Mem0 already gives you access to all of the
  user's memories across all conversations. Treat them as one big pool.
  Identity-level facts (job, family, health, goals) are auto-listed for
  you in the "GLOBAL FACTS" section below. Do not re-ask for them.

- Persistent state: at the start of this turn, your previous working
  memory is loaded in the "WORKING MEMORY" section below. Read it
  first. Update it at the end of the turn with save_my_state().

- Agent-to-agent: any specialist you delegate to can in turn delegate to
  another specialist via consult_agent(). You will see the chain in the
  team panel. You only re-engage when the chain has produced enough.

- Conflicts: when two specialists disagree, do NOT silently pick one or
  blend their positions. Call resolve_conflict(...) and pass the conflict
  type:
    * same metric / fact being disputed       → conflict_type="technical_factual"
    * recommendations that depend on priorities → conflict_type="values_tradeoff"
    * one specialist is out of their lane      → conflict_type="domain_internal"
    * unsure                                  → conflict_type="values_tradeoff"

# Response format

## TL;DR
[2-3 sentences max. The single most important takeaway.]

## Recommendation
[The concrete next action the user should take.]

## Details
[Bullet points or short sections. Pull in specialist output here.
 Cite which specialist said what, e.g. "(per CTO, confirmed by CSO)".]

## Visual
[Optional. A small table, Mermaid diagram, or numbered list — when
 the answer benefits from structure.]

You can consult multiple specialists in parallel. You don't have to
consult any if the message is small talk ("hi", "thanks", "lol").
Match the user's tone. If they're stressed, be brief and warm.
If they're asking for a deep dive, be thorough.
```

The CoS system prompt is constructed by chat/route.ts by templating this skeleton with the loaded `agent_state` and the global facts list. The CoS sees:

```text
[skeleton above]

# GLOBAL FACTS
- user is a backend engineer at a fintech
- user's mother is named Sara
- user has ADHD (diagnosed 2023)

# WORKING MEMORY
- current_focus: choosing between PostgreSQL and MongoDB for the new app
- open_questions:
  - "What's the long-term cost of each?"
  - "Does the team have MongoDB experience?"
- recent_specialist_outputs:
  - CTO: recommended Postgres for ACID + JSONB hybrid
  - CFO: rough 3-year TCO favoring Postgres by ~$40k
- turn_count: 7
```

### 3.4 Specialist prompts

V2 adds one line per specialist that tells it *when* to use `consult_agent`:

**CTO**
> You are the CTO. Architecture, code, technical decisions. Be decisive. Give one recommendation, with reasoning. Use code blocks. You are not a teacher; you are a peer. **If a question touches security, compliance, or risk, call `consult_agent("CSO", <your question>)` before answering.** **For math, always prefer `compute(expr)` over estimating in prose.** **For prototypes / data-shape sketches, use `run_code(snippet)` and show the output.**

**CFO**
> You are the CFO. Finance, budgeting, ROI, runway, unit economics. Be quantitatively precise. Never make up numbers. Use tables. **For cost-of-engineering questions, call `consult_agent("CTO", <your question>)` first to ground the estimate.** **Use `compute` for every numeric claim. Use `run_code` for multi-year scenario simulations.**

**CMO**
> You are the CMO. Marketing, growth, brand, positioning. Speak in funnels, conversion, positioning. **For questions about product capabilities or roadmap, call `consult_agent("CTO", <your question>)`.**

**CSO**
> You are the CSO. Security, compliance, risk. Think in threat models. Worst case first, then mitigation, then residual risk. **For financial impact of a security event, call `consult_agent("CFO", <your question>)`.** **Use `run_code` to demonstrate exploits / parse a JWT / time a brute-force in a sandboxed snippet. Never propose exploits against systems you don't own.**

**Planner**
> You are the Planner. You take a complex task and break it into ordered, time-boxed sub-steps. You are decisive: 3-7 steps, not 30. **Use `compute` for any time / cost estimate. Use `run_code` to validate a step's preconditions (e.g. file size, API quota).**

**ADHD Coach**
> You are an ADHD coach. Smallest possible next step, time-box, lower activation energy. Never say "just focus". Suggest environment changes, body doubling, timers, reward pairing. **Save your recommendations to your state with `save_my_state` so we don't lose them next turn.**

**Fitness Coach**
> You are a fitness coach. Evidence-based training, recovery, nutrition. Ask about level before prescribing. Never recommend extreme protocols.

**Therapist**
> You are a thoughtful, warm, non-clinical therapist. Reflective listening. Help the user name what they feel. Do not diagnose. If self-harm ideation or acute crisis: name that you are not a crisis resource and suggest 988 (US) or local equivalent.

(Memory / Document / Researcher / Planner / Critic are utility specialists — shorter tactical prompts. The Memory agent is told explicitly: "search across ALL of the user's memories, not just this conversation. Promote stable identity facts to global with `promote_to_global`.")

---

## 4. The chat route

### 4.1 Strategy

Rewrite `chat/route.ts` to use the CoS. The single-LLM path is gone.

### 4.2 New route: [next-app/app/api/chat/route.ts](file:///workspace/superhuman-va/next-app/app/api/chat/route.ts) (rewritten)

```ts
import { Runner } from "@openai/agents";
import { deepseekModel } from "@/lib/agents/model";
import { chiefOfStaff } from "@/lib/agents/specialists/chief-of-staff";
import { pbAsAdmin } from "@/lib/pocketbase";
import { loadState, saveState } from "@/lib/state";
import { memoryClient } from "@/lib/memory-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { conversationId: incomingConvId, message, userId } = body;
  const convId = await ensureConversation(incomingConvId, message, userId);
  const turnId = new ULID().toString();

  // ── Parallel context load (V2) ──
  const [history, memState, globalFacts] = await Promise.all([
    loadHistory(convId),
    loadAgentState(convId, "CoS"),
    memoryClient.listGlobalMemories(userId).catch(() => []),
  ]);

  // ── Build CoS input ──
  const input = buildCosInput({ history, memState, globalFacts, message });

  // ── Run the swarm, stream to the browser ──
  const runner = new Runner({ model: deepseekModel });
  const stream = await runner.runStreamed(chiefOfStaff, input, {
    context: { conversationId: convId, userId, turnId, reasoning: "think_high" },
  });

  return new Response(translateToSSE(stream, { turnId, convId }), {
    headers: { "Content-Type": "text/event-stream", ... },
  });

  // After stream: persist history + agent_state (last write wins) +
  //   fire-and-forget Mem0 add (cross-conversation) +
  //   mark agent_messages for this turn_id as resolved.
}
```

### 4.3 SSE event types (V2)

| SDK event | SSE type | Client effect |
|---|---|---|
| `raw_model_stream_event` (text delta) | `token` | Append to assistant bubble |
| `run_item_stream_event` (tool_call) | `tool_start` | Add to TeamPanel |
| `run_item_stream_event` (tool_result) | `tool_done` | Add specialist's output to TeamPanel |
| `run_item_stream_event` (`run_code`/`compute`) | `code_run` | TeamPanel shows "CTO ran: `for (let i=0;...)`" + output |
| `agent_updated_stream_event` (handoff) | `handoff` | TeamPanel shows specialist took over |
| `consult_agent` tool_call | `agent_message` | TeamPanel shows specialist → specialist exchange |
| `resolve_conflict` tool_call (values_tradeoff) | `conflict` | TeamPanel renders `ConflictCard` with options; stream pauses |
| `resolve_conflict` tool_call (domain_internal / technical_factual) | `conflict_resolved` | TeamPanel shows "CoS ruled: X" or "Critic arbitrated: Y" |
| final message | `done` | Close stream |
| start | `meta` | Send `conversationId`, `turnId` |

---

## 5. UI: Team Panel

**New file**: [next-app/components/team-panel.tsx](file:///workspace/superhuman-va/next-app/components/team-panel.tsx)

Same shape as before, but renders three event types:

```tsx
"use client";
interface TeamEvent {
  type: "tool_start" | "tool_done" | "handoff" | "agent_message";
  from?: string;
  to?: string;
  agent: string;
  detail?: string;
  output?: string;
}

export function TeamPanel({ events }: { events: TeamEvent[] }) {
  return (
    <aside>
      <h3>Team activity</h3>
      {events.map((e, i) => <TeamEventRow key={i} event={e} />)}
    </aside>
  );
}
```

**Edit** [next-app/app/chat/page.tsx](file:///workspace/superhuman-va/next-app/app/chat/page.tsx) — add `teamEvents` state, parse the new SSE event types, render the panel as a right-side drawer.

---

## 6. Env & config

### 6.1 Edit [next-app/.env.local.example](file:///workspace/superhuman-va/next-app/.env.local.example)

```diff
-DEEPSEEK_MODEL=deepseek-chat
+DEEPSEEK_MODEL=deepseek-v4-pro
+# ── Researcher (Tavily web search) ───────────────────
+# Free tier: 1000 searches/month. Get a key at https://tavily.com
+TAVILY_API_KEY=tvly-replace-me
```

### 6.2 Edit [next-app/lib/deepseek.ts](file:///workspace/superhuman-va/next-app/lib/deepseek.ts)

```diff
-export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
+export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
```

### 6.3 Edit [memory-service/app/config.py](file:///workspace/superhuman-va/memory-service/app/config.py)

```diff
-deepseek_model: str = Field(default="deepseek-chat", alias="DEEPSEEK_MODEL")
+deepseek_model: str = Field(default="deepseek-v4-pro", alias="DEEPSEEK_MODEL")
```

### 6.4 Edit [memory-service/scripts/pb_bootstrap.py](file:///workspace/superhuman-va/memory-service/scripts/pb_bootstrap.py)

Add `AGENT_STATE_SCHEMA` and `AGENT_MESSAGES_SCHEMA` constants and create both collections (idempotent).

### 6.5 Edit [memory-service/app/qdrant_client.py](file:///workspace/superhuman-va/memory-service/app/qdrant_client.py)

Add a `memories_global` Qdrant collection, auto-create on startup.

### 6.6 docker-compose: no changes

`next-app` env gets `TAVILY_API_KEY`; everything else stays.

---

## 7. Streaming performance & cost controls

(unchanged from V1, plus one addition)

- **Parallel specialist calls** — the SDK handles natively.
- **Small-talk fast path** — skip the swarm for `/^(hi|hey|thanks|ok|okay|lol|bye)[\s!.]*$/i`.
- **Critic is opt-in** — only for high-stakes queries.
- **Result cache** — in-memory `Map<conversationId+queryHash, result>` with 5-min TTL.
- **NEW: agent-to-agent consult budget** — `RunContext.max_agent_consults` (default 4). The CoS prompt guides specialists to batch questions rather than ping-pong.

---

## 8. Adding a new agent (the easy part)

After the framework is in place, adding a new specialist is a 3-step recipe:

1. **Create** `lib/agents/specialists/<name>.ts` with the agent definition + handoff tool + `REASONING` constant.
2. **Register** in `lib/agents/specialists/registry.ts`:
   ```ts
   import { chefAgent, chefHandoff } from "./chef";
   export const handoffs = [...existingHandoffs, chefHandoff];
   ```
3. **Update** the CoS prompt (or `registry.ts` schema) to mention the new agent by name + reasoning mode.

That's it. The CoS will start routing relevant questions to it, and the new agent gets the cross-conversation memory + persistent state + A2A bus for free.

---

## 9. File-by-file deliverable summary

**New files (24):**

| File | Purpose |
|---|---|
| `next-app/lib/agents/model.ts` | DeepSeek V4 Pro adapter with `thinking` mode plumbing |
| `next-app/lib/agents/tools/index.ts` | Tool re-exports |
| `next-app/lib/agents/tools/mem0.ts` | Mem0 tools (incl. global pool) |
| `next-app/lib/agents/tools/qdrant.ts` | Qdrant search/list |
| `next-app/lib/agents/tools/web-search.ts` | Tavily web search |
| `next-app/lib/agents/tools/visualize.ts` | Mermaid/table renderer |
| `next-app/lib/agents/tools/state.ts` | `load_my_state`, `save_my_state` (1.4.2) |
| `next-app/lib/agents/tools/consult.ts` | `consult_agent` (1.4.3) — the A2A bridge |
| `next-app/lib/agents/tools/code-exec.ts` | `compute` + `run_code` via `node:vm` (1.4.5) |
| `next-app/lib/agents/tools/resolve-conflict.ts` | `resolve_conflict` for the CoS (1.4.6) — domain / values / technical arbitration |
| `next-app/lib/state.ts` | PB wrappers for `agent_state` collection |
| `next-app/lib/messaging.ts` | PB wrappers for `agent_messages` collection |
| `next-app/lib/agents/specialists/chief-of-staff.ts` | The CoS agent |
| `next-app/lib/agents/specialists/memory-agent.ts` | Memory specialist (cross-conversation) |
| `next-app/lib/agents/specialists/document-agent.ts` | Document specialist |
| `next-app/lib/agents/specialists/researcher.ts` | Web researcher |
| `next-app/lib/agents/specialists/planner.ts` | Task planner |
| `next-app/lib/agents/specialists/critic.ts` | Reviewer (Think Max) + arbitration prompt |
| `next-app/lib/agents/specialists/cto.ts` | CTO (with `compute` + `run_code`) |
| `next-app/lib/agents/specialists/cfo.ts` | CFO (with `compute` + `run_code`) |
| `next-app/lib/agents/specialists/cmo.ts` | CMO |
| `next-app/lib/agents/specialists/cso.ts` | CSO (with `run_code` for PoC) |
| `next-app/lib/agents/specialists/adhd-coach.ts` | ADHD coach |
| `next-app/lib/agents/specialists/fitness-coach.ts` | Fitness coach |
| `next-app/lib/agents/specialists/therapist.ts` | Therapist |
| `next-app/lib/agents/specialists/registry.ts` | Agent → handoff + reasoning mode + arbitration prompt |
| `next-app/components/team-panel.tsx` | Live activity UI (with A2A + conflict events) |
| `next-app/components/conflict-card.tsx` | Picker UI for `values_tradeoff` conflicts (1.4.6) |
| `memory-service/app/routes/memories.py` (edit) | Add `/add_global_memory`, `/search_global_memory`, `/list_global_memory` |

**Edited files (6):**

| File | Change |
|---|---|
| `next-app/package.json` | Add `@openai/agents` + `tavily` |
| `next-app/.env.local.example` | `DEEPSEEK_MODEL=deepseek-v4-pro` + `TAVILY_API_KEY` |
| `next-app/lib/deepseek.ts` | Default model → `deepseek-v4-pro` |
| `next-app/app/api/chat/route.ts` | Rewrite to use CoS + V2 context load + `conflict_resolution` resume |
| `next-app/app/chat/page.tsx` | Add Team Panel drawer + ConflictCard + new SSE event types |
| `memory-service/app/config.py` | Default model → `deepseek-v4-pro` |
| `memory-service/app/qdrant_client.py` | Add `memories_global` collection |
| `memory-service/scripts/pb_bootstrap.py` | Add `agent_state` + `agent_messages` collections |

**No changes** to: `docker-compose.yml`, `caddy/`, `next-app/Dockerfile`, `next-app/components/ui/`, or the shadcn primitives.

Total: ~26 new files, 8 edits, ~1,100 LOC.

---

## 10. Ship order

| Step | Scope | Why this order |
|---|---|---|
| 1 | Install SDK + DeepSeek V4-Pro adapter + run a "hello world" agent locally | Validates the model adapter and `thinking` mode end-to-end before any other code is written. |
| 2 | `pb_bootstrap.py` adds `agent_state` + `agent_messages` collections; `state.ts` + `messaging.ts` + their PB wrappers | State + messaging are dependencies for every agent. |
| 3 | Mem0 global pool: `memory.py` adds global methods; `qdrant_client.py` adds the collection; `routes/memories.py` adds 3 endpoints; `mem0.ts` tools gain the new methods | Unblocks the Memory agent. |
| 4 | `state.ts` and `consult.ts` tools; `consult_agent` works against a stub target | Validates the A2A bus with one consumer. |
| 5 | `code-exec.ts` — `compute` + `run_code` via `node:vm`. Test with a tiny `let sum = 1+1; sum` snippet. | Unblocks the math/runnable-code needs of CTO/CFO/CSO/Planner. |
| 6 | CoS + Memory + Document agents, wire into `chat/route.ts` with V2 context load | First end-to-end swarm demo. |
| 7 | Team Panel UI with A2A event rendering | User can see the swarm working. |
| 8 | C-suite (CTO/CFO/CMO/CSO) — 4 files; each gets `consult_agent` + `compute`/`run_code` where useful | Cross-domain reasoning comes alive. |
| 9 | Life specialists (ADHD/Fitness/Therapist) — 3 files | Warmer, slower conversations. |
| 10 | `resolve-conflict.ts` + `conflict-card.tsx` + the new SSE event types; extend `chat/route.ts` to resume paused turns. | Adds the conflict-resolution paths (domain / values / technical). |
| 11 | Tavily + Researcher agent | Adds live info. |
| 12 | Planner + Critic (with cost-control heuristics) + arbitration mode | Production-quality pass. |
| 13 | Verification: cross-conversation smoke test, state persistence smoke test, A2A smoke test, code-exec smoke test, conflict-resolution smoke test | Sign-off. |

---

## 11. What this plan does NOT include (V2)

We removed six items from V1's exclusion list (cross-conversation memory, persistent state, agent-to-agent messaging, V4 Pro, code execution, conflict resolution) — they're all in scope now. The remaining non-goals:

- ❌ Multi-user auth (still single-user)
- ❌ Voice input/output
- ❌ Per-conversation model selection (all use V4 Pro; reasoning mode is the only dial)
- ❌ A formal eval harness (we have a smoke test, not a regression suite)
- ❌ Cost budgets per agent (only a global `max_agent_consults` and `max_run_code_calls` per turn)
- ❌ Python sandbox (JS via `node:vm` only — see 1.4.5)
- ❌ True per-call memory caps (no `isolated-vm` — V8 heap limit is best-effort)
- ❌ Multi-agent voting (CoS decides domain_internal; Critic arbitrates technical_factual; user decides values_tradeoff)
- ❌ Persistent audit log of every CoS decision (we log to console only; Ship v2 if needed)

Each of these is a follow-up. None blocks the demo.

---

## 12. What else is still needed (round 3 candidates)

You asked what's missing beyond the swarm itself. Here's a tiered list — the things that *block the app from working correctly* are at the top, the things that make it *better* are in the middle, and the *v2 nice-to-haves* are at the bottom.

### 12.1 Tier 1 — Required for the app to function correctly

| # | Item | Why it's needed | Effort | Notes |
|---|---|---|---|---|
| T1.1 | **Error handling & retry** | DeepSeek rate-limits, tool throws, CoS stream dies mid-sentence. Without explicit error paths, one failure cascades into a broken chat. | S | Wrap each `Runner.runStreamed` in try/catch; on transient errors, retry once with backoff; on permanent errors, emit an `error` SSE event and persist what we have. |
| T1.2 | **Per-conversation rate limiting** | The user could accidentally trigger a 1000-turn loop (e.g. "loop" + conflict resolution). Without a cap, the API bill is unbounded. | S | Cap at 60 turns/conversation and 200 turns/hour. The CoS's `agent_state.turn_count` is already a natural counter. |
| T1.3 | **Tracing / observability** | When the swarm misbehaves, we need to know which specialist said what, in what order, with what tool calls. The OpenAI Agents SDK has built-in tracing — we just need to wire it somewhere. | M | Default to the SDK's built-in console trace. Add a small SQLite-backed trace log so traces survive server restarts. A LangSmith integration is a v2 follow-up. |
| T1.4 | **Eval harness (golden questions)** | Without a regression suite, every prompt tweak risks breaking the CoS. A formal eval harness is overkill for the MVP, but we need at least 10-20 golden questions with expected behaviors. | M | `eval/golden.yaml` with `input → expected_substrings, expected_specialists, expected_no_specialists`. Run after every prompt change. |
| T1.5 | **`sandbox-escape` security review** | `run_code` accepts arbitrary JS. We need an explicit test suite that tries to break out of the sandbox (`require('fs')`, `process.exit`, `globalThis.fetch`, prototype pollution, infinite loops). | S | 30-line test file. Block ships until all attempts fail. |
| T1.6 | **Backup / restore** | The user has years of memory. Losing PocketBase + Qdrant is catastrophic. We need a one-command backup. | S | `scripts/backup.sh` dumps PB (SQLite) + Qdrant snapshots. Cron on the cloud VM. |
| T1.7 | **Update path for prompts / agents** | When we add an agent or change a prompt, we need to ship the change without losing user state. PB is additive (new collections OK); Qdrant is additive (new collection names OK); the only risk is breaking existing tool schemas. | S | Pin tool versions in `tool_manifest.json`. The Runner checks at startup. |
| T1.8 | **PII purge / "forget me"** | GDPR-ish: the user must be able to delete a fact, a conversation, or everything. Mem0 supports `delete_all(user_id)` already. | S | Add a "Forget this" button on the Memory panel + a "Delete all my data" command. |

### 12.2 Tier 2 — Important, can ship without but should land within a few weeks

| # | Item | Why it matters | Effort |
|---|---|---|---|
| T2.1 | **Even a single-password auth** | The cloud deployment is reachable over HTTPS. Without at least a shared password, the swarm and the user's memories are public. | S |
| T2.2 | **Cost observability** | Token usage per turn, per agent, per day. Show in the UI as a small "💰 $0.12 today" widget. | M |
| T2.3 | **Search across conversation history** | The user wants to find "that conversation about X from 3 weeks ago". We already have `search_documents` on Qdrant; add `search_messages` for raw chat. | M |
| T2.4 | **Conflict resolution UI polish** | The `ConflictCard` needs to show context, allow "ask again", and let the user re-pick. | M |
| T2.5 | **Unit + integration tests** | Tests for the tools (`compute`, `run_code` sandbox escapes), state/messaging PB wrappers, the consult tool's depth counter, the small-talk fast path. | M |
| T2.6 | **Resilient SSE** | The current client breaks if the connection drops mid-stream. Add a `Last-Event-Id` resume path. | S |

### 12.3 Tier 3 — v2 follow-ups (nice-to-haves)

| # | Item | Why we want it eventually | Effort | Why not v1 |
|---|---|---|---|---|
| T3.1 | **Real Python sandbox (Pyodide or Docker worker)** | CFO/CSO would benefit from pandas, numpy, requests. | L | Adds ~10 MB cold start (Pyodide) or a new container (Docker). Not blocking — the JS sandbox handles 90% of use cases. |
| T3.2 | **`isolated-vm` instead of `node:vm`** | True per-call memory caps. `node:vm` shares the V8 heap, so a malicious snippet can OOM the whole Next.js process. | M | Adds a native dep (~30 MB compiled). Default to `node:vm`; switch if we hit any crashes. |
| T3.3 | **LangSmith / Phoenix tracing backend** | Beautiful UIs for swarm traces. | M | Cost ($$) and one more vendor. The built-in console + SQLite trace is enough for the MVP. |
| T3.4 | **Multi-device sync (push notifications, mobile UI)** | The user uses laptop + phone. The swarm should be reachable from both. | L | Not in the user's brief for the MVP. |
| T3.5 | **Voice input / TTS output** | The ADHD Coach + CoS as a daily-driver voice agent. | L | OpenAI Realtime API integration. Deferred. |
| T3.6 | **Encrypted at rest** | Qdrant + PocketBase should AES-encrypt the user's data. | M | Oracle block storage is already encrypted; we don't add another layer. |
| T3.7 | **Export / share a CoS answer** | Generate a public link to a redacted (memories stripped) conversation. | S | Easy to add later. |
| T3.8 | **A formal eval harness with regression suite** | Run on every PR. Fails the build if any of 100+ golden questions regress. | L | Tier 1.4 is the MVP version (golden questions, not CI). |
| T3.9 | **Per-agent cost budgets** | The CFO might consume 10x the tokens of the Memory agent. Show per-agent spend. | S | Easy. Out of MVP scope. |
| T3.10 | **Multi-agent voting (for domain_internal conflicts)** | Today the CoS picks; tomorrow the C-suite could vote. | M | More tokens, slower turns. Defer until we see the CoS picking badly. |
| T3.11 | **Audit log of every CoS decision** | "Why did the CoS recommend X?" | S | Log to PB. Add a "Why?" button to each assistant message that shows the trace. |

### 12.4 My recommendation for what to ship next

If I had to pick **three** to add on top of the swarm, in order:

1. **T1.1 error handling + T1.2 rate limiting** — without these, the app will eventually break in production. They're a 2-hour job and unblock a real cloud deploy.
2. **T1.4 golden-question eval harness** — 10-20 questions, run them after every prompt change. Catches regressions before the user does.
3. **T2.2 cost observability** — once the swarm runs in production, the user will want to know what it costs. A small dashboard widget is the simplest sanity check.

The rest (Python sandbox, formal CI eval, voice, etc.) are clearly v2.

---

## 13. Decision log (assumptions we made and the alternatives we rejected)

So an executor knows what to keep and what to push back on. Each row is a decision baked into the plan; the "alternative" column is what we'd do instead if the user changes their mind.

| Decision | Chosen | Alternative | Why we chose this |
|---|---|---|---|
| **Agent-to-CoS communication** | Specialists can only be reached by the CoS (V1). The CoS is the only public-facing entry point. | Open swarm (any agent can be reached by name from the chat). | Keeps the user interface simple — one "CoS" name to remember. The CoS can always ask for a specific specialist. |
| **Specialist-to-specialist channel** | New `consult_agent` tool backed by PB `agent_messages`. | (a) Handoffs only (no direct A2A). (b) In-memory bus (lost on restart). | PB-backed is observable (Team Panel sees it) and survives restarts. (a) was V1 and explicitly rejected by the user. (b) hides what's happening. |
| **Cross-conversation memory** | Mem0 user-scope (already) + a separate `memories_global` collection for promoted identity facts. | One collection with a `global` flag. | Different retention policies. Two collections is cleaner. |
| **State persistence** | PB `agent_state` collection, per-conversation, per-agent. | (a) Mem0 with metadata. (b) Redis. (c) In-memory. | State is structured, per-conv, changes every turn. PB is already there, queryable from the Team Panel, durable. (a) pollutes the fact store. (b)/(c) add infra. |
| **Code execution sandbox** | `node:vm` (built-in) with safe globals. | (a) `isolated-vm` (native dep, true memory caps). (b) Docker worker. (c) Pyodide for Python. | MVP: zero new infra, handles 90% of use cases. Upgrade to (a) if we hit V8 heap issues. (b)/(c) are v2. |
| **Conflict resolution strategies** | 3-bucket: `domain_internal` (CoS rules), `values_tradeoff` (user picks), `technical_factual` (Critic arbitrates in Think Max). | (a) Always ask the user. (b) Always let the Critic arbitrate. (c) Multi-agent voting. | (a) is annoying. (b) wastes tokens on non-technical disputes. (c) is expensive and slow. The 3-bucket is the minimum that handles the common cases. |
| **Reasoning mode per agent** | Non-Think (utility + life), Think High (CoS + C-suite), Think Max (Critic). | (a) Think High everywhere. (b) Think Max for CoS + C-suite. | Matches the cost/quality tradeoff. Reasoning mode is the only dial; we keep it explicit in the registry. |
| **Per-agent `thinking` API parameter** | V4 Pro: `extra_body: { thinking: { type: "enabled" \| "disabled" } }` + `reasoning_effort: "high" \| "max"`. | (a) DeepSeek's `thinking_mode: "non-thinking" \| "thinking" \| "thinking_max"` shortcut. (b) OpenAI's `reasoning_effort` only. | (a) is a shortcut, not the canonical API. (b) doesn't have a "disabled" mode. The explicit form is clearest. |
| **Critic arbitration prompt** | Suffix: "Pick a winner. Justify with 2-3 sentences. Do not hedge." | (a) Same prompt as the regular Critic. (b) A separate "Arbitrator" agent. | (a) hedges. (b) duplicates. The suffix is the cheapest way to get a decisive verdict. |
| **CoS's role in conflict** | The CoS picks the `conflict_type` (domain/values/technical) and calls the right resolver. | (a) The Critic always picks the type. (b) A separate "Triage" agent. | The CoS already has the full context of the question. Adding another LLM hop would slow every conflict for no quality gain. |
| **Streaming protocol** | SSE (one-way server → client). | WebSockets (bi-directional). | SSE is simpler, plays well with Vercel/Next.js route handlers, and we don't need client-push during the turn (the conflict-resolution resume is a fresh POST). |
| **Conflict-resolution resume** | New POST `{ kind: "conflict_resolution", conflictId, choice }` resumes the paused turn. | (a) WebSocket bidirectional. (b) Server-Sent Events from server. | (a) adds infra. (b) is more complex than a fresh POST. The current Next.js route can handle the resume with one extra branch. |
| **Mem0 LLM** | DeepSeek V4 Pro (`deepseek-v4-pro`). | (a) `deepseek-chat` (cheaper, less smart). (b) Local Llama. | The user explicitly asked for V4 Pro. (a) is what V1 had. (b) requires a GPU. |
| **Embedding model** | FastEmbed `BAAI/bge-small-en-v1.5` (384-dim, local CPU). | OpenAI `text-embedding-3-small`. | Free, fast, no API cost. We chose this in V1 and the user agreed. |
| **Vector store** | Qdrant (self-hosted, multi-arch docker image). | pgvector. | Qdrant has better HNSW tuning. We chose this in V1. |
| **Document RAG** | Raw Qdrant collection (`documents`), separate from Mem0. | Mem0 for everything. | Different retrieval semantics. RAG wants chunk-level, Mem0 wants fact-level. |
| **Tavily (web search)** | Free tier, 1000 searches/month. | (a) Serper. (b) Bing. | Tavily has the best free tier and returns clean Markdown. |
| **Single-user, no auth** | PocketBase admin is exposed (self-signed cert) but no user-level auth. | Cloudflare Access in front of everything. | V1 decision; the user agreed. A single password is in §12.2 T2.1. |
| **Hosting** | Oracle Cloud Free Tier ARM A1, new VCN, new instance, full isolation from the user's other project. | Hetzner / DigitalOcean / fly.io. | V1 decision. Oracle's free tier is genuinely free; the others are $5-10/mo. |

---

## 14. Open questions for the user

I made a few choices to keep the plan shippable. Flag any you want to change:

- **Per-agent reasoning mode**: I picked Non-Think for utility + life specialists, Think High for CoS + C-suite, Think Max for the Critic. Reasoning mode costs ~2-4× the tokens. If you want a flatter "Think High everywhere" or steeper "Think Max for CoS and C-suite", say so.
- **Global facts auto-promotion**: I let the Memory agent decide what to promote. Alternative: only the CoS can promote. The Memory agent just proposes candidates, CoS approves. More controlled, more prompts.
- **A2A loop guard**: default max depth 3, max consults per turn 4. If you have long chains (e.g. CMO → CTO → CSO → CFO → CTO), bump these.
- **`consult_agent` cost**: each consult is an extra LLM round-trip. A 4-consult turn with V4 Pro is roughly 5× a baseline turn in tokens. If cost matters more than depth, we can collapse some A2A flows back to "CoS relays the question" (V1 style).
- **Tavily**: still the default. Alternatives: Serper (Google SERP) or Bing.
- **`node:vm` vs `isolated-vm`**: `node:vm` is built-in but has weaker memory caps. If a user tries to OOM the worker, V8 will kill the whole Next.js process. `isolated-vm` (~30 MB native dep) gives true per-call caps. Default to `node:vm`; switch to `isolated-vm` if we hit any crashes.
- **`run_code` defaults**: 5 s timeout, 128 MB `--max-old-space-size` on the Next process. Bump these if specialists need longer runs (CFO scenario sims).
- **Conflict strategy rubric**: I gave the CoS a 4-bucket rubric for picking `conflict_type`. If it picks `values_tradeoff` too often (annoying) or `technical_factual` too rarely (slow), we adjust the CoS prompt.
- **Critic arbitration prompt**: a short suffix "Pick a winner. Justify with 2-3 sentences. Do not hedge." If the Critic still hedges, we make the prompt more aggressive or fall back to a hard-coded "if no clear winner, escalate to user".
- **Tier 1 priorities for v1.1**: see section 12.4. My pick is error handling + rate limiting first, then a 10-20 question eval harness, then cost observability. Want me to bake those into the next iteration?
- **Therapist scope**: still non-clinical with 988 redirect.

---

## 15. Verification (V2 — 6 smoke tests)

The V1 plan had "send a message, get a TLDR". V2 covers all six new features:

| Test | How to verify | Pass criteria |
|---|---|---|
| **Cross-conversation memory** | In conv A: "remember that my dog's name is Rex." Switch to conv B: "what's my dog's name?" | Conv B's CoS surfaces "Rex" from the global or user-scoped memory pool. |
| **Persistent state** | In conv A, turn 1: "I'm choosing between Postgres and MongoDB for the new app." Turn 5 (in same conv): "what were we discussing?" | CoS's `agent_state.current_focus` is "Postgres vs MongoDB for the new app" and gets surfaced verbatim. |
| **Agent-to-agent messaging** | "I'm thinking of building a new fintech app and putting it on a public S3 bucket — should I?" | Team panel shows CTO → CSO. CSO's reply mentions threat model, not just generic security. CoS's answer cites both. |
| **V4 Pro** | `curl -s $DEEPSEEK_BASE_URL/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY" \| jq` | `deepseek-v4-pro` is in the model list. Inspect chat logs: every `chat.completions.create` call uses `model: "deepseek-v4-pro"`. |
| **Reasoning mode** | Ask the CoS a hard, multi-step question. Then ask the Critic to review it. | Token counts differ by ~2-4× between Think High and Think Max. Logs show `extra_body: { thinking: { type: "enabled" } }, reasoning_effort: "max"` for the Critic. |
| **Code execution** | "If I invest $10k at 7% for 30 years, what's it worth?" | Team panel shows "CFO ran: `Math.pow(1.07, 30) * 10000`" → output `76122.55…`. No `require` / `process` / `fetch` access. A snippet with `while(true){}` is killed in ≤5 s. |
| **Conflict resolution** | "Should I deploy on Friday at 5pm or Monday at 9am?" (or any question where CTO and CFO disagree) | Team panel shows a `conflict` event + a `ConflictCard` with the two options. User picks one. CoS resumes the turn and writes the final answer citing the chosen option. |
| **Critic arbitration** | Force a technical factual dispute: ask a question that triggers CTO and CSO to disagree on a number. | Team panel shows `conflict_resolved` with `Critic arbitrated: …`. Logs show the Critic was invoked with the arbitration prompt suffix. |

End state: a real team of 12+ agents, one Chief of Staff on the front line, V4 Pro for every brain, with shared memory, working state, a chat channel between specialists, runnable code, and a deterministic way to resolve disagreements.

---

## 16. PocketBase schemas (copy-paste ready)

Two new collections. Add these to [memory-service/scripts/pb_bootstrap.py](file:///workspace/superhuman-va/memory-service/scripts/pb_bootstrap.py) (the file already creates `conversations` and `messages`). The bootstrap script is idempotent — re-running is safe.

### 16.1 `agent_state`

Per-conversation working memory for one agent. Unique per (conv, agent).

```python
AGENT_STATE_SCHEMA = {
    "name": "agent_state",
    "type": "base",
    "schema": [
        {
            "name": "conversation_id",
            "type": "relation",
            "required": True,
            "options": {
                "collectionId": "__CONVERSATIONS_ID__",  # filled at runtime
                "cascadeDelete": True,
                "maxSelect": 1,
            },
        },
        {"name": "agent_name", "type": "text", "required": True, "options": {"min": 1, "max": 64}},
        {"name": "state_json", "type": "json", "required": True, "options": {"maxSize": 65535}},
    ],
    "indexes": [
        "CREATE INDEX idx_state_conv ON agent_state (conversation_id)",
        "CREATE UNIQUE INDEX idx_state_conv_agent ON agent_state (conversation_id, agent_name)",
    ],
    "listRule": "",
    "viewRule": "",
    "createRule": "",
    "updateRule": "",
    "deleteRule": "",
}
```

**Canonical state shape (CoS, see §1.4.2):**

```ts
type CosState = {
  current_focus: string | null;
  open_questions: string[];
  recent_specialist_outputs: { agent: string; summary: string; turn: number }[];
  user_preferences_this_session: Record<string, string>;
  turn_count: number;
};
```

### 16.2 `agent_messages`

Every specialist-to-specialist consult, plus Critic arbitrations, plus the conflict-resolution records.

```python
AGENT_MESSAGES_SCHEMA = {
    "name": "agent_messages",
    "type": "base",
    "schema": [
        {
            "name": "conversation_id",
            "type": "relation",
            "required": True,
            "options": {
                "collectionId": "__CONVERSATIONS_ID__",
                "cascadeDelete": True,
                "maxSelect": 1,
            },
        },
        {"name": "turn_id", "type": "text", "required": True, "options": {"min": 1, "max": 64}},
        {"name": "from_agent", "type": "text", "required": True, "options": {"min": 1, "max": 64}},
        {"name": "to_agent", "type": "text", "required": True, "options": {"min": 1, "max": 64}},
        {"name": "message", "type": "text", "required": True, "options": {"max": 20000}},
        {"name": "reply", "type": "text", "required": False, "options": {"max": 20000}},
        {
            "name": "status",
            "type": "select",
            "required": True,
            "options": {"maxSelect": 1, "values": ["pending", "replied", "errored"]},
        },
    ],
    "indexes": [
        "CREATE INDEX idx_msg_conv ON agent_messages (conversation_id)",
        "CREATE INDEX idx_msg_turn ON agent_messages (turn_id)",
    ],
    "listRule": "",
    "viewRule": "",
    "createRule": "",
    "updateRule": "",
    "deleteRule": "",
}
```

**Reserved `to_agent` values:**

| Value | Meaning |
|---|---|
| `CoS`, `CTO`, `CFO`, `CMO`, `CSO`, `Critic`, `Memory`, `Document`, `Researcher`, `Planner`, `ADHD`, `Fitness`, `Therapist` | The actual agent. |
| `__conflict__` | A conflict-resolution event. The `message` field is the question; `reply` is the resolution (CoS ruling / Critic verdict / user pick). |
| `__user__` | A message addressed to the user (synthetic, for the Team Panel timeline). |

---

## 17. Worked example — one full turn

So everyone agrees on what the system does end-to-end. The user types: **"I'm thinking of putting my new fintech app's database on a public S3 bucket so I can share query results with my co-founder. Should I?"**

### 17.1 Server-side flow

1. **chat/route.ts** receives `{ message, conversationId, userId }`. Creates/upserts a `conversations` row. Generates a `turn_id` (ULID).
2. **Parallel context load**:
   - Load last 10 messages from `messages` collection (PB).
   - Load CoS's `agent_state` row for this conversation.
   - Call Mem0 `listGlobalMemories(userId)` → returns 12 facts (user is a backend engineer at a fintech, user has ADHD, user is in Toronto, etc.).
   - Call Qdrant `search_documents(user_id, query)` → returns 3 document excerpts (one is an internal "Data Classification Policy" PDF the user uploaded last week).
3. **Build CoS input** (see §3.3 for the full template):
   ```
   [system: CoS prompt with global facts and working memory injected]
   [user: last 5 turns of history]
   [user: current message]
   ```
4. **Run the swarm**:
   - `runner.runStreamed(coS, input, { context: { conversationId, userId, turnId, reasoning: "think_high" } })`
   - The CoS decides this is a security question → calls `consult_specialist("CTO")` AND `consult_specialist("CSO")` in parallel.
   - The CTO's turn: CTO reads the conversation, calls `consult_agent("CSO", "the user is asking about putting their fintech DB on public S3. Threat model please.")`. CTO also calls `compute("0.05 * 1000000")` to estimate breach cost.
   - The CSO's turn: CSO reads the conversation, calls `search_documents(...)` to find the Data Classification Policy. Calls `run_code` to demonstrate a public-S3 enumeration script (sandboxed). Writes a threat model.
   - Both replies land back at the CoS. The CoS detects disagreement (CTO says "technically possible but bad"; CSO says "block immediately, PCI-DSS violation") and decides this is a `technical_factual` conflict → calls `resolve_conflict({ conflict_type: "technical_factual", ... })`.
   - The `resolve_conflict` tool invokes the Critic with the arbitration prompt suffix. The Critic arbitrates: "CSO is right. PCI-DSS §3.4 prohibits public exposure of cardholder data environments, and S3 buckets have a documented history of accidental public access. CTO's technical feasibility is moot." (`reasoning_effort: "max"`, `extra_body: { thinking: { type: "enabled" } }`.)
   - The CoS writes the final answer:
     ```
     ## TL;DR
     No. Putting a fintech database on a public S3 bucket is a PCI-DSS violation and a near-certain breach.

     ## Recommendation
     Use a private S3 bucket with bucket-owner-only access. If your co-founder needs query results, give them an IAM role or share a signed URL with a 24-hour expiry.

     ## Details
     (per CSO, confirmed by CTO, arbitrated by Critic) ...
     [1,400 words of detail, a Mermaid diagram of the recommended architecture, a table comparing the three options]
     ```
5. **Stream to the browser** as SSE events: `meta`, `token` × N, `tool_start` × 4, `tool_done` × 4, `agent_message` × 2 (CTO↔CSO), `conflict_resolved` (Critic), `done`.
6. **Post-stream**:
   - Persist `user` and `assistant` messages to `messages` collection.
   - Persist CoS's `agent_state` (last write wins). The new state has `current_focus = "Decided: private S3 + IAM role for co-founder"`, `open_questions = []`, `recent_specialist_outputs` updated.
   - Persist the two `agent_messages` rows (CTO→CSO, plus the conflict record).
   - Fire-and-forget `memoryClient.addMemory(userId, [user_msg, assistant_msg])` for cross-conversation fact extraction.

### 17.2 Browser-side render

- The chat bubble fills with the streamed CoS answer, token by token.
- The Team Panel (right drawer) animates in this order:
  1. 🟦 "CoS consulted: CTO, CSO"
  2. 🟦 "CTO ran: `0.05 * 1000000` → 50000"
  3. 🟦 "CTO → CSO: the user is asking about putting their fintech DB on public S3. Threat model please."
  4. 🟦 "CSO ran: `for (const b of buckets) console.log(b.name)` → ['company-prod-2024', 'company-q1-backup', …]"
  5. 🟦 "CSO: PCI-DSS §3.4 prohibits …"
  6. 🟥 "Conflict detected (technical_factual)"
  7. 🟦 "Critic arbitrated: CSO is right. PCI-DSS §3.4 …"
  8. 🟩 "CoS: streaming final answer…"
- The assistant bubble shows the final structured answer with the Mermaid diagram and the table.

### 17.3 What the user sees (TL;DR of the TL;DR)

A coherent, decisive, multi-source answer ("No, don't. Here's why, and here's what to do instead.") with a visible audit trail of who said what. The user can hover any Team Panel event to see the full text of the specialist's output. If they disagree with the resolution, they can re-engage: "I still think the S3 approach is fine because X" — and the CoS's `agent_state` carries the context forward.

This is the day-1 demo. The full team (C-suite + life specialists + Researcher + Planner + Critic) is wired the same way; each gets added by dropping a new file into `specialists/`.

---

## 18. Performance targets & SLOs

Quantitative bars for "the swarm is working". We measure these from day 1 and ship a small dashboard widget (§12.2 T2.2).

| Metric | Target | How we measure |
|---|---|---|
| **Time to first token** (TTFT) | < 1.5 s p50, < 3 s p95 | Server log: `Date.now() - req.received` at the first SSE `token` event. |
| **Tokens / second** (throughput) | > 30 t/s p50 for Non-Think, > 15 t/s p50 for Think Max | Server log: `tokens / (last_token_at - first_token_at)`. |
| **End-to-end turn latency** (small question, no specialists) | < 4 s p50, < 8 s p95 | Same as TTFT + token time. |
| **End-to-end turn latency** (1 specialist + 1 A2A hop) | < 12 s p50, < 25 s p95 | Server log: `req.received → done` for a 2-agent turn. |
| **End-to-end turn latency** (3 specialists + 2 A2A hops + Critic arbitration) | < 35 s p50, < 70 s p95 | Same. |
| **Tokens per turn** (median over 50 random turns) | < 8k input + 1.5k output | Aggregated from V4 Pro usage headers + our own counter. |
| **Cost per turn** (median) | < $0.04 | V4 Pro pricing: $1.74/1M input, $0.55/1M output (May 2026). 8k input + 1.5k output ≈ $0.015. Headroom for specialists. |
| **Daily cost** (target workload) | < $1.50 | 50 turns/day × $0.04 + occasional Think Max + Tavily (free tier 1k/mo). |
| **Specialist consults per turn** (median) | 1.2 | `agent_messages` count per turn. Cap is 4 (see §1.4.3). |
| **`run_code` calls per turn** (median) | 0.4 | Server log. Cap is 3 (see §1.4.5). |
| **Cross-conversation memory hit rate** | > 30% | `Mem0.search` returns ≥1 result for > 30% of turns. |
| **State persistence hit rate** | > 80% | For any turn ≥ 2 in a conversation, `agent_state` was loaded with non-empty content. |
| **Crash rate** | < 0.1% of turns | Server log: unhandled exceptions in `chat/route.ts` / total turns. |

**Where the budget goes**: V4 Pro input tokens dominate (8k input × $1.74/1M ≈ $0.014/turn). Think Max on the Critic adds ~5k extra tokens per arbitration. The two big levers to control cost are (a) the `max_agent_consults` cap and (b) the small-talk fast path.

**Bottleneck analysis** (for the executor): the swarm is not V4-Pro-bound. It's bound by:
1. **Network round-trip to DeepSeek** (~200 ms RTT to api.deepseek.com from the Oracle cloud in Toronto — could be 1.5 s from a personal laptop). Consider deploying the memory service in the same region as DeepSeek's edge.
2. **`node:vm` startup cost** for `run_code` (~50-100 ms per call). Negligible unless we hit the cap.
3. **PocketBase query latency** for `agent_state`/`agent_messages`. The indexes in §16 keep this sub-10 ms even at 10k rows.

If TTFT p95 is over 5 s after week 1, the culprit is almost certainly network. If tokens/second is below 15, the culprit is V4 Pro Think Max blocking the stream (Think Max streams the CoT and we don't forward it — this is fine but adds latency).
