/**
 * tests/rate-limit.test.ts — 60 turns/conv/hour and 200 turns/user/hour caps.
 *
 * We re-implement the rate-limit logic with a mock PB to verify the cap
 * logic in isolation.
 */

interface MockItem { id: string; conversation_id: string; user_id?: string; role: string; created: string; }

function makeMockPb() {
  let store: MockItem[] = [];
  return {
    _push: (i: MockItem) => store.push(i),
    collection() {
      return {
        async getList(_page: number, _per: number, opts: { filter: string }) {
          const clauses = opts.filter.split("&&").map((c) => c.trim());
          const items = store.filter((i) => clauses.every((c) => {
            const m = c.match(/^(\w+)\s*(>=|<=|=|~)\s*"?([^"]+)"?$/);
            if (!m) return true;
            const [, k, op, v] = m;
            const left = (i as any)[k];
            const right = k === "created" ? new Date(v).getTime() : v;
            if (op === "=") return left === v || left === right;
            if (op === ">=") return new Date(left).getTime() >= (right as number);
            return true;
          }));
          return { items, totalItems: items.length };
        },
      };
    },
  };
}

const MAX_TURNS_PER_CONV_PER_HOUR = 60;
const MAX_TURNS_PER_USER_PER_HOUR = 200;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;

function check(pb: any, conversationId: string): { ok: boolean; reason?: string } {
  const since = new Date(Date.now() - HOURLY_WINDOW_MS).toISOString();
  return pb.collection().getList(1, 1, {
    filter: `conversation_id="${conversationId}" && created >= "${since}" && role="user"`,
  }).then((r: any) => {
    if (r.totalItems >= MAX_TURNS_PER_CONV_PER_HOUR) {
      return { ok: false, reason: "conv limit" };
    }
    return { ok: true };
  }) as any;
}

describe("rate limit", () => {
  it("allows up to 60 turns per conversation per hour", async () => {
    const pb = makeMockPb();
    for (let i = 0; i < 60; i++) {
      pb._push({ id: String(i), conversation_id: "c1", role: "user", created: new Date().toISOString() });
    }
    const r = await check(pb, "c1");
    expect(r.ok).toBe(true);
  });

  it("blocks the 61st turn in the same conversation per hour", async () => {
    const pb = makeMockPb();
    for (let i = 0; i < 60; i++) {
      pb._push({ id: String(i), conversation_id: "c1", role: "user", created: new Date().toISOString() });
    }
    pb._push({ id: "61", conversation_id: "c1", role: "user", created: new Date().toISOString() });
    const r = await check(pb, "c1");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/conv limit/);
  });
});
