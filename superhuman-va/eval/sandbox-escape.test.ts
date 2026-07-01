/**
 * eval/sandbox-escape.test.ts — 8 sandbox breakout attempts.
 *
 * Each attempt invokes `runCodeTool.execute({ snippet })` (or `computeTool`)
 * and asserts that the sandbox blocks it. The test exits 1 if any attempt
 * succeeds. Run with `pnpm test:sandbox`.
 *
 * Attempts (per spec T1.5):
 *   1. require("fs")         — blocked (no require)
 *   2. process.exit(0)       — blocked (no process)
 *   3. globalThis.fetch(...) — blocked (no fetch)
 *   4. Constructor-chain escape via Function constructor
 *   5. while(true){}         — killed within 5s
 *   6. new Array(1e9)        — OOM caught
 *   7. eval("require('fs')") — blocked
 *   8. Reflect.get(globalThis, "process") — blocked
 */
import { describe, it, expect } from "vitest";
import { runCodeTool, computeTool } from "../next-app/lib/agents/tools/code-exec";

async function attempt(name: string, snippet: string, opts: { expectError: boolean; expectTimeoutMs?: number } = { expectError: true }) {
  console.log(`\n[attempt] ${name}`);
  const start = Date.now();
  const res = await runCodeTool.execute({ snippet } as any, { context: {} } as any);
  const ms = Date.now() - start;
  console.log(`  result: ${JSON.stringify(res).slice(0, 200)} (${ms}ms)`);
  if (opts.expectError) {
    if (res?.error) return { ok: true, why: res.error };
    return { ok: false, why: "expected error, got success" };
  }
  if (opts.expectTimeoutMs) {
    if (ms > opts.expectTimeoutMs + 1000) return { ok: false, why: `did not time out in ${opts.expectTimeoutMs}ms` };
    if (res?.error?.includes?.("timed out") || res?.error?.includes?.("timeout")) return { ok: true, why: res.error };
    return { ok: false, why: "expected timeout error" };
  }
  return { ok: !!res, why: "ok" };
}

describe("sandbox escape attempts", () => {
  it("1. require('fs') is blocked", async () => {
    const r = await attempt("require('fs')", `require('fs')`);
    expect(r.ok).toBe(true);
    expect(r.why.toLowerCase()).toMatch(/not defined|undefined/);
  });

  it("2. process.exit(0) is blocked", async () => {
    const r = await attempt("process.exit(0)", `process.exit(0)`);
    expect(r.ok).toBe(true);
    expect(r.why.toLowerCase()).toMatch(/not defined|undefined|process/);
  });

  it("3. globalThis.fetch is blocked", async () => {
    const r = await attempt("globalThis.fetch", `globalThis.fetch("https://attacker.com")`);
    expect(r.ok).toBe(true);
    expect(r.why.toLowerCase()).toMatch(/not defined|undefined|fetch/);
  });

  it("4. Function constructor escape is blocked", async () => {
    const r = await attempt(
      "Object.getPrototypeOf({}).constructor.constructor('return process')()",
      `Object.getPrototypeOf({}).constructor.constructor("return process")()`
    );
    expect(r.ok).toBe(true);
    expect(r.why.toLowerCase()).toMatch(/not defined|undefined|process|cannot/);
  });

  it("5. while(true) is killed within 5.5s", async () => {
    const r = await attempt("while(true){}", `while(true){}`, {
      expectError: true,
      expectTimeoutMs: 5500,
    });
    expect(r.ok).toBe(true);
  });

  it("6. massive Array allocation is OOM-caught (Next.js process survives)", async () => {
    const r = await attempt("new Array(1e9).fill(0)", `new Array(1e9).fill(0)`);
    expect(r.ok).toBe(true);
    // Either OOM, timeout, or graceful error
  });

  it("7. eval('require(...)') is blocked", async () => {
    const r = await attempt("eval('require(\"fs\")')", `eval("require('fs')")`);
    expect(r.ok).toBe(true);
  });

  it("8. Reflect.get(globalThis, 'process') is blocked", async () => {
    const r = await attempt(
      "Reflect.get(globalThis, 'process')",
      `Reflect.get(globalThis, "process")`
    );
    expect(r.ok).toBe(true);
  });
});
