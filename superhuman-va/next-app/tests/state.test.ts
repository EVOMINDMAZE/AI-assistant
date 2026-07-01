/**
 * tests/state.test.ts — state load/save round-trip + unique enforcement.
 *
 * The unique-per-(conv, agent) enforcement is enforced by PocketBase itself;
 * this test verifies our helper's round-trip against a mock PB.
 */
import { describe, it, expect, vi } from "vitest";
import { loadState, saveState, emptyCosState } from "../next-app/lib/state";
import type PocketBase from "pocketbase";

function makeMockPb() {
  const store: Record<string, any[]> = {};
  return {
    collection(name: string) {
      return {
        async getList(_page: number, _per: number, opts: { filter: string }) {
          const items = store[name] ?? [];
          const filtered = items.filter((i) => matchesFilter(i, opts.filter));
          return { items: filtered };
        },
        async create(data: any) {
          store[name] = store[name] ?? [];
          const id = Math.random().toString(36).slice(2);
          const row = { id, ...data, created: new Date().toISOString() };
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

function matchesFilter(item: any, filter: string): boolean {
  // very small PB-filter parser: only handles "a=\"x\" && b=\"y\""
  const clauses = filter.split("&&").map((c) => c.trim());
  return clauses.every((c) => {
    const m = c.match(/^(\w+)="([^"]+)"$/);
    if (!m) return true;
    return String(item[m[1]]) === m[2];
  });
}

describe("state load/save", () => {
  it("round-trips a state object", async () => {
    const pb = makeMockPb();
    const convId = "conv-1";
    const initial = { ...emptyCosState(), current_focus: "test focus" };
    await saveState(pb, convId, "CoS", initial);
    const loaded = await loadState(pb, convId, "CoS");
    expect(loaded?.current_focus).toBe("test focus");
  });

  it("returns null for unknown (conv, agent)", async () => {
    const pb = makeMockPb();
    const loaded = await loadState(pb, "nope", "CoS");
    expect(loaded).toBeNull();
  });

  it("last write wins on update", async () => {
    const pb = makeMockPb();
    const convId = "conv-1";
    await saveState(pb, convId, "CoS", { ...emptyCosState(), current_focus: "first" });
    await saveState(pb, convId, "CoS", { ...emptyCosState(), current_focus: "second" });
    const loaded = await loadState(pb, convId, "CoS");
    expect(loaded?.current_focus).toBe("second");
  });
});
