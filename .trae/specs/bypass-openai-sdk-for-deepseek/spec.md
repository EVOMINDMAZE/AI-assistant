# Bypass OpenAI Agents SDK Runner — Use DeepSeek Directly

## Why

After `break-cos-registry-cycle` fixed the circular import, the chat
still doesn't produce a real LLM reply. The new error is
`401 Incorrect API key provided: sk-not-u********************-llm`.

**Root cause:** The `@openai/agents` SDK v0.3.x `Runner` ignores the
custom `deepseekModel` adapter passed via `new Runner({ model: deepseekModel })`.
It makes a real LLM call to OpenAI's API, not DeepSeek. The placeholder
`OPENAI_API_KEY` we set in Vercel to pass the preflight check is now
being used for actual calls → 401.

**Why `deepseekModel.getResponse` / `streamResponse` (already in
`lib/agents/model.ts`) don't help:** those methods are correctly
written and DO call DeepSeek. But the Runner intercepts them and
short-circuits to its own OpenAI client. They are unreachable from
`Runner.run()` in this SDK version.

**Why this is a deliberate design choice in the SDK:** the
OpenAI Agents SDK v0.3.x Runner uses OpenAI's native client for
tracing, response parsing, and tool-call orchestration. The custom
Model adapter is only used for the *content generation* step, and
even that is partially bypassed. There is no documented flag to
make Runner use the adapter exclusively.

**Decision:** bypass the `Runner` entirely. We keep using
`@openai/agents` for:
- `Agent` (data class with instructions + tools)
- `tool()` helper (wraps a Zod schema with a name + description)
- `deepseekModel` adapter (the working model wrapper for any
  direct-call paths)

We drop `Runner.run()`. We replace it with a custom
`runAgentDirect()` function in a new file
`next-app/lib/agents/direct-runner.ts` that:
1. Builds the OpenAI-format messages from the agent's
   `instructions` + `input`.
2. Calls DeepSeek's chat completions API directly via the
   `openai` SDK (already imported in `model.ts`).
3. Converts the agent's tools to OpenAI's tool format (requires
   a small Zod-to-JSON-schema helper).
4. Handles the tool-call loop: if the response contains
   `tool_calls`, executes them, appends the results, and
   re-asks the model.
5. Returns the final text + token usage.

This is a focused, low-risk refactor. The DeepSeek adapter is
already proven to work (small-talk path doesn't go through
Runner and the DeepSeek HTTP call works fine; we just need to
put it on the real-message path too).

## What Changes

**Added:**

- `next-app/lib/agents/direct-runner.ts` — new file.
  Exports:
  - `runAgentDirect({ agent, input, ctx, signal }) → { text, usage, toolCalls }`
  - `zodToJsonSchema(schema: z.ZodType<any>) → any` — converts a
    Zod schema to OpenAI's JSON-schema dialect. Handles the
    Zod types used in the project: `z.object`, `z.string`,
    `z.number`, `z.boolean`, `z.enum`, `z.array`, `z.optional`,
    `z.literal`, `z.union`, `z.null`, `z.describe`.
  - `agentToolsToOpenAITools(tools: any[]) → ChatCompletionTool[]` —
    converts the array of `@openai/agents` tool objects to
    OpenAI's `ChatCompletionTool[]` format. Each tool's
    `.parameters` (Zod schema) is converted via
    `zodToJsonSchema`.

**Modified:**

- `next-app/lib/agents/model.ts`
  - Remove `getResponseSync` (replaced by `runAgentDirect`).
  - Keep `deepseekModel` (used elsewhere if needed), `MODEL`,
    `reasoningParams`, `itemsToMessages`, `estimateUsage`.
  - The `OpenAI` client at the top of the file is reused by
    `direct-runner.ts` via a getter export: `export const
    deepseekClient = new OpenAI({...});` (or move the
    construction into `direct-runner.ts` and import from
    `model.ts`).

- `next-app/lib/agents/tools/consult.ts`
  - Remove `import { Runner } from "@openai/agents";`.
  - Replace the `new Runner({ model: deepseekModel });
    runner.run(target, ...)` block with
    `await runAgentDirect({ agent: target, input: message, ctx: {...} })`.
  - Extract the final text from the result and persist via
    `markReplied` / `markErrored` (same as today).

- `next-app/app/api/chat/route.ts`
  - Change the import: `import { runAgentDirect } from
    "@/lib/agents/direct-runner";` instead of `getResponseSync`.
  - Replace the `getResponseSync(agent, input, ctx)` call with
    `runAgentDirect({ agent, input, ctx })`.
  - No other changes (the SSE event emission around the call
    is unchanged).

**Removed:**

- `getResponseSync` from `model.ts` (replaced).

**No changes to:**

- The `Agent` class, the `tool()` helper, the specialist
  registry, the consult tool's *interface* (its `execute`
  signature stays the same), the chat route's wire format, the
  SSE event types, the agent_messages table, the auth flow.

## Impact

- Affected code:
  - **+1 file**: `lib/agents/direct-runner.ts` (~150 lines new)
  - **3 edits** to existing files: `model.ts` (remove
    `getResponseSync`), `consult.ts` (replace Runner), chat
    `route.ts` (replace `getResponseSync` call)
