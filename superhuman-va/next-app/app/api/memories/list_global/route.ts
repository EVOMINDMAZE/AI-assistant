// GET /api/memories/list_global — list all global facts for the user.
import { NextRequest } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get("userId") ?? USER_ID;
  try {
    const res = await memoryClient.listGlobalMemories(userId);
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
