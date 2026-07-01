// types/database.ts — minimal Supabase schema typings.
// Regenerate with `supabase gen types typescript` when schema changes.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          user_id: string;
          role: "user" | "assistant" | "system";
          content: string;
          memory_saved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          user_id: string;
          role: "user" | "assistant" | "system";
          content: string;
          memory_saved?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
      };
      agent_state: {
        Row: {
          id: string;
          conversation_id: string;
          agent_name: string;
          state_json: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          agent_name: string;
          state_json?: Json;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_state"]["Insert"]>;
      };
      agent_messages: {
        Row: {
          id: string;
          conversation_id: string;
          turn_id: string;
          from_agent: string;
          to_agent: string;
          message: string;
          reply: string;
          status: "pending" | "replied" | "errored";
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          turn_id: string;
          from_agent: string;
          to_agent: string;
          message: string;
          reply?: string;
          status?: "pending" | "replied" | "errored";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_messages"]["Insert"]>;
      };
      memories: {
        Row: {
          id: string;
          user_id: string;
          conversation_id: string | null;
          fact: string;
          embedding: number[] | null;
          metadata: Json;
          is_global: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          conversation_id?: string | null;
          fact: string;
          embedding?: number[] | null;
          metadata?: Json;
          is_global?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memories"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          filename: string;
          content: string;
          embedding: number[] | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          filename: string;
          content: string;
          embedding?: number[] | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      message_index: {
        Row: {
          id: string;
          user_id: string;
          conversation_id: string;
          message_id: string;
          role: "user" | "assistant" | "system";
          text: string;
          embedding: number[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          conversation_id: string;
          message_id: string;
          role: "user" | "assistant" | "system";
          text: string;
          embedding?: number[] | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_index"]["Insert"]>;
      };
      cost_traces: {
        Row: {
          id: string;
          user_id: string;
          conversation_id: string;
          turn_id: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          conversation_id: string;
          turn_id: string;
          payload: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["cost_traces"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_memories: {
        Args: {
          query_embedding: number[];
          p_user_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: {
          id: string;
          fact: string;
          score: number;
          metadata: Json;
          is_global: boolean;
        }[];
      };
      match_documents: {
        Args: {
          query_embedding: number[];
          p_user_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: {
          id: string;
          filename: string;
          content: string;
          score: number;
          metadata: Json;
        }[];
      };
      match_message_index: {
        Args: {
          query_embedding: number[];
          p_user_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: {
          id: string;
          conversation_id: string;
          message_id: string;
          role: "user" | "assistant" | "system";
          text: string;
          score: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
