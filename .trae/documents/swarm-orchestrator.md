# Subagent Swarm — Chief-of-Staff Architecture

## TL;DR

Replace the single DeepSeek call in `chat/route.ts` with a **hub-and-spoke orchestrator**:

```
USER ──► Chief of Staff (CoS) ──► [specialists, as needed]
              │
              └── TLDRs every response
              └── Visualizes (tables, Mermaid, charts)
              └── Recommends a clear next step
```

The user **only ever talks to the CoS**. The CoS delegates to specialist subagents, aggregates their input, and writes the final answer.

**Stack**: OpenAI Agents SDK (TypeScript, runs locally, no OpenAI-hosted runner needed). One small `Model` adapter wraps the existing DeepSeek `OpenAI` client — no new LLM provider.

**Ship order**: framework + 3 core agents (CoS, Memory, Document) → C-suite (CTO, CFO, CMO, CSO) → life specialists (ADHD Coach, Fitness, Therapist) → Researcher + Planner + Critic.

**Files touched**: 2 new dirs, 5 new lib modules, 1 new API route, 1 new UI component, 2 small edits to existing files. ~700 LOC total. No new infrastructure.

---

## 1. Architecture

### 1.1 The team

| Agent | Role | Tools | Always runs? |
|---|---|---|---|
| **Chief of Staff** (CoS) | User-facing orchestrator. TLDRs, visualizes, recommends. | `consult_specialist`, `visualize` | ✅ Every turn |
| **Memory Agent** | Mem0 retrieval + summarization. | `search_memory`, `save_memory` | When context is relevant |
| **Document Agent** | Searches uploaded PDFs/notes in Qdrant. | `search_documents`, `list_documents` | When context is relevant |
| **Researcher** | Live web search. | `web_search` (Tavily) | When current info needed |
| **Planner** | Breaks complex tasks into steps. | `decompose_task` | For multi-step requests |
| **Critic** | Reviews the final answer against the retrieved context. | `flag_issues` | Optional, for high-stakes |
| **CTO** | Architecture, code, tech decisions. | `code_search`, `explain_code` | For tech questions |
| **CFO** | Finance, budget, ROI, runway. | `compute_roi`, `forecast` | For finance questions |
| **CMO** | Marketing, growth, brand, positioning. | `generate_copy`, `audit_message` | For marketing questions |
| **CSO** | Security, compliance, risk, threat modeling. | `risk_assess` | For security questions |
| **ADHD Coach** | Productivity, focus, planning around distractibility. | — | When user signals overwhelm |
| **Fitness Coach** | Exercise programming, nutrition, recovery. | `log_workout` (future) | For health questions |
| **Therapist** | Active listening, reflection, CBT-lite. | — | When user signals distress |

Adding a new agent = one file in `lib/agents/` + one line in the registry.

### 1.2 Message flow (one turn)

```
1. User sends message
2. CoS receives the message
3. CoS picks 0..N specialists to consult (parallel where possible)
   - Memory + Document always run in parallel for context
   - Specialists are called based on CoS's read of the question
4. CoS drafts a TLDR + structured answer that weaves in specialist input
5. (Optional) Critic reviews and CoS revises
6. CoS streams the final answer to the browser
7. (After stream) save the conversation + fire-and-forget Mem0 add
```

### 1.3 UI

- **Main chat** — unchanged, same `ChatWindow` + `ChatInput`
- **Team panel** (new, right drawer) — shows live activity:
  - "CoS consulted: Memory, Document, CTO"
  - "CTO: ...3 lines..."
  - "Memory: ...2 lines..."
  - "CoS: final answer streaming..."
- The team panel is fed by typed events from the OpenAI Agents SDK stream: `run_item_stream_event` (tool calls, tool results, message outputs).

---

## 2. Framework setup

### 2.1 Add the OpenAI Agents SDK

