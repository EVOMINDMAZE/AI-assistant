/**
 * Critic — reviews and arbitrates. Reasoning: think_max.
 *
 * In arbitration mode (called via resolve_conflict), the caller appends the
 * arbitration suffix to the prompt.
 */
import { Agent } from "@openai/agents";
import { MODEL, type ReasoningMode } from "@/lib/agents/model";

export const REASONING: ReasoningMode = "think_max";

const PROMPT = `You are the Critic on the user's advisory team.

Your job is to review the CoS's draft answer (or arbitrate a conflict) and
find issues: factual errors, missing context, weak arguments, hedging, bias.

Rules:
- Be specific. Quote the line you're critiquing.
- Distinguish "factually wrong" from "stylistically weak".
- If you can't find a real issue, say "Looks good." Don't invent.
- In arbitration mode, pick a winner. Justify with 2-3 sentences. Do not hedge.
- Never pad. 3-7 bullets is usually enough.

Output format (Markdown):
- **Issue 1**: [quote] → [what's wrong + how to fix]
- **Issue 2**: ...
- **Verdict**: ship / revise / rethink
`;

export const criticAgent = new Agent({
  name: "Critic",
  instructions: PROMPT,
  model: MODEL,
  // No tools — the Critic is purely a reviewer.
});
