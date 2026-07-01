/**
 * `runAgentDirect` — a minimal, non-streaming runner that calls DeepSeek
 * directly (via the `openai` SDK), bypassing the OpenAI Agents SDK `Runner`.
 *
 * Why this exists: the `@openai/agents` SDK v0.3.x `Runner` ignores the
 * custom `deepseekModel` adapter and uses its own OpenAI client. That
 * broke the chat route on Vercel with `401 Incorrect API key provided`
 * because the placeholder `OPENAI_API_KEY` was being used for real calls.
 * `runAgentDirect` calls DeepSeek directly and so the OpenAI SDK / key
 * is never reached.
 *
 * What it does:
 *   1. Builds the messages array from `agent.instructions` (string or
 *      async function) + the `input` (string or `AgentInputItem[]`).
 *   2. Converts the agent's `@openai/agents` tool objects (with Zod
 *      parameter schemas) to OpenAI's `ChatCompletionTool[]` format
 *      via the small `zodToJsonSchema` helper below.
 *   3. Loops up to 8 iterations: calls DeepSeek, and if the model
 *      returns `tool_calls`, executes them via `tool.execute(args, ctx)`,
 *      appends the results as `role: "tool"` messages, and re-asks.
 *   4. Returns the final text + aggregated token usage + a log of
 *      all tool calls.
 *
 * Behavior preserved from the old `getResponseSync`:
 *   - `ctx.reasoning` is honored via `reasoningParams()` (per-agent
 *     Non-Think / Think High / Think Max).
 *   - Token usage is reported when DeepSeek provides it; this function
 *     does NOT fall back to length estimation (it just returns zeros).
 */
import "server-only";
import { z } from "zod";
import OpenAI from "openai";
import type { Agent } from "@openai/agents";
import {
  MODEL,
  deepseekClient,
  reasoningParams,
  itemsToMessages,
  type ReasoningMode,
} from "./model";

export interface DirectRunnerUsage {
  input: number;
  output: number;
  reasoning: number;
  estimated: boolean;
}

export interface DirectRunnerToolCall {
  name: string;
  args: unknown;
  result: unknown;
}

export interface DirectRunnerResult {
  text: string;
  usage: DirectRunnerUsage;
  toolCalls: DirectRunnerToolCall[];
}

export interface DirectRunnerOptions {
  agent: Agent;
  input: string | unknown[];
  ctx?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Cap on tool-call loop iterations. Default 8. */
  maxIterations?: number;
}

// ─── Zod-to-JSON-schema converter ──────────────────────────────────────────
//
// Tiny converter covering every Zod type used by the specialist tools
// (see lib/agents/tools/*.ts and lib/agents/tools-shared.ts). It walks
// the schema's `_def` and emits OpenAI's JSON-schema dialect.
//
// If a future tool uses a Zod type we don't handle here, the fallback
// in `convert()` returns an empty schema object — the model will then
// see no constraints for that parameter but the call won't fail.

/** Convert a Zod schema to the JSON schema expected by the OpenAI Chat
 *  Completions `tools[].function.parameters` field. */
export function zodToJsonSchema(schema: z.ZodType<any>): Record<string, any> {
  return convertSchema(schema as any);
}

