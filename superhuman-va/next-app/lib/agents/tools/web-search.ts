/**
 * Web search tool, backed by Tavily.
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { tavily as tavilyClient } from "tavily";

const tvly = process.env.TAVILY_API_KEY
  ? tavilyClient({ apiKey: process.env.TAVILY_API_KEY })
  : null;

export const webSearchTool = tool({
  name: "web_search",
  description:
    "Search the live web for current information. Use when the question is about recent events, " +
    "current pricing, latest docs, or anything time-sensitive. Returns top results with snippets.",
  parameters: z.object({
    query: z.string().describe("Search query."),
    max_results: z.number().int().min(1).max(10).default(5),
  }),
  async execute({ query, max_results }) {
    if (!tvly) return { error: "TAVILY_API_KEY not set" };
    const res = await tvly.search(query, { maxResults: max_results });
    return res.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  },
});
