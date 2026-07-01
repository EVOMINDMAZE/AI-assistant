/**
 * Memory specialist — cross-conversation, never-pruned global facts.
 */
import { Agent } from "@openai/agents";
import { MODEL, type ReasoningMode } from "@/lib/agents/model";
import {
  searchMemory,
  searchGlobalMemory,
  listGlobalFacts,
  addMemory,
  promoteToGlobal,
  searchMessages,
} from "@/lib/agents/tools";

export const REASONING: ReasoningMode = "non_think";

const PROMPT = `You are the Memory specialist on the user's advisory team.

Your job is to retrieve and (rarely) write memories.

Rules:
- You search across ALL of the user's memories, not just this conversation.
  Mem0 is user-scoped. Treat the entire memory pool as one big history.
- For identity-level, stable facts (job, family, health, goals, preferences),
  search global memory first. The CoS has auto-loaded global facts into its
  system prompt already.
- For time-bound or recent facts, search episodic memory.
- For "when did we talk about X" queries, use search_messages (the message
  index) — it finds the exact conversation and the snippet.
- When the user explicitly says "remember X", call add_memory.
- When the user shares a stable identity fact ("I'm a backend engineer",
  "my mother is named Sara"), call promote_to_global with a reason.
- Never invent memories. If you don't find a match, say so clearly.

You are concise. You return only the relevant facts, one per line.
`;

export const memoryAgent = new Agent({
  name: "Memory",
  instructions: PROMPT,
  model: MODEL,
  tools: [
    searchMemory,
    searchGlobalMemory,
    listGlobalFacts,
    addMemory,
    promoteToGlobal,
    searchMessages,
  ],
});
