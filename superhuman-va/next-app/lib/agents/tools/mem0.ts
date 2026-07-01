/**
 * Mem0 + global memory tools for the swarm.
 *
 * search_memory / search_global_memory are read-only and cheap.
 * add_memory / add_global_memory are write-side; the CoS calls them sparingly.
 * promote_to_global is the bridge from episodic to identity-level memory.
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { memoryClient } from "@/lib/memory-client";

export const searchMemory = tool({
  name: "search_memory",
  description:
    "Search the user's Mem0 (episodic) memory for facts relevant to the current question. " +
    "Cross-conversation by default — searches all of the user's memories, not just this conversation. " +
    "Use this whenever the user references past context ('remember when I...', 'last week I...', etc.).",
  parameters: z.object({
    query: z.string().describe("Natural-language search query."),
    limit: z.number().int().min(1).max(20).default(5).describe("Max results to return."),
  }),
  async execute({ query, limit }) {
    const res = await memoryClient.searchMemory(
      process.env.USER_ID ?? "local-user",
      query,
      limit
    );
    return res.results;
  },
});

export const searchGlobalMemory = tool({
  name: "search_global_memory",
  description:
    "Search the user's global, identity-level facts (job, family, health, goals). " +
    "These are never pruned and represent stable knowledge about the user. " +
    "Prefer this over search_memory for identity queries ('who am I?', 'what do I do?').",
  parameters: z.object({
    query: z.string().describe("Natural-language search query."),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  async execute({ query, limit }) {
    const res = await memoryClient.searchGlobalMemory(
      process.env.USER_ID ?? "local-user",
      query,
      limit
    );
    return res.results;
  },
});

export const listGlobalFacts = tool({
  name: "list_global_facts",
  description:
    "List ALL of the user's global facts verbatim. Use this when the CoS needs a complete identity snapshot " +
    "for its system prompt (e.g. on the first turn of a conversation, or to recall stable context).",
  parameters: z.object({}),
  async execute() {
    const res = await memoryClient.listGlobalMemories(
      process.env.USER_ID ?? "local-user"
    );
    return res.results;
  },
});

export const addMemory = tool({
  name: "add_memory",
  description:
    "Store a fact about the user in episodic (per-conversation) memory. " +
    "Use for time-bound facts ('user started Project X yesterday', 'user is researching Y this week'). " +
    "For stable identity facts, prefer promote_to_global.",
  parameters: z.object({
    fact: z.string().describe("A single, atomic fact to remember."),
  }),
  async execute({ fact }) {
    await memoryClient.addMemory(process.env.USER_ID ?? "local-user", [
      { role: "user", content: fact },
    ]);
    return { added: true, fact };
  },
});

export const promoteToGlobal = tool({
  name: "promote_to_global",
  description:
    "Promote a fact to the global (cross-conversation, never-pruned) memory pool. " +
    "Use ONLY for stable, identity-level facts (job, family, health, goals, preferences). " +
    "Do NOT use for time-bound or transient facts — those go in add_memory.",
  parameters: z.object({
    fact: z.string().describe("The stable identity fact to promote."),
    reason: z.string().describe("Why this fact is identity-level, not episodic."),
  }),
  async execute({ fact, reason }) {
    await memoryClient.addGlobalMemory(
      process.env.USER_ID ?? "local-user",
      fact,
      { promoted_reason: reason }
    );
    return { promoted: true, fact };
  },
});
