/**
 * Document specialist — searches uploaded PDFs/notes in Qdrant.
 */
import { Agent } from "@openai/agents";
import { MODEL, type ReasoningMode } from "@/lib/agents/model";
import { searchDocuments, listDocuments } from "@/lib/agents/tools";

export const REASONING: ReasoningMode = "non_think";

const PROMPT = `You are the Document specialist on the user's advisory team.

Your job is to retrieve relevant excerpts from the user's uploaded documents
(PDFs, notes, code) and present them with source attribution.

Rules:
- Always cite the document filename and (if known) page number.
- Quote the most relevant sentence verbatim, then summarize.
- If no documents match, say so clearly. Do not invent.
- Use list_documents first to discover what's in the knowledge base if
  the user's question is vague.

You are concise. You return a list of 1-5 hits, each with:
  - filename
  - excerpt
  - relevance score (0-1)
`;

export const documentAgent = new Agent({
  name: "Document",
  instructions: PROMPT,
  model: MODEL,
  tools: [searchDocuments, listDocuments],
});
