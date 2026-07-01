/**
 * tests/run_code.test.ts — `run_code` tool: sandbox, stdout, timeouts.
 */
import { describe, it, expect } from "vitest";
import { runCodeTool } from "../next-app/lib/agents/tools/code-exec";

describe("run_code tool", () => {
  it("captures stdout", async () => {
    const res = await runCodeTool.execute(
      { snippet: "console.log('hi'); console.log(2+2);" } as any,
      { context: {} } as any
    );
    expect((res as any).stdout).toBe("hi\n4\n");
    expect((res as any).error).toBeNull();
  });

  it("blocks require('fs')", async () => {
    const res = await runCodeTool.execute({ snippet: "require('fs')" } as any, { context: {} } as any);
    expect((res as any).error).toMatch(/not defined|require/);
  });

  it("kills infinite loops within 5.5s", async () => {
    const start = Date.now();
    const res = await runCodeTool.execute({ snippet: "while(true){}" } as any, { context: {} } as any);
    const ms = Date.now() - start;
    expect(ms).toBeLessThan(6000);
    expect((res as any).error).toMatch(/timed out|timeout/);
  });
});