- Affected specs: `break-cos-registry-cycle` (the "New Issue"
  follow-up); this spec closes it.
- No new env vars needed; the `DEEPSEEK_*` env vars already in
  Vercel are used.
- The `OPENAI_API_KEY` placeholder we set during debugging
  becomes harmless (no code path uses it anymore). It can be
  deleted from the Vercel dashboard as cleanup.

## ADDED Requirements

### Requirement: Chat route uses DeepSeek for the main LLM call

`POST /api/chat` SHALL call DeepSeek's chat completions API
directly for the CoS run, via `runAgentDirect()`. The
`@openai/agents` `Runner` SHALL NOT be used anywhere in the
chat request path.

#### Scenario: Real chat message produces a DeepSeek reply
- **WHEN** the user sends "i want you to create a daily schedule
  for me" and the small-talk regex does NOT match
- **THEN** the chat route SHALL return an SSE stream with
  `type: "token"` events containing the DeepSeek model's text
  reply
- **AND** the response SHALL NOT be an `[error]` event
  mentioning `OPENAI_API_KEY`, `401`, or `Runner`

### Requirement: Consult tool uses DeepSeek

The `consult_agent` tool (in `lib/agents/tools/consult.ts`)
SHALL call DeepSeek via `runAgentDirect()` to invoke the
target specialist. It SHALL NOT use the `@openai/agents`
`Runner`.

#### Scenario: CoS delegates to CTO
- **WHEN** CoS calls `consult_agent("CTO", "should I use Redis?")`
- **THEN** the consult tool loads the CTO agent, calls
  `runAgentDirect()` with the CTO agent + the message,
  extracts the final text, persists the reply to
  `agent_messages` via `markReplied()`, and returns the reply
  to the CoS

### Requirement: Tool-call loop is supported

`runAgentDirect` SHALL handle the tool-call loop:
- If the model returns `finish_reason: "tool_calls"` (or
  `tool_calls.length > 0`), execute each tool via
  `tool.execute(args, ctx)`, append the result as a `role:
  "tool"` message, and call the model again.
- Loop up to 8 iterations to prevent infinite loops.
- Return the final text + total token usage when the model
  returns no `tool_calls` (i.e. `finish_reason: "stop"`).

#### Scenario: Specialist needs to call a tool to answer
- **WHEN** the CTO agent's `runAgentDirect` call is made with
  the CTO's `tools` list (e.g. `web_search`, `run_code`,
  `compute`)
- **AND** the model returns a `tool_calls` array with a
  `web_search` invocation
- **THEN** the runner executes the tool, appends the result,
  re-calls the model, and returns the final text after the
  model stops invoking tools

### Requirement: DeepSeek reasoning mode is preserved

`runAgentDirect` SHALL pass `ctx.reasoning` to
`reasoningParams()` and apply the resulting
`extra_body.thinking` and `reasoning_effort` to every
DeepSeek call (including the re-ask calls in the tool loop).

#### Scenario: Non-Think agent is called
- **WHEN** the Memory agent is consulted with
  `ctx.reasoning = "non_think"`
- **THEN** the DeepSeek call includes
  `extra_body: { thinking: { type: "disabled" } }` and does
  NOT include `reasoning_effort`

### Requirement: Token usage is reported

`runAgentDirect` SHALL accumulate `prompt_tokens`,
`completion_tokens`, and `reasoning_tokens` across all
iterations of the tool loop and return them in the
`usage` field. The chat route SHALL write them to the
`cost_traces` table (or wherever the current code writes
cost data — verify against the existing
`commitTurn` helper).

#### Scenario: Multi-tool-call run
- **WHEN** a specialist makes 3 tool calls and the model
  produces 200 output tokens
- **THEN** `usage.output` is the sum of `completion_tokens`
  across all 4 model calls, and `usage.input` is the sum of
  `prompt_tokens` across all 4 calls
- **AND** the cost trace for this turn is recorded with
  the aggregated totals

## MODIFIED Requirements

### Requirement: Auth (from `migrate-vercel-supabase` AU-1)

No change. The auth flow (session cookie → user_id) is
unchanged.

### Requirement: Small talk fast path (from chat route)

No change. The small-talk path still returns a canned
response without any LLM call.

## REMOVED Requirements

### Requirement: Streaming token-by-token chat (temporarily)

The chat route emits a single `type: "token"` event with
the full reply rather than word-by-word tokens. This was
already the case before this spec (the streaming was
removed in `fix-top3-broken` and `getResponseSync` was
the non-streaming fallback). This spec preserves the
non-streaming behavior to keep the diff small.

A future spec can re-introduce streaming by replacing
`runAgentDirect` with a streaming variant that yields
tokens incrementally.

## Migration

No data migration. Deployment self-heals on first request
after the new code is deployed.

After deployment, the `OPENAI_API_KEY` env var in Vercel
can be deleted (it was a placeholder; no code path needs
it anymore). Not required for correctness — leaving it in
place is harmless.
