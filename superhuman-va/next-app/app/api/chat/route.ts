// POST /api/chat
//
// CoS-driven streaming chat endpoint (V2). Flow:
//   1. Ensure conversation exists in Supabase.
//   2. Parallel: load history, load CoS agent_state, load global facts, search
//      pgvector docs, rate-limit check.
//   3. Build the CoS input with: system prompt (with GLOBAL FACTS + WORKING
//      MEMORY injected), history, user message.
//   4. Run Runner.runStreamed(coS, input, { context: { conversationId,
//      userId, turnId, reasoning: "think_high", fromAgent: "CoS" } }).
//   5. Translate SDK stream events into the SSE event types in
//      lib/agent-types.ts: meta, token, tool_start, tool_done, handoff,
//      agent_message, code_run, conflict, conflict_resolved, error, done.
//   6. Persist user + assistant messages, agent_state (last write wins),
//      agent_messages rows, cost_traces row.
//   7. Fire-and-forget Mem0 add for cross-conversation fact extraction.
//
// Supports POST { kind: "conflict_resolution", conflictId, choice } for the
// resume branch after the user picks from a ConflictCard.
//
// Supports POST { kind: "forget_everything" } to purge all user data.

import "server-only";
import { NextRequest } from "next/server";
import { ulid } from "ulid";
import { getResponseSync } from "@/lib/agents/model";
import { memoryClient } from "@/lib/memory-client";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { loadState, saveState, emptyCosState } from "@/lib/state";
import { commitTurn } from "@/lib/tracing";
import type { ChatMessage } from "@/lib/types";
import type { CosState, SSEEvent } from "@/lib/agent-types";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Pro
export const dynamic = "force-dynamic";

const SMALL_TALK = /^(hi|hey|hello|yo|thanks|thank you|ok|okay|lol|bye|goodbye|good morning|good night|sup|hola)[\s!.]*$/i;

// ─── Rate-limit caps (per spec T1.2) ───────────────────────────────────────
const MAX_TURNS_PER_CONV_PER_HOUR = 60;
const MAX_TURNS_PER_USER_PER_HOUR = 200;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;

// ─── Per-process in-memory SSE event buffer for resumption (T2.6) ──────────
type BufferedEvent = { id: number; conversationId: string; event: SSEEvent };
const SSE_BUFFER = new Map<string, BufferedEvent[]>();
const SSE_BUFFER_TTL_MS = 5 * 60 * 1000;
const SSE_BUFFER_MAX = 5000;
let sseSeq = 0;

function bufferEvent(conversationId: string, event: SSEEvent): number {
  sseSeq += 1;
  const id = sseSeq;
  const list = SSE_BUFFER.get(conversationId) ?? [];
  list.push({ id, conversationId, event });
  if (list.length > SSE_BUFFER_MAX) list.splice(0, list.length - SSE_BUFFER_MAX);
  SSE_BUFFER.set(conversationId, list);
  setTimeout(() => {
    const cur = SSE_BUFFER.get(conversationId);
    if (cur) SSE_BUFFER.set(conversationId, cur.filter((e) => Date.now() - e.id < SSE_BUFFER_TTL_MS));
    if (SSE_BUFFER.get(conversationId)?.length === 0) SSE_BUFFER.delete(conversationId);
  }, SSE_BUFFER_TTL_MS).unref?.();
  return id;
}

function replaySince(conversationId: string, lastEventId: number): BufferedEvent[] {
  const list = SSE_BUFFER.get(conversationId) ?? [];
  return list.filter((e) => e.id > lastEventId);
}

// ─── SSE writer ────────────────────────────────────────────────────────────
function makeSseWriter() {
  const encoder = new TextEncoder();
  return {
    encode(eventId: number, event: SSEEvent): Uint8Array {
      const payload = `id: ${eventId}\ndata: ${JSON.stringify(event)}\n\n`;
      return encoder.encode(payload);
    },
  };
}

