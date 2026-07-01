/**
 * Per-conversation working memory for the CoS and specialists.
 *
 * Backed by PocketBase `agent_state` collection. Unique per (conv, agent).
 * The CoS reads its state at the start of every turn and writes at the end
 * (last write wins).
 */
import type PocketBase from "pocketbase";
import type { CosState } from "./agent-types";

const COLLECTION = "agent_state";

export async function loadState(
  pb: PocketBase,
  conversationId: string,
  agentName: string
): Promise<CosState | null> {
  try {
    const records = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `conversation_id="${conversationId}" && agent_name="${agentName}"`,
    });
    if (records.items.length === 0) return null;
    return records.items[0].state_json as CosState;
  } catch (err) {
    console.warn(`[state] loadState failed for ${agentName} in ${conversationId}:`, err);
    return null;
  }
}

export async function saveState(
  pb: PocketBase,
  conversationId: string,
  agentName: string,
  state: CosState
): Promise<void> {
  try {
    const existing = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `conversation_id="${conversationId}" && agent_name="${agentName}"`,
    });
    if (existing.items.length > 0) {
      await pb.collection(COLLECTION).update(existing.items[0].id, {
        state_json: state,
      });
    } else {
      await pb.collection(COLLECTION).create({
        conversation_id: conversationId,
        agent_name: agentName,
        state_json: state,
      });
    }
  } catch (err) {
    console.error(`[state] saveState failed for ${agentName} in ${conversationId}:`, err);
    throw err;
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
