/**
 * Per-conversation working memory for the CoS and specialists.
 *
 * Backed by Supabase `agent_state` table. Unique per (conv, agent).
 * The CoS reads its state at the start of every turn and writes at the end
 * (last write wins).
 */
import "server-only";
import type { CosState } from "./agent-types";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function loadState(
  conversationId: string,
  agentName: string
): Promise<CosState | null> {
  const sb = createAdminSupabase();
  const { data, error } = await sb
    .from("agent_state")
    .select("state_json")
    .eq("conversation_id", conversationId)
    .eq("agent_name", agentName)
    .maybeSingle();
  if (error) {
    console.warn(`[state] loadState failed for ${agentName} in ${conversationId}:`, error);
    return null;
  }
  if (!data) return null;
  return data.state_json as CosState;
}

export async function saveState(
  conversationId: string,
  agentName: string,
  state: CosState
): Promise<void> {
  const sb = createAdminSupabase();
  const { error } = await sb
    .from("agent_state")
    .upsert(
      {
        conversation_id: conversationId,
        agent_name: agentName,
        state_json: state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id,agent_name" }
    );
  if (error) {
    console.error(`[state] saveState failed for ${agentName} in ${conversationId}:`, error);
    throw error;
  }
}

export function emptyCosState(): CosState {
  return {
    current_focus: null,
    open_questions: [],
    recent_specialist_outputs: [],
    user_preferences_this_session: {},
    turn_count: 0,
  };
}