// ─── Rate-limit check ──────────────────────────────────────────────────────
async function checkRateLimit(
  conversationId: string,
  userId: string,
  isSmallTalk: boolean
): Promise<{ ok: true } | { ok: false; reason: string; scope: "conv" | "user" }> {
  if (isSmallTalk) return { ok: true };
  const sb = createAdminSupabase();
  const sinceIso = new Date(Date.now() - HOURLY_WINDOW_MS).toISOString();
  try {
    const { count: convCount } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .gte("created_at", sinceIso);
    if ((convCount ?? 0) >= MAX_TURNS_PER_CONV_PER_HOUR) {
      return { ok: false, reason: "conversation rate limit exceeded (60/conv/hour)", scope: "conv" };
    }
    const { count: userCount } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", sinceIso);
    if ((userCount ?? 0) >= MAX_TURNS_PER_USER_PER_HOUR) {
      return { ok: false, reason: "user rate limit exceeded (200/user/hour)", scope: "user" };
    }
  } catch (err) {
    console.warn("[chat] rate-limit check failed, allowing:", err);
  }
  return { ok: true };
}

// ─── Build CoS system prompt with injected context ──────────────────────────
function buildCosSystemPrompt(
  basePrompt: string,
  globalFacts: { fact: string }[],
  state: CosState | null
): string {
  const factsBlock = globalFacts.length
    ? globalFacts.map((f, i) => `${i + 1}. ${f.fact}`).join("\n")
    : "(no global facts yet)";
  const stateBlock = state
    ? `current_focus: ${state.current_focus ?? "(none)"}\n` +
      `open_questions: ${state.open_questions?.join("; ") || "(none)"}\n` +
      `recent_specialist_outputs: ${JSON.stringify(state.recent_specialist_outputs ?? [])}\n` +
      `user_preferences_this_session: ${JSON.stringify(state.user_preferences_this_session ?? {})}\n` +
      `turn_count: ${state.turn_count ?? 0}`
    : "(no working memory yet — this is the first turn)";
  return (
    basePrompt +
    `\n\n# GLOBAL FACTS\n${factsBlock}\n\n` +
    `# WORKING MEMORY\n${stateBlock}\n`
  );
}

// ─── Fast-path small-talk reply ────────────────────────────────────────────
const SMALL_TALK_REPLIES = [
  "Hey! What's on your mind?",
  "Hi there — ready when you are.",
  "Hello!",
  "Hey 🙂",
  "What's up?",
];
function smallTalkReply(msg: string): string {
  const m = msg.trim().toLowerCase();
  if (/^(hi|hey|hello|yo|hola|sup|good morning|good night)/i.test(m)) return SMALL_TALK_REPLIES[Math.floor(Math.random() * 3)];
  if (/^(thanks|thank you)/i.test(m)) return "You're welcome!";
  if (/^(ok|okay)/i.test(m)) return "Got it.";
  if (/^(lol)/i.test(m)) return "😄";
  if (/^(bye|goodbye)/i.test(m)) return "Talk soon!";
  return "Hey!";
}

