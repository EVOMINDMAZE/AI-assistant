// GET    /api/conversations  → list this user's conversations
// POST   /api/conversations  → create a new conversation
// DELETE /api/conversations?id=<id> → delete conversation + all child rows
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { memoryClient } from "@/lib/memory-client";
import type { Conversation } from "@/lib/types";

export const runtime = "nodejs";

async function getUserId(): Promise<string> {
  // For now we still rely on the local user id; once Supabase Auth is wired
  // up, this becomes the auth.uid().
  return process.env.USER_ID || "local-user";
}

export async function GET() {
  try {
    const sb = createServerSupabase();
    const userId = await getUserId();
    const { data, error } = await sb
      .from("conversations")
      .select("id, user_id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      return NextResponse.json(
        { error: "list conversations failed", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ results: data as Conversation[] });
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
    const sb = createServerSupabase();
    const userId = await getUserId();
    const { data, error } = await sb
      .from("conversations")
      .insert({
        user_id: userId,
        title: body.title?.trim() || "New chat",
      })
      .select("id, user_id, title, created_at, updated_at")
      .single();
    if (error) {
      return NextResponse.json(
        { error: "create conversation failed", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ conversation: data as Conversation });
  } catch (err) {
    return NextResponse.json(
      { error: "create conversation failed", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const sb = createAdminSupabase();
    const userId = await getUserId();
    // Cascade deletes handle messages, agent_state, agent_messages
    // (see ON DELETE CASCADE in 0001_init.sql). We just need to delete the
    // conversation row.
    const { error } = await sb.from("conversations").delete().eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "delete conversation failed", detail: error.message },
        { status: 500 }
      );
    }
    // Best-effort: clear from the message_index for this user.
    void memoryClient.clearMessages(userId).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "delete conversation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
