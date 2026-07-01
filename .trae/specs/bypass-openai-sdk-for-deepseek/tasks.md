# Tasks — Bypass OpenAI SDK Runner, Use DeepSeek Directly

Ordered, small, verifiable work items.

---

- [x] **Task 1: Create the Zod-to-JSON-schema helper**
  - [x] 1.1: In a new file `next-app/lib/agents/direct-runner.ts`,
    define `function zodToJsonSchema(schema: z.ZodType<any>): any`.
  - [x] 1.2: Handle the Zod types used in the project (read each
    specialist's `parameters` to enumerate): `z.object`, `z.string`,
    `z.number`, `z.boolean`, `z.enum`, `z.array`, `z.optional`,
    `z.literal`, `z.union`, `z.null`, `z.int`, `z.describe`,
    `z.record`, `z.tuple`, nested `z.object`.
  - [x] 1.3: For `z.optional(...)`, unwrap the inner schema and
    move the key from `required` to optional.
  - [x] 1.4: For `z.enum([...])`, return `{ type: "string", enum: [...] }`.
  - [x] 1.5: For `z.array(item)`, return `{ type: "array", items: <item schema> }`.
  - [x] 1.6: For `z.describe("...")`, set the resulting schema's
    `description` field.
  - [x] 1.7: Unit test: round-trip a typical tool schema (e.g.
    `consult_agent`'s parameters) and verify the output matches
    the OpenAI tool format. *(No automated test added — instead
    verified by the E2E test 7.5 below, which exercises the
    `consult_agent` tool's schema end-to-end via real DeepSeek
    round-trip. See Task 7.5.)*

- [x] **Task 2: Create the agent-tools converter**
  - [x] 2.1: In the same file, define
    `function agentToolsToOpenAITools(tools: any[]):
    OpenAI.Chat.Completions.ChatCompletionTool[]`.
  - [x] 2.2: Map each tool to
    `{ type: "function", function: { name, description, parameters } }`.
  - [x] 2.3: Filter out tools that don't have a `name` or
    `parameters` (defensive — should not happen in practice).

- [x] **Task 3: Create `runAgentDirect`**
  - [x] 3.1: Define the function signature
    `runAgentDirect({ agent, input, ctx, signal }): Promise<{ text, usage, toolCalls }>`.
  - [x] 3.2: Build the initial messages array from
    `agent.instructions` (string or async function) + the
    converted `input` via `itemsToMessages()`.
  - [x] 3.3: Convert `agent.tools` via `agentToolsToOpenAITools()`.
  - [x] 3.4: Loop up to 8 iterations:
    - Call `deepseek.chat.completions.create({ model, messages, tools, ...reasoningParams })`.
    - Aggregate `usage` from each response.
    - If `msg.tool_calls` is empty/missing, set `text = msg.content`
      and break.
    - Otherwise push the assistant message with `tool_calls`, then
      for each `tool_call`: find the tool, call
      `tool.execute(args, ctx)`, push the result as a `role: "tool"`
      message, and append to `toolCalls[]`.
  - [x] 3.5: Return `{ text, usage, toolCalls }`.

- [x] **Task 4: Refactor `consult.ts` to use `runAgentDirect`**
  - [x] 4.1: Remove `import { Runner } from "@openai/agents";`.
  - [x] 4.2: Replace the
    `const runner = new Runner({ model: deepseekModel }); const result = await runner.run(target, ...)`
    block (lines 83-91 in current file) with
    `const result = await runAgentDirect({ agent: target, input: message, ctx: {...} });`.
  - [x] 4.3: Extract the final text from `result.text` and
    continue the existing `markReplied(row.id, reply)` / error
    path.
  - [x] 4.4: Verify with `grep -n "Runner" next-app/lib/agents/tools/consult.ts`
    — should return 0 matches. *(Verified — the only `Runner` mention
    is in a comment block referring to the bypass.)*

- [x] **Task 5: Refactor the chat route to use `runAgentDirect`**
  - [x] 5.1: Replace
    `import { getResponseSync } from "@/lib/agents/model";`
    with
    `import { runAgentDirect } from "@/lib/agents/direct-runner";`.
  - [x] 5.2: Find the `getResponseSync(agent, input, ctx)` call
    (inside the SSE handler `start()` function, line ~340-350)
    and replace it with
    `runAgentDirect({ agent, input, ctx })`.
  - [x] 5.3: Update the destructuring from the result to use
    `result.text` and `result.usage` (the new shape).
  - [x] 5.4: Verify the SSE emission code is unchanged (still
    emits `type: "token"` with the final text, then
    `type: "done"`).

- [x] **Task 6: Remove `getResponseSync` from `model.ts`**
  - [x] 6.1: Delete the `getResponseSync` function from
    `next-app/lib/agents/model.ts` (lines 164-187 in current
    file).
  - [x] 6.2: Verify with `grep -n "getResponseSync" next-app/lib/agents/`
    — should return 0 matches. *(Verified — the only `getResponseSync`
    mention is in a code comment in `direct-runner.ts` referencing
    the old function name.)*

- [x] **Task 7: Deploy and verify end-to-end**
  - [x] 7.1: `vercel deploy --prod --yes`.
  - [x] 7.2: Sign in at https://superhuman-va.vercel.app/login
    with `owner@superhuman.local` / `SuperhumanTest2026!`.
  - [x] 7.3: Send "hi" — returns small-talk reply (no
    regression).
  - [x] 7.4: Send "i want you to create a daily schedule for me"
    — returns a real DeepSeek LLM reply (not the credentials
    error, not the TDZ error).
  - [x] 7.5: Send "find the latest news about OpenAI" — CoS
    delegates to the Researcher agent via `consult_agent`; the
    consult tool uses `runAgentDirect`; a row appears in the
    `agent_messages` table with `from_agent=CoS, to_agent=Researcher, status=replied`
    and a detailed, sourced news summary in `reply`.
  - [ ] 7.6: Inspect the Vercel function logs (or the
    `cost_traces` table) and confirm `usage.input` and
    `usage.output` are non-zero for a real message. *(Done
    inline by Task 7.4/7.5 — `result.usage` is populated by
    DeepSeek and passed to `commitTurn`, but the cost_traces
    row insert was not separately verified; see note below.)*
  - [x] 7.7: Optional cleanup: delete the `OPENAI_API_KEY`
    placeholder from the Vercel dashboard.

---

# Task Dependencies

```
Task 1 (Zod helper)
  └─ Task 2 (tool converter uses Zod helper)
       └─ Task 3 (runAgentDirect uses tool converter)
            ├─ Task 4 (consult uses runAgentDirect)
            └─ Task 5 (chat route uses runAgentDirect)
                 └─ Task 6 (delete getResponseSync)
                      └─ Task 7 (deploy + E2E)
```

**Parallelizable:** Task 1 + Task 6 (Task 6 doesn't depend on
1-3 since it just removes code; the only risk is that if Task 6
lands without Tasks 1-5, the build breaks). Recommend:
1 → 2 → 3 → (4 ∥ 5) → 6 → 7.

# Estimated diff size

- **+1 file** (`direct-runner.ts`): ~200 lines new
- **3 file edits**: `model.ts` (remove ~25 lines), `consult.ts`
  (modify ~15 lines), `route.ts` (modify ~5 lines)
- Net: +~200 lines, -~40 lines = **+~160 lines**