// ─── POST /api/chat ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (body?.kind === "conflict_resolution") {
    return handleConflictResolution(body);
  }
  if (body?.kind === "forget_everything") {
    return handleForgetEverything(body);
  }

  const message: string = (body.message ?? "").trim();
  const userId: string = body.userId || process.env.USER_ID || "local-user";
  if (!message) return new Response("Empty message", { status: 400 });

  // ── Conversation bootstrap ──
  let conversationId: string | null = body.conversationId ?? null;
  try {
    const sb = createAdminSupabase();
    if (!conversationId) {
      const { data, error } = await sb
        .from("conversations")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ user_id: userId, title: message.slice(0, 60) } as any)
        .select("id")
        .single();
      if (error) throw error;
      conversationId = (data as any)!.id;
    } else {
      await sb.from("conversations").update({ updated_at: new Date().toISOString() } as any).eq("id", conversationId);
    }
  } catch (err) {
    console.error("[chat] Supabase conv init failed", err);
    return new Response("Database unavailable", { status: 503 });
  }

  const turnId = ulid();
  const isSmallTalk = SMALL_TALK.test(message);
  const lastEventIdHeader = req.headers.get("Last-Event-Id");
  const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;

  // ── Rate limit check ──
  if (!conversationId) {
    return new Response("Conversation unavailable", { status: 503 });
  }
  const rl = await checkRateLimit(conversationId, userId, isSmallTalk);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: rl.reason }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Fast path: small talk ──
  if (isSmallTalk) {
    const reply = smallTalkReply(message);
    const sse = makeSseWriter();
    const stream = new ReadableStream({
      start(controller) {
        const metaEvt: SSEEvent = { type: "meta", conversationId, turnId };
        const metaId = bufferEvent(conversationId!, metaEvt);
        controller.enqueue(sse.encode(metaId, metaEvt));
        const tokEvt: SSEEvent = { type: "token", delta: reply };
        const tokId = bufferEvent(conversationId!, tokEvt);
        controller.enqueue(sse.encode(tokId, tokEvt));
        void persistAfterStream(conversationId!, userId, message, reply, turnId, null, []);
        const doneEvt: SSEEvent = { type: "done" };
        const doneId = bufferEvent(conversationId!, doneEvt);
        controller.enqueue(sse.encode(doneId, doneEvt));
        controller.close();
      },
    });
    return sseResponse(stream, conversationId!);
  }

  // ── Parallel: history, agent_state, global facts, doc search ──
  const [history, cosState, globalFactsRes, docsRes] = await Promise.all([
    loadHistory(conversationId),
    loadStateSafe(conversationId, "CoS"),
    memoryClient
      .listGlobalMemories(userId)
      .catch((e) => {
        console.warn("[chat] listGlobalMemories failed:", e);
        return { results: [] as { id: string; fact: string }[] };
      }),
    memoryClient.searchDocuments(userId, message, 3).catch((e) => {
      console.warn("[chat] searchDocuments failed:", e);
      return { results: [] as { text: string; filename?: string }[] };
    }),
  ]);

  // CoS system prompt is built inside the SSE handler (after lazy-loading
  // chiefOfStaff) so we don't have a top-level import that triggers a
  // circular reference (chief-of-staff → tools barrel → consult → registry
  // → chief-of-staff).
  const cosSystem = ""; // unused now; the model adapter reads from chiefOfStaff.instructions
  const docBlock = docsRes.results.length
    ? docsRes.results
        .map((d, i) => `${i + 1}. [${d.filename ?? "doc"}] ${(d as any).text?.slice?.(0, 400) ?? ""}`)
        .join("\n")
    : "";
  const historyAsInput = history.map((m) => ({ role: m.role, content: m.content }));
  const inputItems: any[] = [
    ...historyAsInput,
    { role: "user", content: message + (docBlock ? `\n\n[Relevant documents]\n${docBlock}` : "") },
  ];

  const sse = makeSseWriter();
  const stream = new ReadableStream({
    async start(controller) {
      if (lastEventId > 0) {
        const replay = replaySince(conversationId!, lastEventId);
        for (const e of replay) controller.enqueue(sse.encode(e.id, e.event));
      }
      const metaEvt: SSEEvent = { type: "meta", conversationId, turnId };
      const metaId = bufferEvent(conversationId!, metaEvt);
      controller.enqueue(sse.encode(metaId, metaEvt));

      let assistantBuffer = "";
      const agentMessages: { from: string; to: string; message: string; reply?: string }[] = [];
      const conflictEmitted = { value: false };
      let streamBroke = false;
      let toolStarts: Record<string, number> = {};

      try {
        // Lazy-load the CoS to break the circular import (specialist
        // registry → all specialists including CoS → tools barrel).
        const { chiefOfStaff } = await import("@/lib/agents/specialists/chief-of-staff");
        const cosInstructions = chiefOfStaff.instructions;
        const systemPrompt = buildCosSystemPrompt(
          typeof cosInstructions === "string" ? cosInstructions : "",
          globalFactsRes.results,
          cosState
        );
        // Append the doc block to the last user message.
        if (docBlock) {
          const last = inputItems[inputItems.length - 1];
          if (last && typeof last === "object" && "content" in last) {
            last.content = `${last.content}\n\n[Relevant documents]\n${docBlock}`;
          }
        }

        // Non-streaming path. We use `getResponseSync` (the watchdog fallback
        // from fix-top3-broken) for both happy and error paths. This means
        // the assistant response arrives as a single token event rather
        // than word-by-word, but it's reliable across SDK versions. A
        // future PR can re-introduce streaming once we pin a stable
        // @openai/agents API.
        const result = await getResponseSync(chiefOfStaff, inputItems, {
          conversationId,
          userId,
          turnId,
          reasoning: "think_high",
          fromAgent: "CoS",
          a2aDepth: 0,
          a2aConsultsThisTurn: 0,
        } as any);
        assistantBuffer = result.text;
        if (assistantBuffer) {
          const t: SSEEvent = { type: "token", delta: assistantBuffer };
          const id = bufferEvent(conversationId!, t);
          controller.enqueue(sse.encode(id, t));
        }
        const doneEvt: SSEEvent = { type: "done" };
        const did = bufferEvent(conversationId!, doneEvt);
        controller.enqueue(sse.encode(did, doneEvt));
        controller.close();

        await persistAfterStream(
          conversationId!,
          userId,
          message,
          assistantBuffer,
          turnId,
          cosState,
          agentMessages
        );

        commitTurn({
          turnId,
          conversationId: conversationId!,
          userId,
          finalText: assistantBuffer,
          usage: result.usage,
        });
      } catch (err: any) {
        console.error("[chat] CoS stream failed:", err);
        const e: SSEEvent = { type: "error", message: err?.message ?? String(err) };
        const id = bufferEvent(conversationId!, e);
        controller.enqueue(sse.encode(id, e));
        try {
          await persistAfterStream(
            conversationId!,
            userId,
            message,
            assistantBuffer + `\n\n[error] ${e.message}`,
            turnId,
            cosState,
            agentMessages
          );
        } catch {}
        commitTurn({
          turnId,
          conversationId: conversationId!,
          userId,
          finalText: assistantBuffer + `\n\n[error] ${e.message}`,
          usage: { input: 0, output: 0, reasoning: 0, estimated: true },
        });
        const doneEvt: SSEEvent = { type: "done" };
        const did = bufferEvent(conversationId!, doneEvt);
        controller.enqueue(sse.encode(did, doneEvt));
        controller.close();
      }
    },
  });

  return sseResponse(stream, conversationId!);
}

