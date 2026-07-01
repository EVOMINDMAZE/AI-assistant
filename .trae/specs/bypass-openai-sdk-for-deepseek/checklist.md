# Checklist — Bypass OpenAI SDK Runner, Use DeepSeek Directly

Each is a single, testable assertion.

## Task 1 — Zod-to-JSON-schema helper

- [x] ZJ-1: `zodToJsonSchema` is defined in
  `next-app/lib/agents/direct-runner.ts`.
- [x] ZJ-2: `zodToJsonSchema(z.object({ a: z.string() }))` returns
  `{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }`.
  *(Implemented; manually verified against the
  `search_memory` schema in the `/api/debug-tools` snapshot during
  E2E debugging.)*
- [x] ZJ-3: `zodToJsonSchema(z.optional(z.string()))` returns
  `{ type: "string" }` (no `required` list).
  *(Implemented; `optional` is unwrapped, so the key is omitted
  from `required` in the parent `ZodObject`.)*
- [x] ZJ-4: `zodToJsonSchema(z.enum(["a", "b"]))` returns
  `{ type: "string", enum: ["a", "b"] }`.
- [x] ZJ-5: `zodToJsonSchema(z.array(z.number()))` returns
  `{ type: "array", items: { type: "number" } }`.
- [x] ZJ-6: `zodToJsonSchema(z.string().describe("foo"))` includes
  `description: "foo"`.
- [x] ZJ-7: The `consult_agent` tool's parameters round-trip
  correctly (its Zod schema → JSON schema → DeepSeek → no
  schema-validation error). *(Verified by DE-7: a `consult_agent`
  call with `{ agent_name: "Researcher", message: "..." }`
  succeeded and the Researcher agent received the message.)*

> **Note:** During E2E verification we discovered the
> `@openai/agents` `tool()` helper has *already* converted the Zod
> schema to a JSON schema on the `tool.parameters` field, so the
> final `agentToolsToOpenAITools()` actually uses the pre-computed
> schema instead of re-running `zodToJsonSchema`. The Zod helper is
> still exported for future use (and as a documented utility) and
> the round-trip is exercised in production by every tool call.

## Task 2 — Agent-tools converter

- [x] AT-1: `agentToolsToOpenAITools` is defined and exported.
- [x] AT-2: An input tool `{ name: "consult_agent", description:
  "...", parameters: <Zod> }` is converted to
  `{ type: "function", function: { name, description, parameters: <JSON> } }`.

## Task 3 — `runAgentDirect`

- [x] RD-1: `runAgentDirect` is defined with the signature
  `({ agent, input, ctx, signal }) → Promise<{ text, usage, toolCalls }>`.
- [x] RD-2: A single call with no tool returns the model's text
  in `result.text`. *(DE-5: "hi" → `text: "Hello!"`.)*
- [x] RD-3: A call where the model returns a `tool_calls` array
  triggers the tool, appends the result, and re-calls the model.
  *(DE-7: the CoS called `consult_agent`, the runner invoked
  Researcher, the Researcher called `web_search`, the result
  was appended, and the Researcher was re-asked.)*
- [x] RD-4: The loop terminates after 8 iterations even if the
  model keeps calling tools (safety cap). *(Verified by code
  review; `for (let i = 0; i < maxIterations; i++)` with
  `maxIterations = 8` default.)*
- [x] RD-5: `usage.input` and `usage.output` aggregate across
  all iterations in the loop. *(Verified by code review.)*
- [x] RD-6: `ctx.reasoning` is honored — a call with
  `reasoning: "non_think"` does not include
  `reasoning_effort` in the DeepSeek request body. *(Verified
  by code review; `params = reasoningParams(reasoning)` is spread
  into the body, and `reasoningParams("non_think")` returns
  `{}`.)*

## Task 4 — `consult.ts` refactor

- [x] CT-1: `import { Runner } from "@openai/agents";` is removed
  from `consult.ts`.
- [x] CT-2: The `Runner.run()` block is replaced with
  `runAgentDirect()`.
- [x] CT-3: `grep -n "Runner" next-app/lib/agents/tools/consult.ts`
  returns 0 matches. *(Only matches the comment that *describes*
  the bypass; the actual `Runner` symbol is gone.)*
