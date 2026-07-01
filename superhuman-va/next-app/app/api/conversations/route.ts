// GET  /api/conversations  → list this user's conversations
// POST /api/conversations  → create a new conversation (title + user_id)
import { NextRequest, NextResponse } from "next/server";
import { pbAsAdmin } from "@/lib/pocketbase";
import { USER_ID } from "@/lib/deepseek";
import type { Conversation } from "@/lib/types";

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
