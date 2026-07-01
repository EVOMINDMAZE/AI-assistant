// POST /api/memories/add — extract facts from the last N messages and persist.
import { NextRequest, NextResponse } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId ?? USER_ID;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const res = await memoryClient.addMemory(userId, messages);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