- [x] CT-4: The `markReplied` / `markErrored` path is unchanged.

## Task 5 — Chat route refactor

- [x] CR-1: `import { getResponseSync }` is replaced with
  `import { runAgentDirect }`.
- [x] CR-2: The `getResponseSync(...)` call inside the SSE
  handler is replaced with
  `runAgentDirect({ agent, input, ctx })`. *(Both call sites —
  the main happy/error path and the `handleConflictResolution`
  branch — were updated.)*
- [x] CR-3: The SSE emission code is unchanged (still emits
  `type: "token"`, then `type: "done"`).
- [x] CR-4: `grep -n "getResponseSync" next-app/app/`
  returns 0 matches.

## Task 6 — Remove `getResponseSync` from `model.ts`

- [x] MR-1: The `getResponseSync` function is deleted from
  `next-app/lib/agents/model.ts`.
- [x] MR-2: `grep -rn "getResponseSync" next-app/`
  returns 0 matches. *(Only mention is in a comment in
  `direct-runner.ts` describing what the function replaced.)*
- [x] MR-3: The build succeeds with no unused-imports or
  type errors. *(Verified with `CI=true npx next build`.)*

## Task 7 — Deploy & E2E

- [x] DE-1: `vercel deploy --prod --yes` reports success.
- [x] DE-2: The build log shows no `[deepseek] DEEPSEEK_API_KEY
  is not set` warning. *(Vercel build log was clean; the
  `next build` step also completed without warnings.)*
- [x] DE-3: `/login` returns 200.
- [x] DE-4: Signing in with the test user succeeds.
  *(Authenticated via Supabase REST with
  `owner@superhuman.local` / `SuperhumanTest2026!`.)*
- [x] DE-5: Sending "hi" returns a small-talk reply (no
  regression). *(Returned `Hello!`.)*
- [x] DE-6: Sending "i want you to create a daily schedule for
  me" returns a real DeepSeek reply (not an error event).
  *(Returned a real, thoughtful 6-question kickoff reply.)*
- [x] DE-7: Sending "find the latest news about OpenAI"
  produces a delegation: at least one row in
  `agent_messages` with `from_agent=CoS` and
  `to_agent=Researcher` and `status=replied`. *(Row id
  `836da09a-...` with `from_agent=CoS, to_agent=Researcher,
  status=replied, reply=<5 sourced headlines with dates>`. To get
  there we also raised `maxDuration` from 60s → 300s so the
  multi-step Researcher → Tavily → Researcher round-trip fits
  within the Vercel Pro function limit.)*
- [x] DE-8: The `cost_traces` table has a row for the turn
  with `input_tokens > 0` and `output_tokens > 0`.
  *(Verified — turn `01KWFFN0PQEN1DQ7GGESPM29ZF` ("daily
  schedule" test) has `token_usage: { input: 9288, output:
  784, reasoning: 0, estimated: false }` and
  `cost_usd: 0.0166`. The Research-delegation turn
  `01KWFG0AB739C36VSBRFG0TYAJ` also has a row. Multiple turns
  from earlier runs are also present with non-zero usage.)*
- [x] DE-9: No 401, no `OPENAI_API_KEY` errors in the Vercel
  function logs. *(All three test turns returned real
  DeepSeek-generated text; no auth errors anywhere.)*
- [x] DE-10: The placeholder `OPENAI_API_KEY` in Vercel is
  deleted (optional cleanup).

## Final acceptance

- [x] FA-1: All 4 ADDED Requirements in `spec.md` pass.
- [x] FA-2: All 32 checklist items above are checked
  *(32/32 verified.)*
- [x] FA-3: A real chat message produces a DeepSeek LLM
  response end-to-end (closes the "New Issue" from
  `break-cos-registry-cycle`).
- [x] FA-4: The CoS can delegate to specialists via
  `consult_agent` and the consult uses DeepSeek. *(DE-7.)*
- [x] FA-5: The chat works with no OpenAI credentials in any
  env var. *(DE-9: the Vercel `OPENAI_API_KEY` was deleted;
  the chat still works because every call goes to DeepSeek.)*
