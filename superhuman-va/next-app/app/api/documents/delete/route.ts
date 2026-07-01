// DELETE /api/documents/delete?id=<docId> — remove a document.
import { NextRequest } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get("userId") ?? USER_ID;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const res = await memoryClient.deleteDocument(userId, id);
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
