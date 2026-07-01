/**
 * tests/messaging.test.ts — postMessage / markReplied / listTurnMessages.
 * Backed by Supabase (mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
      async select(_cols: string) {
        return {
          eq() { return this; },
          order() {
            return { data: store[name] ?? [], error: null };
          },
        };
      },
      async update(patch: any) {
        return {
          eq(_col: string, _val: any) {
            return {
              async select() {
                const items = store[name] ?? [];
                if (items.length === 0) return { data: null, error: null };
                Object.assign(items[0], patch);
                return { data: items[0], error: null };
              },
            };
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

describe("agent_messages (Supabase)", () => {
  it("postMessage inserts a pending row", async () => {
    const row = await postMessage({
      conversation_id: "c1",
      turn_id: "t1",
      from_agent: "CoS",
      to_agent: "CTO",
      message: "hi",
    });
    expect(row.status).toBe("pending");
  });

  it("markReplied updates status to replied", async () => {
    const row = await postMessage({
      conversation_id: "c1",
      turn_id: "t1",
      from_agent: "CoS",
      to_agent: "CTO",
      message: "hi",
    });
    const updated = await markReplied(row.id, "ack");
    expect(updated.status).toBe("replied");
    expect(updated.reply).toBe("ack");
  });

  it("listTurnMessages returns all rows for a turn", async () => {
    await postMessage({ conversation_id: "c1", turn_id: "t1", from_agent: "CoS", to_agent: "CTO", message: "a" });
    await postMessage({ conversation_id: "c1", turn_id: "t1", from_agent: "CTO", to_agent: "CSO", message: "b" });
    await postMessage({ conversation_id: "c1", turn_id: "t2", from_agent: "CoS", to_agent: "CTO", message: "c" });
    const rows = await listTurnMessages("t1");
    expect(rows.length).toBe(2);
  });
});
