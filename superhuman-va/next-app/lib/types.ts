// Shared types between the Next.js client and server.

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt?: string;
}

export interface MemoryHit {
  id?: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentHit {
  doc_id: string;
  chunk_index: number;
  text: string;
  score: number;
  filename?: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created?: string;
  updated?: string;
}

export interface DocumentMeta {
  doc_id: string;
  filename?: string;
  chunks: number;
}
