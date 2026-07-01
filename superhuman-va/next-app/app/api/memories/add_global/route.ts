// POST /api/memories/add_global — append a fact to the global (cross-conversation) memory.
import { NextRequest, NextResponse } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId ?? USER_ID;
    const res = await memoryClient.addGlobalMemory(
      userId,
      String(body.fact ?? ""),
      body.metadata ?? {}
    );
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
