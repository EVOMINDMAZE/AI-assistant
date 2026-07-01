/**
 * /api/search-messages — search across the user's past chat messages.
 * Used by the Sidebar's search bar. Backed by the in-process memory-client
 * (Supabase pgvector via `message_index`).
 */
import { NextRequest } from "next/server";
import { USER_ID } from "@/lib/deepseek";
import { memoryClient } from "@/lib/memory-client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = body.userId ?? USER_ID;
  const query = String(body.query ?? "");
  const limit = body.limit ?? 8;
  try {
    const data = await memoryClient.searchMessages(userId, query, limit);
    return new Response(JSON.stringify({ results: data.results ?? [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ results: [], error: String(err) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
