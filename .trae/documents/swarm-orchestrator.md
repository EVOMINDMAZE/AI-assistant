# Subagent Swarm — Chief-of-Staff Architecture (V2)

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
              └── Lets specialists consult each other directly (PB agent_messages)
```

The user **only ever talks to the CoS**. Specialists can also **talk to each other** through a shared, persisted message bus — not just through the CoS.

**Four new requirements, now in scope (this revision):**

| # | Requirement | Mechanism |
|---|---|---|
| 1 | **Cross-conversation memory sharing** | Mem0 is already user-scoped; add a `global_facts` collection + the Memory agent always queries across all conversations. |
| 2 | **Persistent agent state across turns** | New PB `agent_state` collection. CoS and specialists read at turn start, write at turn end. |
| 3 | **Agent-to-agent messaging** | New PB `agent_messages` collection + `consult_agent(name, msg)` tool that any specialist can call. |
| 4 | **DeepSeek V4 Pro for all agents** | `model = "deepseek-v4-pro"` everywhere. Per-agent `thinking` mode (Non-Think / Think High / Think Max). |

**Stack**: OpenAI Agents SDK (TypeScript) + DeepSeek V4 Pro + Tavily + Mem0 + Qdrant + PocketBase.

**Ship order**: framework + DeepSeek V4-Pro adapter → state + messaging infra → CoS + 2 core agents → C-suite → life specialists → Researcher/Planner/Critic.

**Files touched**: 2 new dirs, 7 new lib modules, 1 new API route, 1 new UI component, 1 PB bootstrap change, 2 small env edits. ~950 LOC. No new infrastructure.

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
| **Planner** | Breaks complex tasks into steps. | Think High | `decompose_task` | For multi-step requests |
| **Critic** | Reviews the final answer. | **Think Max** | `flag_issues` | Optional, for high-stakes |
| **CTO** | Architecture, code, tech decisions. | Think High | `consult_agent` (so CTO can ping CSO about risk) | For tech questions |
| **CFO** | Finance, budget, ROI, runway. | Think High | `consult_agent`, `compute_roi` | For finance questions |
| **CMO** | Marketing, growth, brand. | Think High | `consult_agent` | For marketing questions |
| **CSO** | Security, compliance, risk. | Think High | `consult_agent` | For security questions |
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
- **Reasoning mode per agent** is passed as a `thinking` parameter on each `chat.completions.create` call. The model adapter reads it from the `RunContext` (set by chat/route.ts) and forwards it to DeepSeek.
- **The OpenAI Agents SDK's `Agent` constructor doesn't have a built-in `thinking` field** — but our `Model` adapter gets to translate the `AgentInputItem[]` into an OpenAI-shaped request, so we can add `thinking: { mode: "non_think" | "think_high" | "think_max" }` there.
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

The adapter reads `context.reasoning` and translates to DeepSeek's API:

```ts
const completion = await deepseek.chat.completions.create({
  model: MODEL,
  stream: true,
  thinking: { mode: context.reasoning },
  messages,
});
```

(DeepSeek V4 Pro's `thinking` parameter is documented in their OpenAI-compat spec. If their API uses a different name, we adjust the adapter — it's the only file that knows about it.)

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
| `chief-of-staff.ts` | **CoS** | Think High | `consult_specialist` (handoff to all), `consult_agent`, `visualize`, `load_my_state`, `save_my_state`, `list_global_facts` |
| `memory-agent.ts` | Memory | Non-Think | `search_memory`, `search_global_memory`, `add_memory`, `add_global_memory`, `promote_to_global` |
| `document-agent.ts` | Document | Non-Think | `search_documents`, `list_documents` |
| `researcher.ts` | Web | Non-Think | `tavily.search` |
| `planner.ts` | Planner | Think High | `decompose` |
| `critic.ts` | Critic | **Think Max** | `flag_issues` |
| `cto.ts` | CTO | Think High | `consult_agent` |
| `cfo.ts` | CFO | Think High | `consult_agent`, `compute_roi` |
| `cmo.ts` | CMO | Think High | `consult_agent` |
| `cso.ts` | CSO | Think High | `consult_agent` |
| `adhd-coach.ts` | ADHD | Non-Think | — |
| `fitness-coach.ts` | Fitness | Non-Think | — |
| `therapist.ts` | Therapist | Non-Think | — |
| `registry.ts` | — | — | Maps agent name → handoff + reasoning mode |

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
> You are the CTO. Architecture, code, technical decisions. Be decisive. Give one recommendation, with reasoning. Use code blocks. You are not a teacher; you are a peer. **If a question touches security, compliance, or risk, call `consult_agent("CSO", <your question>)` before answering.**

**CFO**
> You are the CFO. Finance, budgeting, ROI, runway, unit economics. Be quantitatively precise. Never make up numbers. Use tables. **For cost-of-engineering questions, call `consult_agent("CTO", <your question>)` first to ground the estimate.**

**CMO**
> You are the CMO. Marketing, growth, brand, positioning. Speak in funnels, conversion, positioning. **For questions about product capabilities or roadmap, call `consult_agent("CTO", <your question>)`.**

**CSO**
> You are the CSO. Security, compliance, risk. Think in threat models. Worst case first, then mitigation, then residual risk. **For financial impact of a security event, call `consult_agent("CFO", <your question>)`.**

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
| `agent_updated_stream_event` (handoff) | `handoff` | TeamPanel shows specialist took over |
| `consult_agent` tool_call | `agent_message` | TeamPanel shows specialist → specialist exchange |
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
| `next-app/lib/state.ts` | PB wrappers for `agent_state` collection |
| `next-app/lib/messaging.ts` | PB wrappers for `agent_messages` collection |
| `next-app/lib/agents/specialists/chief-of-staff.ts` | The CoS agent |
| `next-app/lib/agents/specialists/memory-agent.ts` | Memory specialist (cross-conversation) |
| `next-app/lib/agents/specialists/document-agent.ts` | Document specialist |
| `next-app/lib/agents/specialists/researcher.ts` | Web researcher |
| `next-app/lib/agents/specialists/planner.ts` | Task planner |
| `next-app/lib/agents/specialists/critic.ts` | Reviewer (Think Max) |
| `next-app/lib/agents/specialists/cto.ts` | CTO |
| `next-app/lib/agents/specialists/cfo.ts` | CFO |
| `next-app/lib/agents/specialists/cmo.ts` | CMO |
| `next-app/lib/agents/specialists/cso.ts` | CSO |
| `next-app/lib/agents/specialists/adhd-coach.ts` | ADHD coach |
| `next-app/lib/agents/specialists/fitness-coach.ts` | Fitness coach |
| `next-app/lib/agents/specialists/therapist.ts` | Therapist |
| `next-app/lib/agents/specialists/registry.ts` | Agent → handoff + reasoning-mode registry |
| `next-app/components/team-panel.tsx` | Live activity UI (with A2A events) |
| `memory-service/app/routes/memories.py` (edit) | Add `/add_global_memory`, `/search_global_memory`, `/list_global_memory` |

**Edited files (6):**

| File | Change |
|---|---|
| `next-app/package.json` | Add `@openai/agents` + `tavily` |
| `next-app/.env.local.example` | `DEEPSEEK_MODEL=deepseek-v4-pro` + `TAVILY_API_KEY` |
| `next-app/lib/deepseek.ts` | Default model → `deepseek-v4-pro` |
| `next-app/app/api/chat/route.ts` | Rewrite to use CoS + V2 context load |
| `next-app/app/chat/page.tsx` | Add Team Panel drawer + new SSE event types |
| `memory-service/app/config.py` | Default model → `deepseek-v4-pro` |
| `memory-service/app/qdrant_client.py` | Add `memories_global` collection |
| `memory-service/scripts/pb_bootstrap.py` | Add `agent_state` + `agent_messages` collections |

**No changes** to: `docker-compose.yml`, `caddy/`, `next-app/Dockerfile`, `next-app/components/ui/`, or the shadcn primitives.

Total: ~25 new files, 8 edits, ~950 LOC.

---

## 10. Ship order

| Step | Scope | Why this order |
|---|---|---|
| 1 | Install SDK + DeepSeek V4-Pro adapter + run a "hello world" agent locally | Validates the model adapter and `thinking` mode end-to-end before any other code is written. |
| 2 | `pb_bootstrap.py` adds `agent_state` + `agent_messages` collections; `state.ts` + `messaging.ts` + their PB wrappers | State + messaging are dependencies for every agent. |
| 3 | Mem0 global pool: `memory.py` adds global methods; `qdrant_client.py` adds the collection; `routes/memories.py` adds 3 endpoints; `mem0.ts` tools gain the new methods | Unblocks the Memory agent. |
| 4 | `state.ts` and `consult.ts` tools; `consult_agent` works against a stub target | Validates the A2A bus with one consumer. |
| 5 | CoS + Memory + Document agents, wire into `chat/route.ts` with V2 context load | First end-to-end swarm demo. |
| 6 | Team Panel UI with A2A event rendering | User can see the swarm working. |
| 7 | C-suite (CTO/CFO/CMO/CSO) — 4 files; each gets `consult_agent` for cross-domain | Cross-domain reasoning comes alive. |
| 8 | Life specialists (ADHD/Fitness/Therapist) — 3 files | Warmer, slower conversations. |
| 9 | Tavily + Researcher agent | Adds live info. |
| 10 | Planner + Critic (with cost-control heuristics) | Production-quality pass. |
| 11 | Verification: cross-conversation smoke test, state persistence smoke test, A2A smoke test | Sign-off. |

---

## 11. What this plan does NOT include (V2)

We removed four items from V1's exclusion list (cross-conversation memory, persistent state, agent-to-agent messaging, V4 Pro) — they're all in scope now. The remaining non-goals:

- ❌ Multi-user auth (still single-user)
- ❌ Tool-use for code execution (CTO can recommend code, but can't run it in v1)
- ❌ Voice input/output
- ❌ Per-conversation model selection (all use V4 Pro; reasoning mode is the only dial)
- ❌ A formal eval harness (we have a smoke test, not a regression suite)
- ❌ Conflict resolution when two specialists disagree (CoS picks one based on expertise, no voting)
- ❌ Cost budgets per agent (only a global `max_agent_consults` per turn)

Each of these is a follow-up. None blocks the demo.

---

## 12. Open questions for the user

I made a few choices to keep the plan shippable. Flag any you want to change:

- **Per-agent reasoning mode**: I picked Non-Think for utility + life specialists, Think High for CoS + C-suite, Think Max for the Critic. Reasoning mode costs ~2-4× the tokens. If you want a flatter "Think High everywhere" or steeper "Think Max for CoS and C-suite", say so.
- **Global facts auto-promotion**: I let the Memory agent decide what to promote. Alternative: only the CoS can promote. The Memory agent just proposes candidates, CoS approves. More controlled, more prompts.
- **A2A loop guard**: default max depth 3, max consults per turn 4. If you have long chains (e.g. CMO → CTO → CSO → CFO → CTO), bump these.
- **`consult_agent` cost**: each consult is an extra LLM round-trip. A 4-consult turn with V4 Pro is roughly 5× a baseline turn in tokens. If cost matters more than depth, we can collapse some A2A flows back to "CoS relays the question" (V1 style).
- **Tavily**: still the default. Alternatives: Serper (Google SERP) or Bing.
- **CFO/CTO tools**: still no real code execution. CFO computes via a Zod-validated math tool only.
- **Therapist scope**: still non-clinical with 988 redirect.

---

## 13. Verification (V2 adds 4 new smoke tests)

The V1 plan had "send a message, get a TLDR". V2 adds:

| Test | How to verify | Pass criteria |
|---|---|---|
| **Cross-conversation memory** | In conv A: "remember that my dog's name is Rex." Switch to conv B: "what's my dog's name?" | Conv B's CoS surfaces "Rex" from the global or user-scoped memory pool. |
| **Persistent state** | In conv A, turn 1: "I'm choosing between Postgres and MongoDB for the new app." Turn 5 (in same conv): "what were we discussing?" | CoS's `agent_state.current_focus` is "Postgres vs MongoDB for the new app" and gets surfaced verbatim. |
| **Agent-to-agent messaging** | "I'm thinking of building a new fintech app and putting it on a public S3 bucket — should I?" | Team panel shows CTO → CSO. CSO's reply mentions threat model, not just generic security. CoS's answer cites both. |
| **V4 Pro** | `curl -s $DEEPSEEK_BASE_URL/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY" \| jq` | `deepseek-v4-pro` is in the model list. Inspect chat logs: every `chat.completions.create` call uses `model: "deepseek-v4-pro"`. |
| **Reasoning mode** | Ask the CoS a hard, multi-step question. Then ask the Critic to review it. | Token counts differ by ~2-4× between Think High and Think Max. Logs show `thinking: { mode: "think_max" }` for the Critic. |

End state: a real team of 12+ agents, one Chief of Staff on the front line, V4 Pro for every brain, with shared memory, working state, and a chat channel between specialists.
