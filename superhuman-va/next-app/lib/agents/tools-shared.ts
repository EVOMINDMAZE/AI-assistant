/**
 * Shared tool imports for specialists.
 *
 * Provides a per-specialist `consultAgent` tool that wraps the global
 * `getConsultTool` with this specialist's "from" name baked in.
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { Runner } from "@openai/agents";
import { deepseekModel, type ReasoningMode } from "@/lib/agents/model";
import { pbAsAdmin } from "@/lib/pocketbase";
import { postMessage, markReplied, markErrored } from "@/lib/messaging";
import { AGENT_NAMES } from "@/lib/agent-types";

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

      const pb = pbAsAdmin();
      const row = await postMessage(pb, {
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
        await markReplied(pb, row.id, reply);
        return { agent: agent_name, reply };
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        await markErrored(pb, row.id, errMsg);
        return { agent: agent_name, error: errMsg };
      }
    },
  });
}
