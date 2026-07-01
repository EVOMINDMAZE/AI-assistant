/**
 * /api/search-messages — proxy to memory-service /search_messages.
 * Used by the Sidebar's search bar.
 */
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const url = process.env.MEMORY_SERVICE_URL || "http://localhost:7100";
  try {
    const r = await fetch(`${url}/search_messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: body.userId,
        query: body.query,
        limit: body.limit ?? 8,
      }),
    });
    const data = await r.json();
    return new Response(JSON.stringify({ results: data.results ?? [] }), {
      status: r.ok ? 200 : r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ results: [], error: String(err) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
