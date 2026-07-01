/**
 * Agent-to-agent consult tool.
 *
 * Any specialist can call `consult_agent(name, message)` to invoke another
 * specialist via the OpenAI Agents SDK Runner. The tool:
 *   1. Inserts a row in `agent_messages` with status=pending.
 *   2. Invokes the target agent (looked up from the registry).
 *   3. Updates the row with the reply (status=replied).
 *   4. Enforces a 3-deep loop guard and a 4-consult/turn budget.
 */
import "server-only";
import { tool } from "@openai/agents";
import { z } from "zod";
import { ulid } from "ulid";
import { Runner } from "@openai/agents";
import { deepseekModel, type ReasoningMode } from "@/lib/agents/model";
import {
  postMessage,
  markReplied,
  markErrored,
} from "@/lib/messaging";

/** Names available for consultation. Filled in at runtime from the registry. */
let REGISTERED_NAMES: string[] = [];

/** Set the registered agent names from the registry. */
export function setRegisteredAgentNames(names: string[]) {
  REGISTERED_NAMES = names;
}

const DEPTH_LIMIT = 3;
const BUDGET_PER_TURN = 4;

interface ConsultContext {
  conversationId: string;
  userId: string;
  turnId: string;
  a2aDepth: number;
  a2aConsultsThisTurn: number;
  fromAgent: string;
  reasoning: ReasoningMode;
}

export function getConsultTool(importAgent: (name: string) => Promise<any>) {
  return tool({
    name: "consult_agent",
    description:
      "Consult another specialist directly. Use when the question genuinely needs input from another domain. " +
      "The reply is returned to you. Limit to ≤4 consults per turn.",
    parameters: z.object({
      agent_name: z
        .string()
        .describe("The name of the agent to consult. Must be one of: " + REGISTERED_NAMES.join(", ")),
      message: z.string().describe("The question or context to send."),
    }),
    async execute({ agent_name, message }, runContext?: any) {
      const ctx: ConsultContext = runContext?.context ?? {};

      // ── Loop guard ──
      if ((ctx.a2aDepth ?? 0) >= DEPTH_LIMIT) {
        return { error: "loop guard exceeded (depth >= 3)" };
      }
      // ── Budget guard ──
      if ((ctx.a2aConsultsThisTurn ?? 0) >= BUDGET_PER_TURN) {
        return { error: "consult budget exceeded (4/turn)" };
      }
      if (!REGISTERED_NAMES.includes(agent_name)) {
        return { error: `unknown agent: ${agent_name}` };
      }

      // ── Persist the consult ──
      const row = await postMessage({
        conversation_id: ctx.conversationId ?? "unknown",
        turn_id: ctx.turnId ?? ulid(),
        from_agent: ctx.fromAgent ?? "unknown",
        to_agent: agent_name,
        message,
      });

      // ── Invoke the target agent ──
      try {
        const target = await importAgent(agent_name);
        const runner = new Runner({ model: deepseekModel });
        const result = await runner.run(target, message, {
          context: {
            ...ctx,
            a2aDepth: (ctx.a2aDepth ?? 0) + 1,
            a2aConsultsThisTurn: (ctx.a2aConsultsThisTurn ?? 0) + 1,
            fromAgent: agent_name,
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
