/**
 * Document RAG tools, backed by the memory service's Qdrant collection.
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { memoryClient } from "@/lib/memory-client";

export const searchDocuments = tool({
  name: "search_documents",
  description:
    "Search the user's uploaded documents (PDFs, notes, code) for chunks relevant to the question. " +
    "Returns the most relevant excerpts with source filenames. Use whenever the user references 'the doc', 'the PDF', " +
    "or asks about something they uploaded previously.",
  parameters: z.object({
    query: z.string().describe("Natural-language search query."),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  async execute({ query, limit }) {
    const res = await memoryClient.searchDocuments(
      process.env.USER_ID ?? "local-user",
      query,
      limit
    );
    return res.results;
  },
});

export const listDocuments = tool({
  name: "list_documents",
  description:
    "List all documents the user has uploaded. Use when the user asks 'what docs do I have?' or " +
    "to discover what's in the knowledge base before searching.",
  parameters: z.object({}),
  async execute() {
    const res = await memoryClient.listDocuments(
      process.env.USER_ID ?? "local-user"
    );
    return res.results;
  },
});
