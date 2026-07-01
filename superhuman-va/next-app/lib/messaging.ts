/**
 * Agent-to-agent messaging bus, backed by PocketBase `agent_messages`.
 *
 * Every `consult_agent(name, msg)` call:
 *   1. Inserts a row with status=pending
 *   2. Invokes the target agent via the OpenAI Agents SDK
 *   3. Updates the row with status=replied, reply=<text>
 *   4. Returns the reply text to the caller
 *
 * The Team Panel reads from this collection to render the A2A timeline.
 */
import type PocketBase from "pocketbase";

const COLLECTION = "agent_messages";

export interface AgentMessage {
  id: string;
  conversation_id: string;
  turn_id: string;
  from_agent: string;
  to_agent: string;
  message: string;
  reply?: string;
  status: "pending" | "replied" | "errored";
  created: string;
  updated: string;
}

export async function postMessage(
  pb: PocketBase,
  fields: {
    conversation_id: string;
    turn_id: string;
    from_agent: string;
    to_agent: string;
    message: string;
  }
): Promise<AgentMessage> {
  const rec = await pb.collection(COLLECTION).create({
    ...fields,
    status: "pending",
  });
  return rec as unknown as AgentMessage;
}

export async function markReplied(
  pb: PocketBase,
  messageId: string,
  reply: string
): Promise<AgentMessage> {
  const rec = await pb.collection(COLLECTION).update(messageId, {
    reply,
    status: "replied",
  });
  return rec as unknown as AgentMessage;
}

export async function markErrored(
  pb: PocketBase,
  messageId: string,
  error: string
): Promise<AgentMessage> {
  const rec = await pb.collection(COLLECTION).update(messageId, {
    reply: error,
    status: "errored",
  });
  return rec as unknown as AgentMessage;
}

export async function listTurnMessages(
  pb: PocketBase,
  turnId: string
): Promise<AgentMessage[]> {
  const result = await pb.collection(COLLECTION).getList(1, 100, {
    filter: `turn_id="${turnId}"`,
    sort: "created",
  });
  return result.items as unknown as AgentMessage[];
}
