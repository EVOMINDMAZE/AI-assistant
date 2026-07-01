// lib/memory-client.ts — Supabase-backed in-process memory client.
//
// Replaces the previous fetch-based wrapper around the FastAPI
// memory-service. Same public surface; the body now calls
// `lib/supabase/{admin,vector}.ts` and `lib/embedding.ts` directly.
//
// Every method is an `async` function; signatures match the old client.

import "server-only";
import { ulid } from "ulid";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  upsertMemory,
  searchMemories,
  listMemories,
  clearMemories as clearMemoriesTable,
  upsertDocument,
  searchDocuments,
  listDocuments,
  deleteDocument,
  indexMessage as indexMessageTable,
  searchMessages,
  clearMessages as clearMessagesTable,
  type MemoryHit,
  type DocumentHit,
  type MessageIndexHit,
} from "@/lib/supabase/vector";
import { embed } from "@/lib/embedding";

export type { MemoryHit, DocumentHit, MessageIndexHit };

export interface SearchMemoryResponse {
  results: MemoryHit[];
}
export interface SearchDocumentsResponse {
  results: DocumentHit[];
}
export interface ListMemoriesResponse {
  results: MemoryHit[];
}
export interface ListDocumentsResponse {
  results: { id: string; filename: string; metadata: Record<string, unknown>; created_at: string }[];
}
export interface ListGlobalMemoryResponse {
  results: MemoryHit[];
}
export interface GlobalMemoryHit extends MemoryHit {}

function getSb() {
  return createAdminSupabase();
}

// ── Mem0-style episodic memory ──────────────────────────────────────────────
// Heuristic: extract a few short facts from the most recent user message.
// Real Mem0 would do this with an LLM; we use a simple sentence splitter
// for now to avoid one extra LLM call per turn. Replace with Mem0 Cloud
// or a local extraction agent if quality is insufficient.
function extractFactsFromMessages(
  messages: { role: string; content: string }[]
): string[] {
  const facts: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    // Naive: split on sentence-ending punctuation, drop trivial short ones.
    const sentences = m.content
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.length <= 200);
    facts.push(...sentences.slice(0, 3));
  }
  return facts;
}

export const memoryClient = {
  // ── episodic (Mem0-style) ────────────────────────────────────────────────
  async addMemory(
    userId: string,
    messages: { role: "user" | "assistant" | "system"; content: string }[]
  ): Promise<unknown> {
    const sb = getSb();
    const facts = extractFactsFromMessages(messages);
    const results: string[] = [];
    for (const fact of facts) {
      const emb = await embed(fact);
      const id = await upsertMemory(sb, {
        userId,
        fact,
        embedding: emb,
        isGlobal: false,
      });
      results.push(id);
    }
    return { inserted: results.length, ids: results };
  },

  async searchMemory(
    userId: string,
    query: string,
    limit = 5,
    threshold = 0.5
  ): Promise<SearchMemoryResponse> {
    const sb = getSb();
    const emb = await embed(query);
    const hits = await searchMemories(sb, userId, emb, limit, threshold);
    return { results: hits.filter((h) => !h.is_global) };
  },

  async listMemories(userId: string): Promise<ListMemoriesResponse> {
    const sb = getSb();
    const rows = await listMemories(sb, userId, { globalOnly: false });
    return { results: rows };
  },

  async clearMemories(userId: string): Promise<unknown> {
    const sb = getSb();
    const n = await clearMemoriesTable(sb, userId, { globalOnly: false });
    return { deleted: n };
  },

  // ── global (cross-conversation, never pruned) ────────────────────────────
  async addGlobalMemory(
    userId: string,
    fact: string,
    metadata?: Record<string, unknown>
  ): Promise<unknown> {
    const sb = getSb();
    const emb = await embed(fact);
    const id = await upsertMemory(sb, {
      userId,
      fact,
      embedding: emb,
      metadata: metadata ?? {},
      isGlobal: true,
    });
    return { id };
  },

  async searchGlobalMemory(
    userId: string,
    query: string,
    limit = 5
  ): Promise<{ results: GlobalMemoryHit[] }> {
    const sb = getSb();
    const emb = await embed(query);
    const hits = await searchMemories(sb, userId, emb, limit);
    return { results: hits.filter((h) => h.is_global) };
  },

  async listGlobalMemories(userId: string): Promise<ListGlobalMemoryResponse> {
    const sb = getSb();
    const rows = await listMemories(sb, userId, { globalOnly: true });
    return { results: rows };
  },

  async clearGlobalMemories(userId: string): Promise<unknown> {
    const sb = getSb();
    const n = await clearMemoriesTable(sb, userId, { globalOnly: true });
    return { deleted: n };
  },

  // ── documents ────────────────────────────────────────────────────────────
  async searchDocuments(
    userId: string,
    query: string,
    limit = 5
  ): Promise<SearchDocumentsResponse> {
    const sb = getSb();
    const emb = await embed(query);
    const rows = await searchDocuments(sb, userId, emb, limit);
    return { results: rows };
  },

  async listDocuments(userId: string): Promise<ListDocumentsResponse> {
    const sb = getSb();
    const rows = await listDocuments(sb, userId);
    return { results: rows };
  },

  async addDocument(
    userId: string,
    filename: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<{ id: string }> {
    const sb = getSb();
    const emb = await embed(content.slice(0, 2000));
    const id = await upsertDocument(sb, {
      userId,
      filename,
      content,
      embedding: emb,
      metadata: metadata ?? {},
    });
    return { id };
  },

  async deleteDocument(userId: string, docId: string): Promise<unknown> {
    const sb = getSb();
    await deleteDocument(sb, userId, docId);
    return { ok: true };
  },

  // ── message index (cross-conversation search) ────────────────────────────
  async indexMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    role: "user" | "assistant" | "system",
    text: string
  ): Promise<unknown> {
    const sb = getSb();
    const emb = await embed(text.slice(0, 2000));
    const id = await indexMessageTable(sb, {
      userId,
      conversationId,
      messageId,
      role,
      text,
      embedding: emb,
    });
    return { id };
  },

  async searchMessages(
    userId: string,
    query: string,
    limit = 5
  ): Promise<{ results: MessageIndexHit[] }> {
    const sb = getSb();
    const emb = await embed(query);
    const hits = await searchMessages(sb, userId, emb, limit);
    return { results: hits };
  },

  async clearMessages(userId: string): Promise<unknown> {
    const sb = getSb();
    const n = await clearMessagesTable(sb, userId);
    return { deleted: n };
  },
};

/** Generate a new message id (ULID). */
export function newMessageId(): string {
  return ulid();
}