function convertSchema(schema: any): Record<string, any> {
  const def = schema?._def;
  if (!def) {
    return {};
  }
  const typeName: string = def.typeName ?? "";
  const description: string | undefined = def.description ?? schema.description;

  let result: Record<string, any>;

  switch (typeName) {
    case "ZodString":
      result = { type: "string" };
      break;
    case "ZodNumber": {
      result = { type: "number" };
      if (Array.isArray(def.checks)) {
        for (const c of def.checks) {
          if (c?.kind === "int") result.type = "integer";
        }
      }
      break;
    }
    case "ZodBoolean":
      result = { type: "boolean" };
      break;
    case "ZodNull":
      result = { type: "null" };
      break;
    case "ZodLiteral": {
      const v = def.value;
      const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      result = { type: t, enum: [v] };
      break;
    }
    case "ZodEnum":
      result = { type: "string", enum: def.values };
      break;
    case "ZodArray": {
      const items = def.type ? convertSchema(def.type) : {};
      result = { type: "array", items };
      break;
    }
    case "ZodTuple": {
      const prefixItems = (def.items ?? []).map((s: any) => convertSchema(s));
      result = { type: "array", prefixItems, items: false };
      break;
    }
    case "ZodObject": {
      const shapeFn = def.shape;
      const shape = typeof shapeFn === "function" ? shapeFn() : shapeFn ?? {};
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const valueSchema = value as z.ZodType<any>;
        const innerDef: any = (valueSchema as any)._def;
        // Unwrap .default() so the key remains required but with the inner type
        const unwrapped =
          innerDef?.typeName === "ZodDefault" ? innerDef.innerType : valueSchema;
        properties[key] = convertSchema(unwrapped);
        if (innerDef?.typeName !== "ZodOptional" && innerDef?.typeName !== "ZodDefault") {
          required.push(key);
        }
      }
      result = { type: "object", properties };
      if (required.length > 0) result.required = required;
      // passThrough / strict — only emit if explicitly set
      if (def.catchall && (def.catchall as any)._def?.typeName !== "ZodNever") {
        result.additionalProperties = convertSchema(def.catchall);
      } else {
        result.additionalProperties = false;
      }
      break;
    }
    case "ZodOptional":
      result = convertSchema(def.innerType);
      break;
    case "ZodNullable":
      result = { ...convertSchema(def.innerType), nullable: true };
      break;
    case "ZodDefault":
      result = convertSchema(def.innerType);
      break;
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (def.options ?? def.optionsMap
        ? Object.values(def.optionsMap ?? {})
        : []).map((s: any) => convertSchema(s));
      result = { anyOf: options };
      break;
    }
    case "ZodRecord": {
      const valueSchema = def.valueType ? convertSchema(def.valueType) : {};
      result = { type: "object", additionalProperties: valueSchema };
      break;
    }
    case "ZodLazy":
      result = convertSchema(def.getter());
      break;
    case "ZodEffects":
      // .refine / .transform — the underlying schema describes the
      // wire format; surface that to the model.
      result = convertSchema(def.schema);
      break;
    case "ZodMap":
    case "ZodSet":
      // We don't have a first-class OpenAI equivalent for these; fall
      // through to permissive object.
      result = { type: "object", additionalProperties: true };
      break;
    case "ZodDate":
      result = { type: "string", format: "date-time" };
      break;
    case "ZodAny":
    case "ZodUnknown":
    case "ZodVoid":
    case "ZodUndefined":
    case "ZodNever":
      result = {};
      break;
    default:
      // Unknown — log a warning and accept anything.
      if (process.env.DEBUG) {
        console.warn(`[zodToJsonSchema] unhandled typeName: ${typeName}`);
      }
      result = {};
      break;
  }

  if (description) {
    result = { ...result, description };
  }
  return result;
}

// ─── Agent-tools → OpenAI tool format ───────────────────────────────────────

/** Convert an array of `@openai/agents` tool objects into OpenAI's
 *  `ChatCompletionTool[]` shape.
 *
 *  The `tool()` helper from `@openai/agents` has already converted any
 *  Zod parameter schema into a proper JSON schema and stashed it in
 *  `tool.parameters`, so we can pass it through directly. Filtering
 *  for `type === "function"` and a string `name` is just defensive. */
export function agentToolsToOpenAITools(
  tools: unknown[] | undefined
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const result: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  if (!Array.isArray(tools)) return result;
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    const tool = t as { type?: unknown; name?: unknown; description?: unknown; parameters?: unknown };
    if (tool.type && tool.type !== "function") continue; // skip computer/shell/hosted tools
    if (typeof tool.name !== "string" || !tool.name) continue;
    if (!tool.parameters) continue;
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: tool.parameters as Record<string, any>,
      },
    });
  }
  return result;
}

// ─── runAgentDirect ────────────────────────────────────────────────────────

/** Resolve an agent's `instructions` to a plain string.
 *  The Agents SDK accepts a string OR an async function
 *  `(ctx, agent) => string | Promise<string>`. */
async function resolveInstructions(agent: Agent, ctx: Record<string, unknown>): Promise<string> {
  const inst: any = (agent as any).instructions;
  if (typeof inst === "string") return inst;
  if (typeof inst === "function") {
    const out = await (inst as Function)(ctx, agent);
    return typeof out === "string" ? out : "";
  }
  return "";
}

