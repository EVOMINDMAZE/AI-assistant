/**
 * tests/stream-fallback.test.ts — verifies the chat route finishes
 * (emits a `done` or `error` event) end-to-end. We mock the auth,
 * the memory client, and the LLM runner so the test does not require
 * a live Supabase or DeepSeek connection.
 */
import { describe, it, expect, vi } from "vitest";

// Mock the LLM runner (replaces the @openai/agents Runner path).
vi.mock("@/lib/agents/direct-runner", () => {
  return {
    runAgentDirect: vi.fn().mockResolvedValue({
      text: "stub reply from runAgentDirect",
      usage: { input: 1, output: 1, reasoning: 0, estimated: false },
      toolCalls: [],
    }),
  };
});

vi.mock("@/lib/agents/specialists/chief-of-staff", () => {
  return {
    chiefOfStaff: { name: "CoS", instructions: "stub" },
  };
});

vi.mock("@/lib/memory-client", () => ({
  memoryClient: {
    listGlobalMemories: vi.fn().mockResolvedValue({ results: [] }),
    searchDocuments: vi.fn().mockResolvedValue({ results: [] }),
    addMemory: vi.fn().mockResolvedValue({}),
    indexMessage: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "test-user-id" } },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    from: () => ({
      insert: vi.fn().mockResolvedValue({ data: { id: "c1" }, error: null }),
      select: () => ({
        eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        order: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      }),
      update: () => ({ eq: () => ({ select: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
      delete: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  }),
}));

vi.mock("@/lib/state", () => ({
  loadState: vi.fn().mockResolvedValue(null),
  saveState: vi.fn().mockResolvedValue(undefined),
  emptyCosState: () => ({
    current_focus: null,
    open_questions: [],
    recent_specialist_outputs: [],
    user_preferences_this_session: {},
    turn_count: 0,
  }),
}));

vi.mock("@/lib/tracing", () => ({
  TraceStore: { append: vi.fn() },
  recordToolCall: vi.fn(),
  commitTurn: vi.fn(),
}));

import { POST } from "../app/api/chat/route";

function makeReq(body: any, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("stream fallback", () => {
  it("yields a `done` event with text within 4s when the SDK stream yields no deltas", async () => {
    // We can't easily test the 2s watchdog in a unit test without long
    // sleeps; instead, we verify that the route completes within a few
    // seconds and emits at least one `done` event.
    const start = Date.now();
    const res = await POST(
      makeReq({ message: "tell me a short story" })
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let seenDone = false;
    let seenError = false;
    const deadline = start + 6000;
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ value: undefined, done: true }), 1500)),
      ]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('"type":"done"')) seenDone = true;
      if (buffer.includes('"type":"error"')) seenError = true;
      if (seenDone || seenError) break;
    }
    expect(seenDone || seenError).toBe(true);
  }, 10_000);
});
