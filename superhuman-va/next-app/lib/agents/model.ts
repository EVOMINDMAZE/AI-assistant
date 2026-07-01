/**
 * DeepSeek V4 Pro model adapter for the OpenAI Agents SDK.
 *
 * - Model: deepseek-v4-pro (1.6T params, 49B active, 1M context, MIT license)
 * - Per-agent reasoning mode (Non-Think / Think High / Think Max) is read from
 *   the RunContext and translated to DeepSeek's V4 Pro API shape:
 *     Non-Think  → extra_body: { thinking: { type: "disabled" } }
 *     Think High → extra_body: { thinking: { type: "enabled" } }, reasoning_effort: "high"
 *     Think Max  → extra_body: { thinking: { type: "enabled" } }, reasoning_effort: "max"
 * - `delta.reasoning_content` is logged at debug level but NOT forwarded to the client.
 * - Retries transient errors (HTTP 429, 5xx, network) once with exponential backoff.
 */
import OpenAI from "openai";
import type { Model } from "@openai/agents";

export const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";

export type ReasoningMode = "non_think" | "think_high" | "think_max";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
});

/** Translate our internal ReasoningMode → DeepSeek's V4 Pro API shape. */
export function reasoningParams(mode: ReasoningMode) {
  switch (mode) {
    case "non_think":
      return {
        reasoning_effort: undefined,
        extra_body: { thinking: { type: "disabled" } },
      };
    case "think_high":
      return {
        reasoning_effort: "high" as const,
        extra_body: { thinking: { type: "enabled" } },
      };
    case "think_max":
      return {
        reasoning_effort: "max" as const,
        extra_body: { thinking: { type: "enabled" } },
      };
  }
}

/** Sleep helper for backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a chat.completions call with retry on transient errors. */
async function callWithRetry(
  body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  maxAttempts = 3
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await deepseek.chat.completions.create(body);
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      const transient = status === 429 || (status >= 500 && status < 600) || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT";
      if (!transient || attempt === maxAttempts - 1) throw err;
      const wait = 1000 * Math.pow(2, attempt); // 1s, 2s
      console.warn(`[deepseek] transient error (status=${status}), retrying in ${wait}ms (attempt ${attempt + 1}/${maxAttempts})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

type AgentInputItem = unknown;

interface RunContextLike {
  conversationId?: string;
  userId?: string;
  turnId?: string;
  reasoning?: ReasoningMode;
  a2aDepth?: number;
  a2aConsultsThisTurn?: number;
}

/** Convert OpenAI Agents SDK AgentInputItem[] to OpenAI chat messages. */
function itemsToMessages(items: AgentInputItem[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const item of items as any[]) {
    // OpenAI Agents SDK input items: { role, content } or { type, content, ... }
    if (item && typeof item === "object") {
      const role = item.role;
      if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
        // Coerce content to a string for simplicity
        let content: string;
        if (typeof item.content === "string") content = item.content;
        else if (Array.isArray(item.content)) {
          // Walk the content array, pick text parts
          content = item.content
            .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
            .filter(Boolean)
            .join("\n");
        } else content = String(item.content ?? "");
        messages.push({ role, content } as any);
        continue;
      }
      // Tool-result items: { type: "function_result", ... }
      if (item.type === "function_result" || item.type === "function_call_output") {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id ?? item.id ?? "",
          content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
        } as any);
        continue;
      }
      // Function-call items: { type: "function_call", ... } — encode as assistant message with tool_calls
      if (item.type === "function_call" && item.name) {
        const lastMsg = messages[messages.length - 1];
        const toolCall = {
          id: item.call_id ?? item.id ?? "",
          type: "function" as const,
          function: {
            name: item.name,
            arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        };
        if (lastMsg && lastMsg.role === "assistant" && (lastMsg as any).tool_calls) {
          (lastMsg as any).tool_calls.push(toolCall);
        } else {
          messages.push({ role: "assistant", content: "", tool_calls: [toolCall] } as any);
        }
        continue;
      }
    }
    // Fallback: stringify
    messages.push({ role: "user", content: String(item) });
  }
  return messages;
}

/** Collect all tool definitions available in the run (so we can pass them to DeepSeek). */
function collectTools(items: AgentInputItem[]): any[] {
  // The OpenAI Agents SDK does not pass tool definitions to the Model adapter
  // in a uniform way across versions. We rely on the SDK to pass the
  // prepared prompt (which already includes tool definitions in the system
  // message), so the model adapter only needs to send the messages.
  // If your SDK version exposes them differently, attach them here.
  return [];
}

/** Public surface — used by tests. */
export const deepseekAdapter = {
  MODEL,
  reasoningParams,
  itemsToMessages,
};

/** The Model adapter for the OpenAI Agents SDK. */
export const deepseekModel: Model = {
  async getResponse(systemPrompt, input, _modelSettings, _tools, _context) {
    const ctx = (_context as RunContextLike) ?? {};
    const reasoning: ReasoningMode = ctx.reasoning ?? "think_high";
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push(...itemsToMessages(input));

    const params = reasoningParams(reasoning);
    const res = await deepseek.chat.completions.create({
      model: MODEL,
      messages,
      stream: false,
      temperature: 1.0,
      top_p: 1.0,
      ...params,
    } as any);
    const text = res.choices?.[0]?.message?.content ?? "";
    return {
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, providerData: { usage: (res as any).usage } }],
        },
      ],
      usage: (res as any).usage,
    } as any;
  },

  async *streamResponse(systemPrompt, input, _modelSettings, _tools, _context) {
    const ctx = (_context as RunContextLike) ?? {};
    const reasoning: ReasoningMode = ctx.reasoning ?? "think_high";
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push(...itemsToMessages(input));

    const params = reasoningParams(reasoning);
    const stream = await callWithRetry({
      model: MODEL,
      messages,
      stream: true,
      temperature: 1.0,
      top_p: 1.0,
      ...params,
    } as any);

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta as any;
      // Reasoning content: log at debug level, do NOT forward to the client.
      if (delta?.reasoning_content) {
        if (process.env.DEBUG) {
          console.debug(`[deepseek] reasoning: ${delta.reasoning_content}`);
        }
        continue;
      }
      if (delta?.content) {
        yield {
          type: "output_text_delta",
          delta: delta.content,
          providerData: { chunk },
        } as any;
      }
    }
  },
};
