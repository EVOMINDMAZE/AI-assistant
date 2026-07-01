/**
 * tests/messaging.test.ts — postMessage / markReplied / listTurnMessages.
 */
import { describe, it, expect } from "vitest";
import { postMessage, markReplied, listTurnMessages } from "../next-app/lib/messaging";
import type PocketBase from "pocketbase";

function makeMockPb() {
  const store: Record<string, any[]> = {};
  return {
    collection(name: string) {
      return {
        async getList(_page: number, _per: number, opts: { filter: string; sort?: string }) {
          let items = store[name] ?? [];
          if (opts.filter) {
            const clauses = opts.filter.split("&&").map((c) => c.trim());
            items = items.filter((i) => clauses.every((c) => {
              const m = c.match(/^(\w+)\s*=\s*"([^"]+)"$/);
              return m ? String(i[m[1]]) === m[2] : true;
            }));
          }
          return { items };
        },
        async create(data: any) {
          store[name] = store[name] ?? [];
          const id = Math.random().toString(36).slice(2);
          const row = { id, ...data, status: data.status ?? "pending", created: new Date().toISOString() };
          store[name].push(row);
          return row;
        },
        async update(id: string, data: any) {
          const items = store[name] ?? [];
          const idx = items.findIndex((i) => i.id === id);
          if (idx === -1) throw new Error("not found");
          items[idx] = { ...items[idx], ...data };
          return items[idx];
        },
      };
    },
  } as unknown as PocketBase;
}

describe("agent_messages", () => {
  it("postMessage inserts a pending row", async () => {
    const pb = makeMockPb();
    const row = await postMessage(pb, {
      conversation_id: "c1",
      turn_id: "t1",
      from_agent: "CoS",
      to_agent: "CTO",
      message: "hi",
    });
    expect(row.status).toBe("pending");
  });

  it("markReplied updates status to replied", async () => {
    const pb = makeMockPb();
    const row = await postMessage(pb, {
      conversation_id: "c1",
      turn_id: "t1",
      from_agent: "CoS",
      to_agent: "CTO",
      message: "hi",
    });
    const updated = await markReplied(pb, row.id, "ack");
    expect(updated.status).toBe("replied");
    expect(updated.reply).toBe("ack");
  });

  it("listTurnMessages returns all rows for a turn", async () => {
    const pb = makeMockPb();
    await postMessage(pb, { conversation_id: "c1", turn_id: "t1", from_agent: "CoS", to_agent: "CTO", message: "a" });
    await postMessage(pb, { conversation_id: "c1", turn_id: "t1", from_agent: "CTO", to_agent: "CSO", message: "b" });
    await postMessage(pb, { conversation_id: "c1", turn_id: "t2", from_agent: "CoS", to_agent: "CTO", message: "c" });
    const rows = await listTurnMessages(pb, "t1");
    expect(rows.length).toBe(2);
  });
});
