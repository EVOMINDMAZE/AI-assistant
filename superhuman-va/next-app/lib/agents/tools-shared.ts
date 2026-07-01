/**
 * Shared tool imports for specialists.
 *
 * Provides a per-specialist `consultAgent` tool + the code-exec tools
 * (`computeTool`, `runCodeTool`) for any specialist that needs math
 * or a sandboxed JS snippet.
 */
import "server-only";
import vm from "node:vm";
import { tool } from "@openai/agents";
import { z } from "zod";
import { Runner } from "@openai/agents";
import { deepseekModel, type ReasoningMode } from "@/lib/agents/model";
import { postMessage, markReplied, markErrored } from "@/lib/messaging";
import { AGENT_NAMES } from "@/lib/agent-types";

// ─── consult_agent ─────────────────────────────────────────────────────────
const DEPTH_LIMIT = 3;
const BUDGET_PER_TURN = 4;

export function consultAgent(importAgent: (name: string) => Promise<any>, fromName: string) {
  return tool({
    name: "consult_agent",
    description:
      "Consult another specialist directly. Use when the question genuinely needs input from another domain. " +
      "Limit to ≤4 consults per turn. Available agents: " + AGENT_NAMES.join(", "),
    parameters: z.object({
      agent_name: z.string(),
      message: z.string(),
    }),
    async execute({ agent_name, message }, runContext?: any) {
      const ctx = runContext?.context ?? {};
      if ((ctx.a2aDepth ?? 0) >= DEPTH_LIMIT) return { error: "loop guard exceeded (depth >= 3)" };
      if ((ctx.a2aConsultsThisTurn ?? 0) >= BUDGET_PER_TURN) return { error: "consult budget exceeded (4/turn)" };
      if (!AGENT_NAMES.includes(agent_name as any)) return { error: `unknown agent: ${agent_name}` };

      const row = await postMessage({
        conversation_id: ctx.conversationId ?? "unknown",
        turn_id: ctx.turnId ?? "unknown",
        from_agent: fromName,
        to_agent: agent_name,
        message,
      });

      try {
        const target = await importAgent(agent_name);
        const runner = new Runner({ model: deepseekModel });
        const result = await runner.run(target, message, {
          context: {
            ...ctx,
            a2aDepth: (ctx.a2aDepth ?? 0) + 1,
            a2aConsultsThisTurn: (ctx.a2aConsultsThisTurn ?? 0) + 1,
            fromAgent: fromName,
          },
        });
        const reply =
          typeof (result as any).finalOutput === "string"
            ? (result as any).finalOutput
            : JSON.stringify((result as any).finalOutput ?? "");
        await markReplied(row.id, reply);
        return { agent: agent_name, reply };
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        await markErrored(row.id, errMsg);
        return { agent: agent_name, error: errMsg };
      }
    },
  });
}

// ─── compute / run_code (sandboxed JS) ─────────────────────────────────────
const SAFE_GLOBALS: Record<string, unknown> = {
  Math,
  Date,
  JSON,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Map,
  Set,
  RegExp,
  Error,
  Symbol,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
};

interface RunResult {
  stdout: string;
  value: unknown;
  error: string | null;
}

function runInSandbox(snippet: string, timeoutMs = 5000): RunResult {
  const stdout: string[] = [];
  const sandbox = {
    ...SAFE_GLOBALS,
    console: { log: (...args: any[]) => stdout.push(args.map(stringify).join(" ")) },
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext(sandbox);
  let script: vm.Script;
  try {
    const wrapped = `(function() { "use strict";\n${snippet}\n})()`;
    script = new vm.Script(wrapped, { filename: "snippet.js" });
  } catch (err: any) {
    return { stdout: "", value: undefined, error: `compile error: ${err.message}` };
  }
  try {
    const value = script.runInContext(context, { timeout: timeoutMs });
    return { stdout: stdout.join("\n"), value, error: null };
  } catch (err: any) {
    if (err?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      return { stdout: stdout.join("\n"), value: undefined, error: "Script execution timed out" };
    }
    return { stdout: stdout.join("\n"), value: undefined, error: err?.message ?? String(err) };
  }
}

function stringify(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export const computeTool = tool({
  name: "compute",
  description:
    "Evaluate a single math expression. Returns a number. Use for any numeric claim " +
    "(ROI, NPV, time, percentages). Example: `compute('Math.pow(1.07, 30) * 10000')` → 76122.55.",
  parameters: z.object({
    expression: z.string().describe("A JavaScript math expression."),
  }),
  async execute({ expression }) {
    const res = runInSandbox(`return (${expression});`, 2000);
    if (res.error) return { error: res.error };
    return { value: res.value };
  },
});

export const runCodeTool = tool({
  name: "run_code",
  description:
    "Run a multi-line JavaScript snippet in a sandboxed VM. Returns `{stdout, value, error}`. " +
    "5-second timeout. No `require`, no `process`, no `fetch`, no `fs` — the sandbox blocks them. " +
    "Use for prototypes, simulations, payload demos. NOT a general-purpose executor.",
  parameters: z.object({
    snippet: z.string().describe("JavaScript source. Last expression's value is returned."),
  }),
  async execute({ snippet }) {
    return runInSandbox(snippet, 5000);
  },
});
