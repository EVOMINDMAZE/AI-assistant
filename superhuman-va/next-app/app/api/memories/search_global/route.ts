// POST /api/memories/search_global — search the global fact set.
import { NextRequest, NextResponse } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId ?? USER_ID;
    const res = await memoryClient.searchGlobalMemory(
      userId,
      String(body.query ?? ""),
      body.limit ?? 5
    );
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
