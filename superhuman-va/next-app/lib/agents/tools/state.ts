/**
 * State tools — `load_my_state` and `save_my_state` for any specialist.
 *
 * The `agent_name` parameter is set by the registry when the specialist is
 * registered, so the agent doesn't need to know its own name.
 */
import "server-only";
import { tool } from "@openai/agents";
import { z } from "zod";
import { loadState, saveState } from "@/lib/state";
import type { CosState } from "@/lib/agent-types";

export const loadMyState = tool({
  name: "load_my_state",
  description:
    "Load the persistent working memory (state) for this conversation. " +
    "The state is a free-form JSON object: typically current_focus, open_questions, " +
    "recent_specialist_outputs, user_preferences_this_session, turn_count. " +
    "Call this at the start of every turn.",
  parameters: z.object({
    conversation_id: z.string().describe("The current conversation id."),
    agent_name: z.string().describe("This agent's name (e.g. 'CoS', 'CTO')."),
  }),
  async execute({ conversation_id, agent_name }) {
    const state = await loadState(conversation_id, agent_name);
    return state ?? null;
  },
});

export const saveMyState = tool({
  name: "save_my_state",
  description:
    "Save the persistent working memory (state) for this conversation. " +
    "Last write wins. The CoS calls this at the end of every turn with the latest " +
    "current_focus, open_questions, and recent_specialist_outputs.",
  parameters: z.object({
    conversation_id: z.string(),
    agent_name: z.string(),
    state: z.record(z.string(), z.any()).describe("The full state JSON to persist."),
  }),
  async execute({ conversation_id, agent_name, state }) {
    await saveState(conversation_id, agent_name, state as CosState);
    return { saved: true };
  },
});
