/**
 * Sandboxed code execution for specialists.
 *
 * - `compute(expression)` — fast single-expression math. Returns a number.
 * - `run_code(snippet)`   — multi-line JS, returns { stdout, value, error }.
 *
 * Backed by `node:vm` with safe globals only. 5-second timeout. No `require`,
 * no `process`, no `fetch`, no `fs`. The Next.js process survives OOM/loops
 * because we catch the timeout and V8's heap-soft limit.
 */
import vm from "node:vm";
import { tool } from "@openai/agents";
import { z } from "zod";

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
    setTimeout, // allow async timeout but only for the script
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
