/**
 * tests/auth-store.test.ts — verify create / lookup / expire-and-cleanup
 * against a mock PocketBase.
 */
import { describe, it, expect } from "vitest";
import { createSession, lookupSession, deleteSession, cleanupExpiredSessions } from "../lib/auth-store";
import type PocketBase from "pocketbase";

function makeMockPb() {
  const store: Record<string, any[]> = {};
  return {
    collection(name: string) {
      return {
        async getList(_page: number, _per: number, opts: { filter: string }) {
          const items = store[name] ?? [];
          const filtered = items.filter((i) => matches(i, opts.filter));
          return { items: filtered };
        },
        async create(data: any) {
          store[name] = store[name] ?? [];
          const id = Math.random().toString(36).slice(2);
          const row = { id, ...data };
          store[name].push(row);
          return row;
        },
        async delete(id: string) {
          store[name] = (store[name] ?? []).filter((i) => i.id !== id);
        },
      };
    },
    _store: store,
  } as unknown as PocketBase & { _store: Record<string, any[]> };
}

function matches(item: any, filter: string): boolean {
  // Tiny PB-filter parser: a="x" && b<"y" && b>"z"
  const clauses = filter.split("&&").map((c) => c.trim());
  return clauses.every((c) => {
    const eq = c.match(/^(\w+)="([^"]+)"$/);
    if (eq) return String(item[eq[1]]) === eq[2];
    const lt = c.match(/^(\w+)\s*<\s*"([^"]+)"$/);
    if (lt) {
      const left = item[lt[1]];
      const right = lt[2];
      if (lt[1] === "expires_at" || lt[1].endsWith("_at")) {
        return new Date(left).getTime() < new Date(right).getTime();
      }
      return String(left) < right;
    }
    return true;
  });
}

vi.mock("@/lib/pocketbase", () => ({
  pbAsAdmin: vi.fn().mockImplementation(() => mockPb),
}));

import { vi } from "vitest";
let mockPb: any;

describe("auth-store", () => {
  it("createSession returns a token + expiry 60 days from now", async () => {
    mockPb = makeMockPb();
    const before = Date.now();
    const s = await createSession({ userId: "u1", ttlDays: 60 });
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    expect(s.userId).toBe("u1");
    const expiresMs = new Date(s.expiresAt).getTime();
    expect(expiresMs).toBeGreaterThan(before + 59 * 24 * 60 * 60 * 1000);
    expect(expiresMs).toBeLessThan(before + 61 * 24 * 60 * 60 * 1000);
  });

  it("lookupSession returns the session for a valid token", async () => {
    mockPb = makeMockPb();
    const s = await createSession({ userId: "u2", ttlDays: 60 });
    const got = await lookupSession(s.token);
    expect(got).not.toBeNull();
    expect(got!.userId).toBe("u2");
  });

  it("lookupSession returns null and deletes the row when expires_at is in the past", async () => {
    mockPb = makeMockPb();
    // Insert a session that's already expired
    const expired = {
      id: "x1",
      token: "expiredtoken",
      user_id: "u3",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    mockPb._store["auth_sessions"] = [expired];
    const got = await lookupSession("expiredtoken");
    expect(got).toBeNull();
    // Row should have been deleted
    expect(mockPb._store["auth_sessions"].find((r) => r.id === "x1")).toBeUndefined();
  });

  it("deleteSession removes the row", async () => {
    mockPb = makeMockPb();
    const s = await createSession({ userId: "u4", ttlDays: 60 });
    expect((await lookupSession(s.token))?.userId).toBe("u4");
    await deleteSession(s.token);
    expect(await lookupSession(s.token)).toBeNull();
  });

  it("cleanupExpiredSessions deletes all expired rows", async () => {
    mockPb = makeMockPb();
    mockPb._store["auth_sessions"] = [
      { id: "a", token: "valid", user_id: "u", expires_at: new Date(Date.now() + 1e9).toISOString() },
      { id: "b", token: "expired1", user_id: "u", expires_at: new Date(Date.now() - 1e6).toISOString() },
      { id: "c", token: "expired2", user_id: "u", expires_at: new Date(Date.now() - 1e6).toISOString() },
    ];
    const removed = await cleanupExpiredSessions();
    expect(removed).toBe(2);
    expect(mockPb._store["auth_sessions"].length).toBe(1);
  });
});
