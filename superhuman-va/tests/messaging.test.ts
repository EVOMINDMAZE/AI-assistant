/**
 * tests/messaging.test.ts — postMessage / markReplied / listTurnMessages.
 *
 * Mocks @/lib/supabase/admin (the new Supabase-backed store).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory mock store
const store: Record<string, any[]> = {};
const mockClient = {
  from(name: string) {
    return {
      async insert(data: any) {
        const row = { id: Math.random().toString(36).slice(2), ...data };
        store[name] = store[name] ?? [];
        store[name].push(row);
        return { data: row, error: null };
      },
      async update(patch: any) {
        return {
          eq(col: string, val: any) {
            return {
              async select() {
                const rows = store[name] ?? [];
                const filtered = rows.filter((r) => r[col] === val);
                if (filtered.length === 0) return { data: null, error: null };
                Object.assign(filtered[0], patch);
                return { data: filtered[0], error: null };
              },
            };
          },
        };
      },
      async select() {
        return {
          eq() {
            return this;
          },
          order() {
            return { data: store[name] ?? [], error: null };
          },
        };
      },
    };
  },
};

vi.mock("../next-app/lib/supabase/admin", () => ({
  createAdminSupabase: () => mockClient,
}));

import { postMessage, markReplied, listTurnMessages } from "../next-app/lib/messaging";

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe("messaging (Supabase-backed)", () => {
  it("postMessage inserts with status=pending", async () => {
    const row = await postMessage({
      conversation_id: "c1",
      turn_id: "t1",
      from_agent: "CoS",
      to_agent: "CTO",
      message: "what's our stack?",
    });
    expect(row.status).toBe("pending");
    expect(row.from_agent).toBe("CoS");
    expect(row.to_agent).toBe("CTO");
  });

  it("markReplied sets status=replied + reply text", async () => {
    const row = await postMessage({
      conversation_id: "c1",
      turn_id: "t1",
      from_agent: "CoS",
      to_agent: "CTO",
      message: "what's our stack?",
    });
    const updated = await markReplied(row.id, "Next.js + Supabase");
    expect(updated.status).toBe("replied");
    expect(updated.reply).toBe("Next.js + Supabase");
  });

  it("listTurnMessages returns rows for the turn", async () => {
    await postMessage({ conversation_id: "c1", turn_id: "t1", from_agent: "CoS", to_agent: "CTO", message: "a" });
    await postMessage({ conversation_id: "c1", turn_id: "t1", from_agent: "CTO", to_agent: "CFO", message: "b" });
    const rows = await listTurnMessages("t1");
    expect(rows.length).toBe(2);
    expect(rows[0].turn_id).toBe("t1");
  });
});