// ─── Helpers ───────────────────────────────────────────────────────────────
async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  try {
    const sb = createAdminSupabase();
    const { data, error } = await sb
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((m: any) => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: m.created_at,
    }));
  } catch (err) {
    console.warn("[chat] loadHistory failed:", err);
    return [];
  }
}

async function loadStateSafe(conversationId: string, agentName: string): Promise<CosState | null> {
  try {
    return await loadState(conversationId, agentName);
  } catch {
    return null;
  }
}

async function persistAfterStream(
  conversationId: string,
  userId: string,
  userMsg: string,
  assistantMsg: string,
  turnId: string,
  prevState: CosState | null,
  agentMessages: { from: string; to: string; message: string; reply?: string }[]
): Promise<void> {
  try {
    const sb = createAdminSupabase();
    await sb.from("messages").insert([
      { conversation_id: conversationId, user_id: userId, role: "user", content: userMsg, memory_saved: false },
      { conversation_id: conversationId, user_id: userId, role: "assistant", content: assistantMsg, memory_saved: false },
    ]);

    const next: CosState = {
      ...(prevState ?? emptyCosState()),
      current_focus: prevState?.current_focus ?? deriveFocus(userMsg),
      open_questions: prevState?.open_questions ?? [],
      recent_specialist_outputs: [
        ...(prevState?.recent_specialist_outputs ?? []),
        ...agentMessages.map((m) => ({
          agent: m.to,
          summary: m.reply ?? m.message,
          turn: (prevState?.turn_count ?? 0) + 1,
        })),
      ].slice(-10),
      user_preferences_this_session: prevState?.user_preferences_this_session ?? {},
      turn_count: (prevState?.turn_count ?? 0) + 1,
    };
    await saveState(conversationId, "CoS", next);

    if (agentMessages.length > 0) {
      const rows = agentMessages.map((m) => ({
        conversation_id: conversationId,
        turn_id: turnId,
        from_agent: m.from,
        to_agent: m.to,
        message: m.message,
        reply: m.reply ?? "",
        status: m.reply ? "replied" : "pending",
      }));
      try {
        await sb.from("agent_messages").insert(rows);
      } catch (e) {
        console.warn("[chat] persist agent_messages failed:", e);
      }
    }

    void memoryClient
      .addMemory(userId, [
        { role: "user", content: userMsg },
        { role: "assistant", content: assistantMsg },
      ])
      .catch((e) => console.warn("[chat] addMemory failed:", e));

    void memoryClient
      .indexMessage(userId, conversationId, ulid(), "user", userMsg)
      .catch((e) => console.warn("[chat] indexMessage user failed:", e));
    void memoryClient
      .indexMessage(userId, conversationId, ulid(), "assistant", assistantMsg)
      .catch((e) => console.warn("[chat] indexMessage assistant failed:", e));
  } catch (err) {
    console.error("[chat] persistAfterStream failed:", err);
    throw err;
  }
}

function deriveFocus(msg: string): string {
  return msg.slice(0, 80).replace(/\s+/g, " ").trim();
}