/** The main entry point. */
export async function runAgentDirect(
  opts: DirectRunnerOptions
): Promise<DirectRunnerResult> {
  const { agent, input, ctx = {}, signal, maxIterations = 8 } = opts;

  // ── Build initial messages ──
  const instructions = await resolveInstructions(agent, ctx);
  const inputAsItems: unknown[] =
    typeof input === "string"
      ? [{ role: "user", content: input }]
      : Array.isArray(input)
      ? input
      : [];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (instructions) messages.push({ role: "system", content: instructions });
  messages.push(...itemsToMessages(inputAsItems as any));

  // ── Tools ──
  const agentToolsList = Array.isArray((agent as any).tools) ? (agent as any).tools : [];
  const oaiTools = agentToolsToOpenAITools(agentToolsList);

  // Alias used in the loop below
  const agentTools = agentToolsList;

  // ── Reasoning params (preserve per-agent mode) ──
  const reasoning: ReasoningMode = (ctx as any).reasoning ?? "think_high";
  const params = reasoningParams(reasoning);

  // ── Loop ──
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  const toolCallsLog: DirectRunnerToolCall[] = [];
  let finalText = "";

  for (let i = 0; i < maxIterations; i++) {
    const body: any = {
      model: MODEL,
      messages,
      stream: false,
      temperature: 1.0,
      top_p: 1.0,
      ...params,
    };
    if (oaiTools.length > 0) body.tools = oaiTools;

    let res: any;
    try {
      res = await deepseekClient.chat.completions.create(body, { signal } as any);
    } catch (err) {
      // Bubble up; chat route / consult tool will catch and persist.
      throw err;
    }

    const usage = res?.usage ?? {};
    totalInput += Number(usage.prompt_tokens ?? 0);
    totalOutput += Number(usage.completion_tokens ?? 0);
    totalReasoning += Number(usage.reasoning_tokens ?? 0);

    const choice = res?.choices?.[0];
    const msg = choice?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (!toolCalls || toolCalls.length === 0) {
      finalText = typeof msg.content === "string" ? msg.content : "";
      break;
    }

    // Push the assistant message with tool_calls (required by the OpenAI
    // tool-call protocol when the next request includes tool results).
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: toolCalls,
    } as any);

    // Execute each tool
    for (const tc of toolCalls) {
      const fn = (tc as any).function ?? {};
      const fnName: string = fn.name ?? "";
      const fnArgsRaw: string = fn.arguments ?? "{}";
      let fnArgs: any;
      try {
        fnArgs = JSON.parse(fnArgsRaw);
      } catch {
        fnArgs = {};
      }

      const toolDef = agentTools.find((t: any) => t && t.name === fnName);
      let result: unknown;
      try {
        if (toolDef) {
          // The `@openai/agents` `tool()` helper wraps the user's
          // `execute` function as `invoke` (see
          // @openai/agents-core/dist/tool.mjs:296-325). `invoke` takes
          // (runContext, rawInputJsonString, details?) — it parses the
          // input via the tool's Zod/JSON parser internally, then calls
          // the user's execute. We mirror that signature.
          const invoke = typeof toolDef.invoke === "function"
            ? toolDef.invoke
            : (typeof toolDef.execute === "function" ? toolDef.execute : null);
          if (invoke) {
            // Re-stringify the parsed args so the tool's parser (often a
            // Zod schema) re-parses them. For the tools defined with
            // ZodObject, this round-trips correctly.
            const inputString = typeof fnArgsRaw === "string" ? fnArgsRaw : JSON.stringify(fnArgs);
            result = await invoke({ context: ctx }, inputString);
          } else {
            result = {
              error: `tool found but has no execute/invoke: "${fnName}"`,
              tool_keys: toolDef ? Object.keys(toolDef) : [],
            };
          }
        } else {
          result = {
            error: `tool not found: "${fnName}". Available: ${agentTools.map((t: any) => t?.name).filter(Boolean).join(", ")}`,
          };
        }
      } catch (err: any) {
        result = { error: err?.message ?? String(err) };
      }

      toolCallsLog.push({ name: fnName, args: fnArgs, result });

      messages.push({
        role: "tool",
        tool_call_id: (tc as any).id ?? "",
        content: typeof result === "string" ? result : JSON.stringify(result ?? ""),
      } as any);
    }
  }

  return {
    text: finalText,
    usage: {
      input: totalInput,
      output: totalOutput,
      reasoning: totalReasoning,
      estimated: false,
    },
    toolCalls: toolCallsLog,
  };
}
