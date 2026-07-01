// POST /api/memories/index_message — index a chat message for semantic search.
import { NextRequest, NextResponse } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId ?? USER_ID;
    const res = await memoryClient.indexMessage(
      userId,
      String(body.conversationId ?? ""),
      String(body.messageId ?? ""),
      (body.role ?? "user") as "user" | "assistant" | "system",
      String(body.text ?? "")
    );
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
