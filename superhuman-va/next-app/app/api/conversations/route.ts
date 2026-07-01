// GET    /api/conversations  → list this user's conversations
// POST   /api/conversations  → create a new conversation
// DELETE /api/conversations?id=<id> → delete conversation + all child rows
import { NextRequest, NextResponse } from "next/server";
import { pbAsAdmin } from "@/lib/pocketbase";
import { USER_ID } from "@/lib/deepseek";
import type { Conversation } from "@/lib/types";
import { memoryClient } from "@/lib/memory-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const pb = await pbAsAdmin();
    const list = await pb.collection("conversations").getList(1, 50, {
      filter: `user_id = "${USER_ID}"`,
      sort: "-updated",
    });
    return NextResponse.json({ results: list.items as Conversation[] });
  } catch (err) {
    return NextResponse.json(
      { error: "list conversations failed", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { title?: string };
    const pb = await pbAsAdmin();
    const conv = await pb.collection("conversations").create({
      user_id: USER_ID,
      title: body.title?.trim() || "New chat",
    });
    return NextResponse.json({ conversation: conv as Conversation });
  } catch (err) {
    return NextResponse.json(
      { error: "create conversation failed", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const pb = await pbAsAdmin();
    // Delete child rows
    const msgs = await pb.collection("messages").getFullList({ filter: `conversation_id="${id}"` });
    for (const m of msgs) await pb.collection("messages").delete(m.id);
    const states = await pb.collection("agent_state").getFullList({ filter: `conversation_id="${id}"` });
    for (const s of states) await pb.collection("agent_state").delete(s.id);
    const a2a = await pb.collection("agent_messages").getFullList({ filter: `conversation_id="${id}"` });
    for (const a of a2a) await pb.collection("agent_messages").delete(a.id);
    await pb.collection("conversations").delete(id);
    // Best-effort: clear from Qdrant message index (we don't have an
    // endpoint for delete-by-conversation, so this is a no-op for now).
    void memoryClient.clearMessages(USER_ID).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "delete conversation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
