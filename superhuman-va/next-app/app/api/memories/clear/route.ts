// POST /api/memories/clear — wipe episodic (per-conversation) memory.
import { NextRequest } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = body.userId ?? USER_ID;
  try {
    const res = await memoryClient.clearMemories(userId);
    return new Response(JSON.stringify(res), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
