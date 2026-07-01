/**
 * `search_messages` tool — find past user/assistant messages by content.
 * Backed by the Qdrant `messages` collection (one per user, indexed by the
 * memory service on every chat turn).
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { memoryClient } from "@/lib/memory-client";

export const searchMessages = tool({
  name: "search_messages",
  description:
    "Search the user's past chat messages (both user and assistant) for a phrase. " +
    "Returns matching snippets along with the conversation_id they came from. " +
    "Use this when the user asks 'when did we talk about X?' or 'find what I said about Y'.",
  parameters: z.object({
    query: z.string().describe("Natural-language search query."),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  async execute({ query, limit }) {
    const res = await memoryClient.searchMessages(
      process.env.USER_ID ?? "local-user",
      query,
      limit
    );
    return res.results;
  },
});
