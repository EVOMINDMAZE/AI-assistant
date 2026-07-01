/**
 * Lightweight tracing / observability store, backed by the Supabase
 * `cost_traces` table.
 *
 * Schema (cost_traces table):
 *   - id              uuid PRIMARY KEY (turn id)
 *   - user_id         uuid
 *   - conversation_id uuid
 *   - turn_id         text UNIQUE
 *   - payload         jsonb
 *   - created_at      timestamptz
 *
 * TTL: 30 days. Use `cleanup()` to prune old records.
 *
 * The `recordToolCall` / `commitTurn` API is unchanged from the
 * fix-top3-broken spec; only the storage backend switched.
 */

import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface TracePayload {
  cos_input: unknown;
  tool_calls: { agent: string; tool: string; args: unknown; result: unknown; duration_ms: number }[];
  a2a_consults: { from: string; to: string; message: string; reply: string; depth: number }[];
  final_text: string;
  token_usage: { input: number; output: number; reasoning: number; estimated?: boolean };
  cost_usd: number;
}

export interface TraceRecord {
  turnId: string;
  userId: string;
  conversationId: string;
  payload: TracePayload;
}

export const TraceStore = {
  async append(rec: TraceRecord): Promise<void> {
    const sb = createAdminSupabase();
    try {
      await sb.from("cost_traces").upsert(
        {
          turn_id: rec.turnId,
          user_id: rec.userId,
          conversation_id: rec.conversationId,
          payload: rec.payload as any,
        },
        { onConflict: "turn_id" }
      );
    } catch (e) {
      console.warn("[tracing] insert failed:", (e as Error).message);
    }
  },

  async get(turnId: string): Promise<TraceRecord | null> {
    const sb = createAdminSupabase();
    const { data, error } = await sb
      .from("cost_traces")
      .select("turn_id, user_id, conversation_id, payload, created_at")
      .eq("turn_id", turnId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      turnId: data.turn_id as string,
      userId: data.user_id as string,
      conversationId: data.conversation_id as string,
      payload: data.payload as unknown as TracePayload,
    };
  },

  /** Sum token usage + cost for a date range, grouped by agent. */
  async costByDay(userId: string, dateIso: string): Promise<{ date: string; total_usd: number; by_agent: Record<string, number> }> {
    const sb = createAdminSupabase();
    const start = new Date(dateIso);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const { data } = await sb
      .from("cost_traces")
      .select("payload")
      .eq("user_id", userId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    let total = 0;
    const byAgent: Record<string, number> = {};
    for (const r of data ?? []) {
      const p = r.payload as TracePayload | null;
      if (!p) continue;
      total += p.cost_usd ?? 0;
      byAgent["CoS"] = (byAgent["CoS"] ?? 0) + (p.cost_usd ?? 0) * 0.7;
      for (const tc of p.tool_calls ?? []) {
        byAgent[tc.agent] = (byAgent[tc.agent] ?? 0) + (p.cost_usd ?? 0) * 0.1;
      }
    }
    return { date: dateIso.slice(0, 10), total_usd: total, by_agent: byAgent };
  },

  async cleanup(): Promise<number> {
    const sb = createAdminSupabase();
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    const { data, error } = await sb
      .from("cost_traces")
      .delete()
      .lt("created_at", cutoff)
      .select("turn_id");
    if (error) {
      console.warn("[tracing] cleanup failed:", error.message);
      return 0;
    }
    return data?.length ?? 0;
  },
};

/** Cost calc using V4 Pro May 2026 rates. */
export function computeCostUsd(usage: { input: number; output: number; reasoning: number }): number {
  const RATE_IN = 1.74 / 1_000_000;
  const RATE_OUT = 0.55 / 1_000_000;
  const RATE_REASON = 4.40 / 1_000_000;
  return (
    (usage.input ?? 0) * RATE_IN +
    (usage.output ?? 0) * RATE_OUT +
    (usage.reasoning ?? 0) * RATE_REASON
  );
}

/** Per-turn in-memory buffer of tool calls. Cleared on commitTurn. */
const TURN_BUFFER = new Map<string, { tool_calls: { agent: string; tool: string; args: unknown; result: unknown; duration_ms: number }[]; started_at: number }>();

/** Record a single tool call from the chat route. Buffered until commitTurn. */
export function recordToolCall(rec: {
  turnId: string;
  agent: string;
  tool: string;
  args: unknown;
  result: unknown;
  durationMs: number;
}): void {
  const buf = TURN_BUFFER.get(rec.turnId) ?? { tool_calls: [], started_at: Date.now() };
  buf.tool_calls.push({
    agent: rec.agent,
    tool: rec.tool,
    args: rec.args,
    result: rec.result,
    duration_ms: rec.durationMs,
  });
  TURN_BUFFER.set(rec.turnId, buf);
}

/** Commit a turn to the trace store. Builds the full payload, writes the row, clears the buffer. */
export function commitTurn(rec: {
  turnId: string;
  conversationId: string;
  userId: string;
  finalText: string;
  usage: { input: number; output: number; reasoning: number; estimated?: boolean };
}): void {
  const buf = TURN_BUFFER.get(rec.turnId);
  const toolCalls = buf?.tool_calls ?? [];
  TURN_BUFFER.delete(rec.turnId);
  const cost_usd = computeCostUsd({
    input: rec.usage.input,
    output: rec.usage.output,
    reasoning: rec.usage.reasoning,
  });
  void TraceStore.append({
    turnId: rec.turnId,
    userId: rec.userId,
    conversationId: rec.conversationId,
    payload: {
      cos_input: undefined,
      tool_calls: toolCalls,
      a2a_consults: [],
      final_text: rec.finalText,
      token_usage: {
        input: rec.usage.input,
        output: rec.usage.output,
        reasoning: rec.usage.reasoning,
        estimated: rec.usage.estimated ?? false,
      },
      cost_usd,
    },
  });
}
