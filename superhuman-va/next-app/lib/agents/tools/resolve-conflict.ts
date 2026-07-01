/**
 * `resolve_conflict` tool — the CoS's arbitration entry point.
 *
 * Three strategies, picked by `conflict_type`:
 *   - domain_internal   → CoS rules (return winner + one-sentence reason)
 *   - values_tradeoff   → emit `conflict` SSE; pause the stream; user picks
 *   - technical_factual → invoke Critic with Think Max + arbitration suffix
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { ulid } from "ulid";
import { Runner } from "@openai/agents";
import { deepseekModel, type ReasoningMode } from "@/lib/agents/model";
import { pbAsAdmin } from "@/lib/pocketbase";
import { postMessage, markReplied, markErrored } from "@/lib/messaging";
import type { AgentConfig } from "@/lib/agent-types";

const ARBITRATION_SUFFIX = `\n\nYou are arbitrating a conflict between two specialists. Pick a winner. Justify with 2-3 sentences. Do not hedge.`;

export function getResolveConflictTool(importCritic: () => Promise<any>) {
  return tool({
    name: "resolve_conflict",
    description:
      "Resolve a disagreement between two (or more) specialists. Pick a conflict_type per the rubric:\n" +
      "  - same metric / fact being disputed       → 'technical_factual'\n" +
      "  - recommendations that depend on priorities → 'values_tradeoff'\n" +
      "  - one specialist is out of their lane    → 'domain_internal'\n" +
      "  - unsure                                  → 'values_tradeoff'",
    parameters: z.object({
      question: z.string().describe("The question that caused the disagreement."),
      positions: z
        .array(
          z.object({
            agent: z.string(),
            stance: z.string().describe("One-sentence summary of this specialist's position."),
            reasoning: z.string().describe("2-3 sentence defense of the position."),
          })
        )
        .min(2)
        .describe("At least two specialist positions."),
      conflict_type: z.enum(["domain_internal", "values_tradeoff", "technical_factual"]),
      recommendation: z
        .enum(["a", "b", "c", "d"])
        .optional()
        .describe("For values_tradeoff: which option the CoS recommends (a/b/c/d)."),
    }),
    async execute({ question, positions, conflict_type, recommendation }, runContext?: any) {
      const ctx = runContext?.context ?? {};
      const pb = pbAsAdmin();
      const turnId = ctx.turnId ?? ulid();
      const conversationId = ctx.conversationId ?? "unknown";

      // ── domain_internal: CoS rules ──
      if (conflict_type === "domain_internal") {
        // We don't have an actual LLM call here for the CoS — the CoS's own
        // reasoning already produced the winner before calling this tool.
        // Record the resolution and return the first position (the CoS's pick)
        // as the winner. In practice the CoS picks the winner BEFORE calling
        // resolve_conflict and passes the winner's stance here.
        const winner = positions[0];
        const row = await postMessage(pb, {
          conversation_id: conversationId,
          turn_id: turnId,
          from_agent: "CoS",
          to_agent: "__conflict__",
          message: `[domain_internal] ${question} | positions: ${JSON.stringify(positions)}`,
        });
        await markReplied(
          pb,
          row.id,
          `CoS ruled: ${winner.agent} wins — ${winner.reasoning}`
        );
        return {
          strategy: "domain_internal",
          winner: winner.agent,
          reason: winner.reasoning,
        };
      }

      // ── values_tradeoff: pause stream, ask user ──
      if (conflict_type === "values_tradeoff") {
        const options = positions.map((p, i) => ({
          id: String.fromCharCode(97 + i), // a, b, c, d
          label: `${p.agent}: ${p.stance}`,
          recommendation: recommendation === String.fromCharCode(97 + i),
        }));
        const conflictId = ulid();
        const row = await postMessage(pb, {
          conversation_id: conversationId,
          turn_id: turnId,
          from_agent: "CoS",
          to_agent: "__conflict__",
          message: `[values_tradeoff] ${question} | options: ${JSON.stringify(options)}`,
        });
        await markReplied(
          pb,
          row.id,
          `Awaiting user choice (conflictId=${conflictId})`
        );
        // The chat route sees the returned conflict object in the tool result
        // and emits a `conflict` SSE event. The browser shows the ConflictCard.
        return {
          strategy: "values_tradeoff",
          conflictId,
          question,
          options,
          // Special marker so the chat route knows to pause the stream.
          _pause: true,
        };
      }

      // ── technical_factual: Critic arbitrates in Think Max ──
      if (conflict_type === "technical_factual") {
        const row = await postMessage(pb, {
          conversation_id: conversationId,
          turn_id: turnId,
          from_agent: "CoS",
          to_agent: "Critic",
          message: `Arbitrate: ${question} | positions: ${JSON.stringify(positions)}`,
        });
        try {
          const critic = await importCritic();
          const runner = new Runner({ model: deepseekModel });
          // Build a fresh prompt with the arbitration suffix appended.
          const arbitrationPrompt =
            `Arbitrate this conflict: ${question}\n\n` +
            positions.map((p) => `${p.agent}: ${p.stance} — ${p.reasoning}`).join("\n") +
            ARBITRATION_SUFFIX;
          const result = await runner.run(critic, arbitrationPrompt, {
            context: {
              ...ctx,
              reasoning: "think_max" as ReasoningMode,
              fromAgent: "Critic",
            },
          });
          const verdict =
            typeof (result as any).finalOutput === "string"
              ? (result as any).finalOutput
              : JSON.stringify((result as any).finalOutput ?? "");
          await markReplied(pb, row.id, verdict);
          return { strategy: "technical_factual", verdict };
        } catch (err: any) {
          const errMsg = err?.message ?? String(err);
          await markErrored(pb, row.id, errMsg);
          return { strategy: "technical_factual", error: errMsg };
        }
      }

      return { strategy: conflict_type, error: "no strategy matched" };
    },
  });
}
