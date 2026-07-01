// lib/supabase/vector.ts — pgvector helpers.
//
// All helpers use the **admin** client (bypasses RLS) and call SQL
// `match_<table>(embedding, user_id, match_count)` functions defined in
// supabase/migrations/20260701000001_match_functions.sql.
//
// To call these from a route handler:
//
//   import { createAdminSupabase } from "@/lib/supabase/admin";
//   import { searchMemories } from "@/lib/supabase/vector";
//   const sb = createAdminSupabase();
//   const hits = await searchMemories(sb, userId, embedding, 5);
//
// Embeddings are 384-dim, produced by `@xenova/transformers` (BAAI/bge-small-en-v1.5)
// — see `lib/embedding.ts`.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient;

export type MemoryHit = {
  id: string;
  fact: string;
  score: number;
  metadata: Record<string, unknown>;
  is_global: boolean;
};

export type DocumentHit = {
  id: string;
  filename: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
};

export type MessageIndexHit = {
  id: string;
  conversation_id: string;
  message_id: string;
  role: "user" | "assistant" | "system";
  text: string;
  score: number;
};

// ── Embedding type guard ────────────────────────────────────────────────────
function isEmbedding(x: unknown): x is number[] {
  return (
    Array.isArray(x) &&
    x.length === 384 &&
    x.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

// ── memories ───────────────────────────────────────────────────────────────
export async function upsertMemory(
  sb: AdminClient,
  rec: {
    userId: string;
    fact: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
    isGlobal?: boolean;
    conversationId?: string | null;
  }
): Promise<string> {
  if (!isEmbedding(rec.embedding)) {
    throw new Error("upsertMemory: embedding must be a 384-dim number[]");
  }
  const { data, error } = await sb
    .from("memories")
    .insert({
      user_id: rec.userId,
      fact: rec.fact,
      embedding: rec.embedding,
      metadata: rec.metadata ?? {},
      is_global: !!rec.isGlobal,
      conversation_id: rec.conversationId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`upsertMemory failed: ${error.message}`);
  return data.id;
}

export async function searchMemories(
  sb: AdminClient,
  userId: string,
  embedding: number[],
  limit = 5,
  threshold = 0.5
): Promise<MemoryHit[]> {
  if (!isEmbedding(embedding)) {
    throw new Error("searchMemories: embedding must be a 384-dim number[]");
  }
  const { data, error } = await sb.rpc("match_memories", {
    query_embedding: embedding,
    p_user_id: userId,
    match_count: limit,
    match_threshold: threshold,
  });
  if (error) throw new Error(`searchMemories failed: ${error.message}`);
  return (data ?? []) as MemoryHit[];
}

export async function listMemories(
  sb: AdminClient,
  userId: string,
  opts: { globalOnly?: boolean; limit?: number } = {}
): Promise<MemoryHit[]> {
  let q = sb
    .from("memories")
    .select("id, fact, metadata, is_global")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.globalOnly) q = q.eq("is_global", true);
  const { data, error } = await q;
  if (error) throw new Error(`listMemories failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    fact: r.fact as string,
    score: 0,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    is_global: r.is_global as boolean,
  }));
}

export async function clearMemories(
  sb: AdminClient,
  userId: string,
  opts: { globalOnly?: boolean } = {}
): Promise<number> {
  let q = sb.from("memories").delete().eq("user_id", userId);
  if (opts.globalOnly) q = q.eq("is_global", true);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`clearMemories failed: ${error.message}`);
  return (data ?? []).length;
}

// ── documents ──────────────────────────────────────────────────────────────
export async function upsertDocument(
  sb: AdminClient,
  rec: {
    userId: string;
    filename: string;
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }
): Promise<string> {
  if (!isEmbedding(rec.embedding)) {
    throw new Error("upsertDocument: embedding must be a 384-dim number[]");
  }
  const { data, error } = await sb
    .from("documents")
    .insert({
      user_id: rec.userId,
      filename: rec.filename,
      content: rec.content,
      embedding: rec.embedding,
      metadata: rec.metadata ?? {},
    })
    .select("id")
    .single();
  if (error) throw new Error(`upsertDocument failed: ${error.message}`);
  return data.id;
}

export async function searchDocuments(
  sb: AdminClient,
  userId: string,
  embedding: number[],
  limit = 5,
  threshold = 0.5
): Promise<DocumentHit[]> {
  if (!isEmbedding(embedding)) {
    throw new Error("searchDocuments: embedding must be a 384-dim number[]");
  }
  const { data, error } = await sb.rpc("match_documents", {
    query_embedding: embedding,
    p_user_id: userId,
    match_count: limit,
    match_threshold: threshold,
  });
  if (error) throw new Error(`searchDocuments failed: ${error.message}`);
  return (data ?? []) as DocumentHit[];
}

export async function listDocuments(
  sb: AdminClient,
  userId: string
): Promise<{ id: string; filename: string; metadata: Record<string, unknown>; created_at: string }[]> {
  const { data, error } = await sb
    .from("documents")
    .select("id, filename, metadata, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listDocuments failed: ${error.message}`);
  return (data ?? []) as any;
}

export async function deleteDocument(
  sb: AdminClient,
  userId: string,
  docId: string
): Promise<void> {
  const { error } = await sb
    .from("documents")
    .delete()
    .eq("user_id", userId)
    .eq("id", docId);
  if (error) throw new Error(`deleteDocument failed: ${error.message}`);
}

// ── message_index (cross-conversation search) ──────────────────────────────
export async function indexMessage(
  sb: AdminClient,
  rec: {
    userId: string;
    conversationId: string;
    messageId: string;
    role: "user" | "assistant" | "system";
    text: string;
    embedding: number[];
  }
): Promise<string> {
  if (!isEmbedding(rec.embedding)) {
    throw new Error("indexMessage: embedding must be a 384-dim number[]");
  }
  const { data, error } = await sb
    .from("message_index")
    .insert({
      user_id: rec.userId,
      conversation_id: rec.conversationId,
      message_id: rec.messageId,
      role: rec.role,
      text: rec.text,
      embedding: rec.embedding,
    })
    .select("id")
    .single();
  if (error) throw new Error(`indexMessage failed: ${error.message}`);
  return data.id;
}

export async function searchMessages(
  sb: AdminClient,
  userId: string,
  embedding: number[],
  limit = 5,
  threshold = 0.5
): Promise<MessageIndexHit[]> {
  if (!isEmbedding(embedding)) {
    throw new Error("searchMessages: embedding must be a 384-dim number[]");
  }
  const { data, error } = await sb.rpc("match_message_index", {
    query_embedding: embedding,
    p_user_id: userId,
    match_count: limit,
    match_threshold: threshold,
  });
  if (error) throw new Error(`searchMessages failed: ${error.message}`);
  return (data ?? []) as MessageIndexHit[];
}

export async function clearMessages(
  sb: AdminClient,
  userId: string
): Promise<number> {
  const { data, error } = await sb
    .from("message_index")
    .delete()
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(`clearMessages failed: ${error.message}`);
  return (data ?? []).length;
}
