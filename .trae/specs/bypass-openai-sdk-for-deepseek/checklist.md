# Checklist — Bypass OpenAI SDK Runner, Use DeepSeek Directly

Each is a single, testable assertion.

## Task 1 — Zod-to-JSON-schema helper

- [ ] ZJ-1: `zodToJsonSchema` is defined in
  `next-app/lib/agents/direct-runner.ts`.
- [ ] ZJ-2: `zodToJsonSchema(z.object({ a: z.string() }))` returns
  `{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }`.
- [ ] ZJ-3: `zodToJsonSchema(z.optional(z.string()))` returns
  `{ type: "string" }` (no `required` list).
- [ ] ZJ-4: `zodToJsonSchema(z.enum(["a", "b"]))` returns
  `{ type: "string", enum: ["a", "b"] }`.
- [ ] ZJ-5: `zodToJsonSchema(z.array(z.number()))` returns
  `{ type: "array", items: { type: "number" } }`.
- [ ] ZJ-6: `zodToJsonSchema(z.string().describe("foo"))` includes
  `description: "foo"`.
- [ ] ZJ-7: The `consult_agent` tool's parameters round-trip
  correctly (its Zod schema → JSON schema → DeepSeek → no
  schema-validation error).

## Task 2 — Agent-tools converter

- [ ] AT-1: `agentToolsToOpenAITools` is defined and exported.
- [ ] AT-2: An input tool `{ name: "consult_agent", description:
  "...", parameters: <Zod> }` is converted to
  `{ type: "function", function: { name, description, parameters: <JSON> } }`.

## Task 3 — `runAgentDirect`

- [ ] RD-1: `runAgentDirect` is defined with the signature
  `({ agent, input, ctx, signal }) → Promise<{ text, usage, toolCalls }>`.
- [ ] RD-2: A single call with no tool returns the model's text
  in `result.text`.
- [ ] RD-3: A call where the model returns a `tool_calls` array
  triggers the tool, appends the result, and re-calls the model.
- [ ] RD-4: The loop terminates after 8 iterations even if the
  model keeps calling tools (safety cap).
- [ ] RD-5: `usage.input` and `usage.output` aggregate across
  all iterations in the loop.
- [ ] RD-6: `ctx.reasoning` is honored — a call with
  `reasoning: "non_think"` does not include
  `reasoning_effort` in the DeepSeek request body.

## Task 4 — `consult.ts` refactor

- [ ] CT-1: `import { Runner } from "@openai/agents";` is removed
  from `consult.ts`.
- [ ] CT-2: The `Runner.run()` block is replaced with
  `runAgentDirect()`.
- [ ] CT-3: `grep -n "Runner" next-app/lib/agents/tools/consult.ts`
  returns 0 matches.
- [ ] CT-4: The `markReplied` / `markErrored` path is unchanged.

## Task 5 — Chat route refactor

- [ ] CR-1: `import { getResponseSync }` is replaced with
  `import { runAgentDirect }`.
- [ ] CR-2: The `getResponseSync(...)` call inside the SSE
  handler is replaced with
  `runAgentDirect({ agent, input, ctx })`.
- [ ] CR-3: The SSE emission code is unchanged (still emits
  `type: "token"`, then `type: "done"`).
- [ ] CR-4: `grep -n "getResponseSync" next-app/app/`
  returns 0 matches.

## Task 6 — Remove `getResponseSync` from `model.ts`

- [ ] MR-1: The `getResponseSync` function is deleted from
  `next-app/lib/agents/model.ts`.
- [ ] MR-2: `grep -rn "getResponseSync" next-app/`
  returns 0 matches.
- [ ] MR-3: The build succeeds with no unused-imports or
  type errors.

## Task 7 — Deploy & E2E

- [ ] DE-1: `vercel deploy --prod --yes` reports success.
- [ ] DE-2: The build log shows no `[deepseek] DEEPSEEK_API_KEY
  is not set` warning.
- [ ] DE-3: `/login` returns 200.
- [ ] DE-4: Signing in with the test user succeeds.
- [ ] DE-5: Sending "hi" returns a small-talk reply (no
  regression).
- [ ] DE-6: Sending "i want you to create a daily schedule for
  me" returns a real DeepSeek reply (not an error event).
- [ ] DE-7: Sending "find the latest news about OpenAI"
  produces a delegation: at least one row in
  `agent_messages` with `from_agent=CoS` and
  `to_agent=Researcher` and `status=replied`.
- [ ] DE-8: The `cost_traces` table has a row for the turn
  with `input_tokens > 0` and `output_tokens > 0`.
- [ ] DE-9: No 401, no `OPENAI_API_KEY` errors in the Vercel
  function logs.
- [ ] DE-10: The placeholder `OPENAI_API_KEY` in Vercel is
  deleted (optional cleanup).

## Final acceptance

- [ ] FA-1: All 4 ADDED Requirements in `spec.md` pass.
- [ ] FA-2: All 32 checklist items above are checked.
- [ ] FA-3: A real chat message produces a DeepSeek LLM
  response end-to-end (closes the "New Issue" from
  `break-cos-registry-cycle`).
- [ ] FA-4: The CoS can delegate to specialists via
  `consult_agent` and the consult uses DeepSeek.
- [ ] FA-5: The chat works with no OpenAI credentials in any
  env var.
