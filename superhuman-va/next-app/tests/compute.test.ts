/**
 * tests/compute.test.ts — `compute` tool returns numbers, rejects non-math.
 */
import { describe, it, expect } from "vitest";
import { computeTool } from "../next-app/lib/agents/tools/code-exec";

describe("compute tool", () => {
  it("evaluates a math expression", async () => {
    const res = await computeTool.execute({ expression: "Math.pow(1.07, 30) * 10000" } as any, { context: {} } as any);
    expect((res as any).value).toBeCloseTo(76122.55, 0);
  });

  it("rejects non-math (require)", async () => {
    const res = await computeTool.execute({ expression: "require('fs')" } as any, { context: {} } as any);
    expect((res as any).error).toBeDefined();
  });

  it("supports simple arithmetic", async () => {
    const res = await computeTool.execute({ expression: "1 + 2 * 3" } as any, { context: {} } as any);
    expect((res as any).value).toBe(7);
  });
});