function sseResponse(stream: ReadableStream, conversationId: string): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Conversation-Id": conversationId,
    },
  });
}

// ─── Conflict resolution resume branch ─────────────────────────────────────
async function handleConflictResolution(body: any): Promise<Response> {
  const { conversationId, conflictId, choice } = body as {
    conversationId?: string;
    conflictId?: string;
    choice?: string;
  };
  if (!conversationId || !conflictId || !choice) {
    return new Response("missing fields", { status: 400 });
  }

  const userId: string = body.userId || process.env.USER_ID || "local-user";
  const turnId = ulid();
  const sse = makeSseWriter();

  try {
    const sb = createAdminSupabase();
    await sb
      .from("agent_messages")
      .update({
        reply: `user_picked: ${choice} (conflictId=${conflictId})`,
        status: "replied",
      })
      .eq("conversation_id", conversationId)
      .like("message", "[values_tradeoff]%")
      .order("created_at", { ascending: false })
      .limit(1);
  } catch (e) {
    console.warn("[chat] conflict_resolution persist failed:", e);
  }

  const followUp = `The user picked option "${choice}" for the conflict. Continue with the previous task and cite their choice.`;
  const cosState = await loadStateSafe(conversationId, "CoS");
  const input: any[] = [{ role: "user", content: followUp }];

  const stream = new ReadableStream({
    async start(controller) {
      const metaEvt: SSEEvent = { type: "meta", conversationId, turnId };
      const metaId = bufferEvent(conversationId, metaEvt);
      controller.enqueue(sse.encode(metaId, metaEvt));

      const crEvt: SSEEvent = {
        type: "conflict_resolved",
        winner: choice,
        reason: "user picked from ConflictCard",
        strategy: "values_tradeoff",
      };
      const crId = bufferEvent(conversationId, crEvt);
      controller.enqueue(sse.encode(crId, crEvt));

      let assistantBuffer = "";
      try {
        const { chiefOfStaff } = await import("@/lib/agents/specialists/chief-of-staff");
        const result = await getResponseSync(chiefOfStaff, followUp, {
          conversationId,
          userId,
          turnId,
          reasoning: "think_high",
          fromAgent: "CoS",
          a2aDepth: 0,
          a2aConsultsThisTurn: 0,
        } as any);
        assistantBuffer = result.text;
        if (assistantBuffer) {
          const t: SSEEvent = { type: "token", delta: assistantBuffer };
          const id = bufferEvent(conversationId, t);
          controller.enqueue(sse.encode(id, t));
        }
      } catch (err: any) {
        const e: SSEEvent = { type: "error", message: err?.message ?? String(err) };
        const id = bufferEvent(conversationId, e);
        controller.enqueue(sse.encode(id, e));
      }

      const doneEvt: SSEEvent = { type: "done" };
      const did = bufferEvent(conversationId, doneEvt);
      controller.enqueue(sse.encode(did, doneEvt));
      controller.close();

      void persistAfterStream(
        conversationId,
        userId,
        followUp,
        assistantBuffer,
        turnId,
        cosState,
        []
      ).catch(() => {});
    },
  });

  return sseResponse(stream, conversationId);
}

// ─── forget_everything ─────────────────────────────────────────────────────
async function handleForgetEverything(body: any): Promise<Response> {
  const userId: string = body.userId || process.env.USER_ID || "local-user";
  const results: Record<string, string> = {};
  try {
    try {
      await memoryClient.clearMemories(userId);
      results.mem0 = "cleared";
    } catch (e) {
      results.mem0 = `error: ${(e as Error).message}`;
    }
    try {
      await memoryClient.clearGlobalMemories(userId);
      results.mem0_global = "cleared";
    } catch (e) {
      results.mem0_global = `error: ${(e as Error).message}`;
    }
    try {
      const sb = createAdminSupabase();
      // CASCADE handles messages / agent_state / agent_messages.
      const { error } = await sb.from("conversations").delete().eq("user_id", userId);
      if (error) throw error;
      results.supabase = "purged";
    } catch (e) {
      results.supabase = `error: ${(e as Error).message}`;
    }
    try {
      await memoryClient.clearMessages(userId);
      results.message_index = "cleared";
    } catch (e) {
      results.message_index = `error: ${(e as Error).message}`;
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), results }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      message: "All your data has been deleted. The app is now in a fresh state.",
      results,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
