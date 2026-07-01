/**
 * Visualize tool — produces a Mermaid diagram, table, or chart markdown
 * for the CoS to embed in its response.
 */
import { tool } from "@openai/agents";
import { z } from "zod";

export const visualize = tool({
  name: "visualize",
  description:
    "Render a small visualization (Mermaid diagram, Markdown table, or numbered list) to embed in the response. " +
    "Use when the answer benefits from structure (architecture, comparison, sequence, hierarchy).",
  parameters: z.object({
    type: z.enum(["mermaid", "table", "list"]),
    title: z.string().optional(),
    body: z.string().describe("Mermaid source, Markdown table, or numbered list."),
  }),
  async execute({ type, title, body }) {
    const head = title ? `### ${title}\n\n` : "";
    if (type === "mermaid") return `${head}\`\`\`mermaid\n${body}\n\`\`\`\n`;
    if (type === "table") return `${head}${body}\n`;
    return `${head}${body}\n`;
  },
});
