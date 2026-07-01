/**
 * tests/consult-depth.test.ts — depth limit (3) and budget limit (4) on
 * consult_agent calls.
 */
import { describe, it, expect } from "vitest";
import { getConsultTool } from "../next-app/lib/agents/tools/consult";

const mockImport = async (_name: string) => {
  // not actually called when guards fire
  return {} as any;
};

describe("consult_agent guards", () => {
  it("depth-3 consult is rejected with 'loop guard exceeded'", async () => {
    const tool = getConsultTool(mockImport);
    const res = await tool.execute(
      { agent_name: "CTO", message: "x" } as any,
      { context: { conversationId: "c1", userId: "u1", turnId: "t1", a2aDepth: 3, a2aConsultsThisTurn: 0, fromAgent: "CoS", reasoning: "think_high" } } as any
    );
    expect((res as any).error).toMatch(/loop guard/);
  });

  it("budget-4 consult is rejected with 'consult budget exceeded'", async () => {
    const tool = getConsultTool(mockImport);
    const res = await tool.execute(
      { agent_name: "CTO", message: "x" } as any,
      { context: { conversationId: "c1", userId: "u1", turnId: "t1", a2aDepth: 0, a2aConsultsThisTurn: 4, fromAgent: "CoS", reasoning: "think_high" } } as any
    );
    expect((res as any).error).toMatch(/budget/);
  });
});
