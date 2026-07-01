/**
 * Agent-to-agent messaging bus, backed by Supabase `agent_messages`.
 */
import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export interface AgentMessage {
  id: string;
  conversation_id: string;
  turn_id: string;
  from_agent: string;
  to_agent: string;
  message: string;
  reply?: string;
  status: "pending" | "replied" | "errored";
  created_at: string;
}

export async function postMessage(fields: {
  conversation_id: string;
  turn_id: string;
  from_agent: string;
  to_agent: string;
  message: string;
}): Promise<AgentMessage> {
  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("agent_messages")
    .insert({ ...fields, status: "pending" })
    .select("*")
    .single();
  if (error) throw new Error(`postMessage failed: ${error.message}`);
  return data as unknown as AgentMessage;
}

export async function markReplied(
  messageId: string,
  reply: string
): Promise<AgentMessage> {
  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("agent_messages")
    .update({ reply, status: "replied" })
    .eq("id", messageId)
    .select("*")
    .single();
  if (error) throw new Error(`markReplied failed: ${error.message}`);
  return data as unknown as AgentMessage;
}

export async function markErrored(
  messageId: string,
  error: string
): Promise<AgentMessage> {
  const sb = createAdminSupabase();
  const { data, error: dbError } = await sb
    .from("agent_messages")
    .update({ reply: error, status: "errored" })
    .eq("id", messageId)
    .select("*")
    .single();
  if (dbError) throw new Error(`markErrored failed: ${dbError.message}`);
  return data as unknown as AgentMessage;
}

export async function listTurnMessages(turnId: string): Promise<AgentMessage[]> {
  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("agent_messages")
    .select("*")
    .eq("turn_id", turnId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`listTurnMessages failed: ${error.message}`);
  return (data ?? []) as unknown as AgentMessage[];
}
