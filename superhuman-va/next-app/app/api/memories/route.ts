// GET    /api/memories  → list everything Mem0 has stored for this user
// DELETE /api/memories  → wipe the user's memory
import { NextResponse } from "next/server";
import { USER_ID } from "@/lib/deepseek";
import { memoryClient } from "@/lib/memory-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await memoryClient.listMemories(USER_ID);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: "list_memories failed", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const res = await memoryClient.clearMemories(USER_ID);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: "clear_memories failed", detail: String(err) },
      { status: 500 }
    );
  }
}
