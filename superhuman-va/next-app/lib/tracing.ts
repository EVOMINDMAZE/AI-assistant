/**
 * Lightweight tracing / observability store.
 *
 * Every turn appends a JSON record to a local SQLite database at
 * /var/lib/superhuman-va/traces.db. If `better-sqlite3` is not available
 * (e.g. during local dev), the trace falls back to a JSONL file at
 * /tmp/superhuman-va-traces.jsonl.
 *
 * Schema (traces table):
 *   - id          TEXT PRIMARY KEY (turn id)
 *   - ts          INTEGER (ms since epoch)
 *   - user_id     TEXT
 *   - conversation_id TEXT
 *   - payload     TEXT (JSON: input, tool calls, A2A consults, final text, token usage)
 *
 * TTL: 30 days. Use `cleanup()` to prune old records.
 *
 * CLI: `pnpm trace list --turn <turnId>` (see scripts/trace.ts).
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync, readdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";

const TRACE_DIR = process.env.TRACE_DIR || "/var/lib/superhuman-va";
const TRACE_DB_PATH = join(TRACE_DIR, "traces.db");
const TRACE_FALLBACK_PATH = "/tmp/superhuman-va-traces.jsonl";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

let db: any = null;
let useFallback = false;

interface TracePayload {
  cos_input: unknown;
  tool_calls: { agent: string; tool: string; args: unknown; result: unknown; duration_ms: number }[];
  a2a_consults: { from: string; to: string; message: string; reply: string; depth: number }[];
  final_text: string;
  token_usage: { input: number; output: number; reasoning: number };
  cost_usd: number;
}

function ensureDb() {
  if (db || useFallback) return;
  try {
    // Dynamic require so the dependency is optional
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    if (!existsSync(TRACE_DIR)) mkdirSync(TRACE_DIR, { recursive: true });
    db = new Database(TRACE_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        user_id TEXT,
        conversation_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_traces_ts ON traces(ts);
      CREATE INDEX IF NOT EXISTS idx_traces_conv ON traces(conversation_id);
    `);
    const insert = db.prepare(
      "INSERT OR REPLACE INTO traces (id, ts, user_id, conversation_id, payload) VALUES (?, ?, ?, ?, ?)"
    );
    db.insert = insert;
  } catch (e) {
    console.warn("[tracing] better-sqlite3 not available, using JSONL fallback:", (e as Error).message);
    useFallback = true;
  }
}

export interface TraceRecord {
  turnId: string;
  userId: string;
  conversationId: string;
  payload: TracePayload;
}

export const TraceStore = {
  append(rec: TraceRecord): void {
    ensureDb();
    const row = {
      id: rec.turnId,
      ts: Date.now(),
      user_id: rec.userId,
      conversation_id: rec.conversationId,
      payload: JSON.stringify(rec.payload),
    };
    if (db) {
      try {
        db.insert.run(row.id, row.ts, row.user_id, row.conversation_id, row.payload);
      } catch (e) {
        console.warn("[tracing] insert failed:", (e as Error).message);
      }
    } else if (useFallback) {
      try {
        appendFileSync(TRACE_FALLBACK_PATH, JSON.stringify(row) + "\n");
      } catch (e) {
        console.warn("[tracing] fallback write failed:", (e as Error).message);
      }
    }
  },

  get(turnId: string): TraceRecord | null {
    ensureDb();
    if (!db) return null;
    try {
      const row = db
        .prepare("SELECT id, ts, user_id, conversation_id, payload FROM traces WHERE id = ?")
        .get(turnId);
      if (!row) return null;
      return {
        turnId: row.id,
        userId: row.user_id,
        conversationId: row.conversation_id,
        payload: JSON.parse(row.payload),
      };
    } catch {
      return null;
    }
  },

  /** Sum token usage + cost for a date range, grouped by agent. */
  costByDay(dateIso: string): { date: string; total_usd: number; by_agent: Record<string, number> } {
    ensureDb();
    const start = new Date(dateIso);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const startMs = start.getTime();
    const endMs = end.getTime();

    let total = 0;
    const byAgent: Record<string, number> = {};

    if (db) {
      const rows = db
        .prepare("SELECT payload FROM traces WHERE ts >= ? AND ts < ?")
        .all(startMs, endMs) as { payload: string }[];
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload) as TracePayload;
          total += p.cost_usd ?? 0;
          for (const tc of p.tool_calls ?? []) {
            // Heuristic: attribute a portion of cost to the calling agent
            const frac = 0.1;
            byAgent[tc.agent] = (byAgent[tc.agent] ?? 0) + (p.cost_usd ?? 0) * frac;
          }
          // CoS gets the remainder
          byAgent["CoS"] = (byAgent["CoS"] ?? 0) + (p.cost_usd ?? 0) * 0.7;
        } catch {}
      }
    } else if (useFallback) {
      try {
        const text = readFileSync(TRACE_FALLBACK_PATH, "utf8");
        for (const line of text.split("\n")) {
          if (!line) continue;
          try {
            const r = JSON.parse(line);
            if (r.ts >= startMs && r.ts < endMs) {
              const p = JSON.parse(r.payload) as TracePayload;
              total += p.cost_usd ?? 0;
            }
          } catch {}
        }
      } catch {}
    }
    return { date: dateIso.slice(0, 10), total_usd: total, by_agent: byAgent };
  },

  cleanup(): number {
    ensureDb();
    const cutoff = Date.now() - TTL_MS;
    if (db) {
      const info = db.prepare("DELETE FROM traces WHERE ts < ?").run(cutoff);
      return Number(info.changes ?? 0);
    } else if (useFallback) {
      try {
        const text = readFileSync(TRACE_FALLBACK_PATH, "utf8");
        const kept = text
          .split("\n")
          .filter((line) => {
            if (!line) return false;
            try {
              return JSON.parse(line).ts >= cutoff;
            } catch {
              return false;
            }
          })
          .join("\n");
        const removed = text.split("\n").length - kept.split("\n").length;
        require("fs").writeFileSync(TRACE_FALLBACK_PATH, kept);
        return Math.max(0, removed);
      } catch {
        return 0;
      }
    }
    return 0;
  },
};

/** Cost calc using V4 Pro May 2026 rates. */
export function computeCostUsd(usage: { input: number; output: number; reasoning: number }): number {
  const RATE_IN = 1.74 / 1_000_000;   // $1.74 per 1M input tokens
  const RATE_OUT = 0.55 / 1_000_000;  // $0.55 per 1M output tokens
  const RATE_REASON = 4.40 / 1_000_000; // $4.40 per 1M reasoning tokens
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
  TraceStore.append({
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
