// Thin fetch wrapper around the memory-service API.
import type { DocumentHit, DocumentMeta, MemoryHit } from "./types";

const BASE = process.env.MEMORY_SERVICE_URL ?? "http://localhost:8000";

async function jsonFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`memory-service ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

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
  results: DocumentMeta[];
}

export const memoryClient = {
  searchMemory(
    userId: string,
    query: string,
    limit = 5,
    threshold = 0.3
  ): Promise<SearchMemoryResponse> {
    return jsonFetch("/search_memory", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, query, limit, threshold }),
    });
  },

  searchDocuments(
    userId: string,
    query: string,
    limit = 5
  ): Promise<SearchDocumentsResponse> {
    return jsonFetch("/search_documents", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, query, limit }),
    });
  },

  listMemories(userId: string): Promise<ListMemoriesResponse> {
    return jsonFetch(`/list_memories?user_id=${encodeURIComponent(userId)}`, {
      method: "GET",
    });
  },

  clearMemories(userId: string): Promise<unknown> {
    return jsonFetch(`/clear_memories?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  },

  listDocuments(userId: string): Promise<ListDocumentsResponse> {
    return jsonFetch(`/list_documents?user_id=${encodeURIComponent(userId)}`, {
      method: "GET",
    });
  },

  deleteDocument(userId: string, docId: string): Promise<unknown> {
    return jsonFetch(
      `/delete_document?user_id=${encodeURIComponent(userId)}&doc_id=${encodeURIComponent(docId)}`,
      { method: "DELETE" }
    );
  },

  // Fire-and-forget: caller does not await. We do still need to
  // construct the promise to start the fetch, but callers should
  // intentionally drop it.
  addMemory(
    userId: string,
    messages: { role: "user" | "assistant" | "system"; content: string }[]
  ): Promise<unknown> {
    return jsonFetch("/add_memory", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, messages }),
    });
  },
};