**Edit** [next-app/package.json](file:///workspace/superhuman-va/next-app/package.json):

```diff
   "dependencies": {
+    "@openai/agents": "^0.1.0",
     ...
   }
```

(Pin to a real version once you confirm the latest release; the API has been stable since the v0.x line in late 2024.)

### 2.2 DeepSeek model adapter

The SDK is provider-agnostic via the `Model` interface. We just wrap our existing DeepSeek client.

**New file**: [next-app/lib/agents/model.ts](file:///workspace/superhuman-va/next-app/lib/agents/model.ts)

```ts
// Adapter that lets the OpenAI Agents SDK use our existing DeepSeek client.
import { Agent, Runner, setDefaultModel, type Model } from "@openai/agents";
import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
});

export const deepseekModel: Model = {
  // The SDK calls this with an OpenAI-shaped request. We forward verbatim
  // to DeepSeek. DeepSeek's OpenAI-compat surface supports everything
  // the SDK uses: chat.completions, tool_calls, streaming, function
  // calling.
  async getResponse(messages, options) { /* ... */ },
  async *streamResponse(messages, options) { /* ... */ },
};

export { Agent, Runner, setDefaultModel };
```

(Full implementation is ~80 lines: translate `AgentInputItem[]` → `OpenAI.ChatCompletionMessageParam[]`, forward to `deepseek.chat.completions.create({stream: true})`, yield `ModelResponse` chunks that match the SDK's expected event shape.)

### 2.3 Tool definition convention

The SDK defines tools as Zod schemas + async handlers. We centralise tool factories so specialists just import what they need.

**New file**: [next-app/lib/agents/tools/index.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/index.ts) — re-exports `mem0Tools`, `qdrantTools`, `webSearchTool`, `visualizeTool`.

**New file**: [next-app/lib/agents/tools/mem0.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/mem0.ts) — wraps `memoryClient.searchMemory` / `addMemory` / `listMemories` / `clearMemories` as a `Tool` array.

**New file**: [next-app/lib/agents/tools/qdrant.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/qdrant.ts) — wraps `memoryClient.searchDocuments` / `listDocuments`.

**New file**: [next-app/lib/agents/tools/web-search.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/web-search.ts) — uses **Tavily** (free tier: 1000 searches/month) via the `tavily` SDK. New env var `TAVILY_API_KEY`.

**New file**: [next-app/lib/agents/tools/visualize.ts](file:///workspace/superhuman-va/next-app/lib/agents/tools/visualize.ts) — single tool `render_visual` that takes a payload `{type: "table"|"mermaid"|"bullets", data: ...}` and returns the rendered Markdown/Mermaid string for the CoS to embed in its answer.

---

## 3. Specialist agents

### 3.1 The pattern

Every specialist is a single file in [next-app/lib/agents/specialists/](file:///workspace/superhuman-va/next-app/lib/agents/specialists/) with the same shape:

```ts
// cto.ts
import { Agent } from "@openai/agents";

export const ctoAgent = new Agent({
  name: "CTO",
  instructions: `You are the CTO on the user's advisory team.
You advise on architecture, technology choices, code review, and engineering trade-offs.
You are decisive. You give concrete recommendations with one-paragraph reasoning.
You never hedge with "it depends" without explaining what it depends on.`,
  tools: [/* codeExplainTool, etc. */],
  model: "deepseek-chat",  // the SDK uses our default model
});

export const ctoHandoff = ctoAgent.asHandoffTool({
  toolName: "consult_cto",
  toolDescription: "Consult the CTO for architecture, code, or technical decisions.",
});
```

### 3.2 Files to create

| File | Agent | Tools |
|---|---|---|
| `chief-of-staff.ts` | **CoS** (the orchestrator) | `consult_specialist` (handoff to all), `visualize` |
| `memory-agent.ts` | Memory specialist | `mem0.search`, `mem0.add` |
| `document-agent.ts` | Document specialist | `qdrant.search`, `qdrant.list` |
| `researcher.ts` | Web search | `tavily.search` |
| `planner.ts` | Task decomposer | `decompose` |
| `critic.ts` | Reviewer | `flag_issues` |
| `cto.ts` | CTO | (none for MVP) |
| `cfo.ts` | CFO | `compute` (simple math) |
| `cmo.ts` | CMO | `generate_copy` |
| `cso.ts` | CSO | (none for MVP) |
| `adhd-coach.ts` | ADHD coach | (none) |
| `fitness-coach.ts` | Fitness coach | (none) |
| `therapist.ts` | Therapist | (none) |
| `registry.ts` | Maps agent name → handoff tool | — |

### 3.3 The CoS prompt (most important)

```text
You are the user's Chief of Staff and their only point of contact.

You are NOT a knowledge base. You never answer from your own training.
You consult the right specialist(s) on the team, then write a TLDR + a
structured answer for the user.

Every response must follow this format:

## TL;DR
[2-3 sentences max. The single most important takeaway.]

## Recommendation
[The concrete next action the user should take.]

## Details
[Bullet points or short sections. Pull in specialist output here.
 Cite which specialist said what, e.g. "(per CTO)".]

## Visual
[Optional. A small table, Mermaid diagram, or numbered list — when
 the answer benefits from structure.]

You can consult multiple specialists in parallel. You don't have to
consult any if the message is small talk ("hi", "thanks", "lol").

Match the user's tone. If they're stressed, be brief and warm.
If they're asking for a deep dive, be thorough.
```

This prompt is what makes the CoS feel like a real chief of staff, not a router.

### 3.4 Specialist prompts (sketch)

**CTO**
> You are the CTO. Architecture, code, technical decisions. Be decisive. Give one recommendation, with reasoning. Use code blocks for any snippets. You are not a teacher; you are a peer.

**CFO**
> You are the CFO. Finance, budgeting, ROI, runway, unit economics. Be quantitatively precise. If you don't have numbers, say so — never make them up. Use tables when comparing options.

**CMO**
> You are the CMO. Marketing, growth, brand, positioning, copywriting. Speak in terms of funnels, conversion, positioning. When writing copy, write it in the user's voice (ask if you don't know it).

**CSO**
> You are the CSO. Security, compliance, risk. Think in threat models. Always identify the worst case first, then the mitigation, then the residual risk.

**ADHD Coach**
> You are an ADHD coach. You help the user break tasks into the smallest possible next step, time-box things, and lower the activation energy. You never say "just focus". You suggest environment changes, body doubling, timers, and reward pairing.

**Fitness Coach**
> You are a fitness coach. You give evidence-based advice on training, recovery, and nutrition. You ask about the user's current level before prescribing. You never recommend extreme protocols.

**Therapist**
> You are a thoughtful, warm, non-clinical therapist. You use reflective listening. You help the user name what they feel. You do not diagnose. If the user expresses self-harm ideation or acute crisis, you name that you are not a crisis resource and suggest 988 (US) or the equivalent in their country.

(Mem0 / Document / Researcher / Planner / Critic are utility specialists — they have shorter, more tactical prompts focused on tool use.)

---

## 4. The chat route

### 4.1 Strategy

Keep the existing `chat/route.ts` for backward compat. Add a new `chat-swarm/route.ts` that uses the CoS. The frontend picks which one to call based on a `?swarm=true` query param (or always-on as the user wants).

**Simpler**: just replace the body of `chat/route.ts` to use the CoS. The old single-call path is gone.

### 4.2 New route: [next-app/app/api/chat/route.ts](file:///workspace/superhuman-va/next-app/app/api/chat/route.ts) (rewritten)

```ts
import { Runner, Agent, type RunContext } from "@openai/agents";
import { chiefOfStaff } from "@/lib/agents/specialists/chief-of-staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body.message?.trim();
  if (!message) return new Response("Empty", { status: 400 });

  // Build the input: [system (CoS prompt), ...history, user]
  const input = await buildInputFromPB(body.conversationId, message);

  const runner = new Runner({ model: deepseekModel });
  const stream = await runner.runStreamed(chiefOfStaff, input, {
    context: { userId: body.userId ?? USER_ID },
  });

  // Translate the OpenAI Agents SDK stream into our SSE format
  return new Response(translateToSSE(stream), {
    headers: { "Content-Type": "text/event-stream", ... },
  });
}
```

The translator emits:

| SDK event | SSE type | Client effect |
|---|---|---|
| `raw_model_stream_event` (text delta) | `token` | Append to assistant bubble |
| `run_item_stream_event` (tool_call) | `tool_start` | Add to TeamPanel "started: CTO" |
| `run_item_stream_event` (tool_result) | `tool_done` | Add specialist's output to TeamPanel |
| `agent_updated_stream_event` (handoff) | `handoff` | TeamPanel shows specialist took over |
| final message | `done` | Close stream |

### 4.3 Parallel consultation

The CoS sometimes wants to consult Memory + Document + Researcher all at once. The OpenAI Agents SDK's `runStreamed` handles this natively — when the CoS emits multiple tool calls in one turn, the Runner executes them in parallel automatically.

---

## 5. UI: Team Panel

### 5.1 New component

**New file**: [next-app/components/team-panel.tsx](file:///workspace/superhuman-va/next-app/components/team-panel.tsx)

```tsx
"use client";
// Shows live agent activity: which specialist was consulted, their
// intermediate output, the CoS's final synthesis.
interface TeamEvent {
  type: "tool_start" | "tool_done" | "handoff";
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

### 5.2 Wire into [next-app/app/chat/page.tsx](file:///workspace/superhuman-va/next-app/app/chat/page.tsx)

Add a `teamEvents` state that the SSE consumer fills. Render the panel as a right-side drawer (toggle in the header, like the existing Memory / Documents dialogs).

---

## 6. Env & config

### 6.1 Edit [next-app/.env.local.example](file:///workspace/superhuman-va/next-app/.env.local.example)

```diff
+# ── Researcher (Tavily web search) ───────────────────
+# Free tier: 1000 searches/month. Get a key at https://tavily.com
+TAVILY_API_KEY=tvly-replace-me
```

### 6.2 Memory service: no changes

The memory service already exposes `searchMemory`, `searchDocuments`, `addMemory` — exactly what the agent tools wrap. No FastAPI changes.

### 6.3 docker-compose: no changes

`next-app` env gets `TAVILY_API_KEY`; everything else stays.

---

## 7. Streaming performance & cost controls

### 7.1 Parallel specialist calls

The OpenAI Agents SDK runs multiple tool calls in parallel by default. A turn that consults Memory + Document + CTO finishes in roughly 1 round-trip + 1 final synthesis (≈ 2-3 seconds with DeepSeek).

### 7.2 Don't always run Memory + Document

The CoS prompt guides it to skip retrieval for small talk. But we can also enforce a fast path in code:

```ts
const isSmallTalk = /^(hi|hey|thanks|thank you|ok|okay|lol|haha|👍|🙏|bye)[\s!.]*$/i.test(message);
if (isSmallTalk) {
  // Skip the swarm, use a tiny fast-path agent
  return runFastPath(message);
}
```

The fast-path agent has no tools, just answers conversationally. Skips 2-3 LLM calls.

### 7.3 Critic is opt-in

Critic doubles the cost of a turn. Only run it for high-stakes queries:

```ts
const isHighStakes = /(legal|medical|finance|tax|delete|deploy|migrate)/i.test(message);
if (isHighStakes) /* run critic */;
```

Make this a per-turn override (UI toggle) and a heuristic.

### 7.4 Cache specialist results

If the user asks the same question twice in a session, return the cached specialist output. Use a simple in-memory `Map<conversationId+queryHash, result>` with a 5-minute TTL. ~30 lines.

---

## 8. Adding a new agent (the easy part)

After the framework is in place, adding a new specialist is a 3-step recipe:

1. **Create** `lib/agents/specialists/<name>.ts` with the agent definition + handoff tool.
2. **Register** in `lib/agents/specialists/registry.ts`:
   ```ts
   import { chefAgent, chefHandoff } from "./chef";
   export const handoffs = [ctoHandoff, cfoHandoff, ..., chefHandoff];
   ```
3. **Update** the CoS prompt to mention the new agent by name.

That's it. The CoS will start routing relevant questions to it.

---

## 9. File-by-file deliverable summary

**New files (11):**

| File | Purpose |
|---|---|
| `next-app/lib/agents/model.ts` | DeepSeek model adapter for the SDK |
| `next-app/lib/agents/tools/index.ts` | Tool re-exports |
| `next-app/lib/agents/tools/mem0.ts` | Mem0 search/add/list tools |
| `next-app/lib/agents/tools/qdrant.ts` | Qdrant search/list tools |
| `next-app/lib/agents/tools/web-search.ts` | Tavily web search tool |
| `next-app/lib/agents/tools/visualize.ts` | Mermaid/table rendering tool |
| `next-app/lib/agents/specialists/chief-of-staff.ts` | The CoS agent |
| `next-app/lib/agents/specialists/memory-agent.ts` | Memory specialist |
| `next-app/lib/agents/specialists/document-agent.ts` | Document specialist |
| `next-app/lib/agents/specialists/researcher.ts` | Web researcher |
| `next-app/lib/agents/specialists/planner.ts` | Task planner |
| `next-app/lib/agents/specialists/critic.ts` | Reviewer |
| `next-app/lib/agents/specialists/cto.ts` | CTO |
| `next-app/lib/agents/specialists/cfo.ts` | CFO |
| `next-app/lib/agents/specialists/cmo.ts` | CMO |
| `next-app/lib/agents/specialists/cso.ts` | CSO |
| `next-app/lib/agents/specialists/adhd-coach.ts` | ADHD coach |
| `next-app/lib/agents/specialists/fitness-coach.ts` | Fitness coach |
| `next-app/lib/agents/specialists/therapist.ts` | Therapist |
| `next-app/lib/agents/specialists/registry.ts` | Agent → handoff tool registry |
| `next-app/components/team-panel.tsx` | Live activity UI |

**Edited files (3):**

| File | Change |
|---|---|
| `next-app/package.json` | Add `@openai/agents` + `tavily` |
| `next-app/.env.local.example` | Add `TAVILY_API_KEY` |
| `next-app/app/api/chat/route.ts` | Rewrite to use CoS agent |
| `next-app/app/chat/page.tsx` | Add Team Panel drawer + SSE event handling |

**No changes** to: `memory-service/`, `docker-compose.yml`, `caddy/`, `next-app/Dockerfile`, anything in `next-app/components/ui/`, or the shadcn primitives.

Total: ~21 new files, 4 edits, ~700 LOC. Achievable in a focused session.

---

## 10. Ship order (one branch at a time)

| Step | Scope | Est. effort |
|---|---|---|
| 1 | Install SDK + DeepSeek adapter + run a "hello world" agent locally | 30 min |
| 2 | Tool layer: mem0 + qdrant + visualize (no Tavily yet) | 1 h |
| 3 | CoS + Memory + Document agents, wire into `chat/route.ts` | 2 h |
| 4 | Team Panel UI with live activity | 1 h |
| 5 | C-suite (CTO/CFO/CMO/CSO) — 4 files, copy-paste-modify | 1 h |
| 6 | Life specialists (ADHD/Fitness/Therapist) — 3 files | 1 h |
| 7 | Tavily + Researcher agent | 30 min |
| 8 | Planner + Critic (with cost-control heuristics) | 1 h |
| 9 | Performance pass: small-talk fast path, result cache, parallel tweaks | 1 h |

End state: a real team of 12+ agents, one Chief of Staff on the front line, TLDR + visualize + recommend on every response.

---

## 11. What this plan does NOT include

- ❌ Multi-user auth (still single-user)
- ❌ Cross-conversation memory sharing (each conversation is independent)
- ❌ Persistent agent state across turns (each turn is fresh — the CoS is stateless; specialists have no memory of past turns except via Mem0)
- ❌ Tool-use for code execution (CTO can recommend code, but can't run it in v1)
- ❌ Voice input/output
- ❌ Agent-to-agent messaging (specialists can't talk to each other — only through the CoS)
- ❌ Per-agent model selection (all use `deepseek-chat`; could route Critic to `deepseek-reasoner` for higher quality)

Each of these is a follow-up. None blocks the demo.

---

## 12. Open questions for the user

I made a few assumptions to keep the plan shippable. Flag any you want to change:

- **Web search provider**: I picked **Tavily** (free tier 1000/mo, agent-optimized). Alternatives: **Serper** (Google SERP, $50/mo for 50k) or **Bing Web Search** (Azure, free tier 1000/mo). Tavily is the best default for an LLM agent.
- **Critic model**: I default all agents to `deepseek-chat`. The Critic could use `deepseek-reasoner` for sharper review at higher latency.
- **CFO/CTO tools**: I gave them no real tools in v1 — they're advisory only. If you want the CFO to actually compute things, I'd add a `node:vm`-sandboxed code execution tool. Adds ~80 LOC and a real risk surface.
- **Therapist scope**: I made it non-clinical, with a 988-crisis redirect. If you want clinical-grade, that's a different (regulated) product.

Say the word on any of these and I'll adjust the plan.
