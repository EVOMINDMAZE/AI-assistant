// POST /api/chat
//
// Streaming chat endpoint. Flow:
//   1. Parallel: search Mem0 for relevant user memories AND search
//      Qdrant for relevant document chunks.
//   2. Build a system prompt that inlines the retrieved context.
//   3. Stream DeepSeek's response back to the client as SSE.
//   4. After the stream completes, buffer the full assistant text,
//      save both user + assistant messages to PocketBase, and
//      fire-and-forget POST /add_memory to Mem0 with the pair.

import { NextRequest } from "next/server";
import { DEEPSEEK_MODEL, USER_ID, deepseek } from "@/lib/deepseek";
import { memoryClient } from "@/lib/memory-client";
import { pbAsAdmin } from "@/lib/pocketbase";
import type { ChatMessage, DocumentHit, MemoryHit } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT_TEMPLATE = `You are a Superhuman AI Virtual Assistant. You have persistent memory of every past conversation with this user, and you can recall the contents of any documents they have uploaded.

When responding, you naturally weave in anything relevant from the context below — preferences, facts, past decisions, document content — without explicitly saying "I remember ..." unless asked. If nothing in the context is relevant to the current message, just answer normally.

───────────
# Relevant memories about this user
{userMemories}

# Relevant document excerpts
{userDocuments}
───────────`;

const CONTEXT_MESSAGE_LIMIT = 10;

function buildSystemPrompt(memories: MemoryHit[], docs: DocumentHit[]): string {
  const memBlock = memories.length
    ? memories
        .map((m, i) => `${i + 1}. ${m.memory}`)
        .join("\n")
    : "(none retrieved)";
  const docBlock = docs.length
    ? docs
        .map(
          (d, i) =>
            `${i + 1}. [${d.filename ?? "doc"}] ${d.text.slice(0, 400)}${d.text.length > 400 ? "..." : ""}`
        )
        .join("\n\n")
    : "(none retrieved)";
  return SYSTEM_PROMPT_TEMPLATE.replace("{userMemories}", memBlock).replace(
    "{userDocuments}",
    docBlock
  );
}

export async function POST(req: NextRequest) {
  let body: { conversationId?: string; message?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const message = (body.message ?? "").trim();
  const userId = body.userId || USER_ID;
  if (!message) return new Response("Empty message", { status: 400 });

  // ── Ensure we have a conversation id ──
  let conversationId = body.conversationId;
  try {
    const pb = await pbAsAdmin();
    if (!conversationId) {
      const conv = await pb.collection("conversations").create({
        user_id: userId,
        title: message.slice(0, 60),
      });
      conversationId = conv.id;
    } else {
      // bump updated timestamp
      await pb.collection("conversations").update(conversationId, {});
    }
  } catch (err) {
    console.error("[chat] PocketBase conv init failed", err);
    return new Response("Database unavailable", { status: 503 });
  }

  // ── Parallel: history + memory search + document search ──
  let history: ChatMessage[] = [];
  let memories: MemoryHit[] = [];
  let docs: DocumentHit[] = [];

  try {
    const pb = await pbAsAdmin();
    const [historyRes, memRes, docRes] = await Promise.all([
      pb.collection("messages").getList(1, CONTEXT_MESSAGE_LIMIT, {
        filter: `conversation_id = "${conversationId}"`,
        sort: "-created",
      }),
      memoryClient.searchMemory(userId, message).catch((e) => {
        console.warn("[chat] searchMemory failed:", e);
        return { results: [] as MemoryHit[] };
      }),
      memoryClient.searchDocuments(userId, message).catch((e) => {
        console.warn("[chat] searchDocuments failed:", e);
        return { results: [] as DocumentHit[] };
      }),
    ]);
    history = (historyRes.items as ChatMessage[]).slice(-CONTEXT_MESSAGE_LIMIT);
    memories = memRes.results;
    docs = docRes.results;
  } catch (err) {
    console.error("[chat] context fetch failed", err);
  }

  // ── Build prompt and call DeepSeek ──
  const systemPrompt = buildSystemPrompt(memories, docs);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

  const encoder = new TextEncoder();

  // Send a one-time `meta` event so the client knows the conversationId,
  // then stream tokens.
  const metaEvent = `data: ${JSON.stringify({
    type: "meta",
    conversationId,
  })}\n\n`;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(metaEvent));

      let assistantBuffer = "";
      try {
        const completion = await deepseek.chat.completions.create({
          model: DEEPSEEK_MODEL,
          stream: true,
          temperature: 0.6,
          messages,
        });

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (!delta) continue;
          assistantBuffer += delta;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "token", content: delta })}\n\n`
            )
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        console.error("[chat] DeepSeek stream failed", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", content: String(err) })}\n\n`
          )
        );
        controller.close();
      }

      // ── Post-stream: persist to PB, then fire-and-forget to Mem0 ──
      try {
        const pb = await pbAsAdmin();
        await pb.collection("messages").create({
          conversation_id: conversationId,
          role: "user",
          content: message,
          memory_saved: false,
        });
        await pb.collection("messages").create({
          conversation_id: conversationId,
          role: "assistant",
          content: assistantBuffer,
          memory_saved: false,
        });
      } catch (err) {
        console.error("[chat] post-stream PB save failed", err);
      }

      // Fire-and-forget — do not await.
      void memoryClient
        .addMemory(userId, [
          { role: "user", content: message },
          { role: "assistant", content: assistantBuffer },
        ])
        .catch((err) => console.warn("[chat] addMemory failed:", err));
    },
  });

  // We need to send a final header with the conversationId so the client
  // can persist it. Stash it in a custom SSE event before the [DONE].
  // Cleanest: prepend a small JSON envelope. We do that inside the stream
  // by enqueueing one more event at the top of `start`. To keep things
  // simple, we also include the conversation id in the response headers
  // so the client can read it even if it misses the first SSE event.
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Conversation-Id": conversationId ?? "",
    },
  });
}
