/**
 * Shared types for the swarm.
 */

export type ReasoningMode = "non_think" | "think_high" | "think_max";

/** Canonical CoS working memory. Persisted in `agent_state`. */
export interface CosState {
  current_focus: string | null;
  open_questions: string[];
  recent_specialist_outputs: {
    agent: string;
    summary: string;
    turn: number;
  }[];
  user_preferences_this_session: Record<string, string>;
  turn_count: number;
}

/** An SSE event emitted by /api/chat. */
export type SSEEvent =
  | { type: "meta"; conversationId: string; turnId: string }
  | { type: "token"; delta: string }
  | { type: "tool_start"; agent: string; tool: string; args: unknown }
  | { type: "tool_done"; agent: string; tool: string; result: unknown }
  | { type: "code_run"; agent: string; snippet: string; stdout: string; error?: string }
  | { type: "handoff"; from: string; to: string }
  | { type: "agent_message"; from: string; to: string; message: string; reply?: string }
  | { type: "conflict"; conflictId: string; question: string; options: { id: string; label: string; recommendation?: boolean }[] }
  | { type: "conflict_resolved"; winner: string; reason: string; strategy: "domain_internal" | "technical_factual" | "values_tradeoff" }
  | { type: "error"; message: string }
  | { type: "done" };

/** Names of all 12 registered specialists. */
export const AGENT_NAMES = [
  "CoS",
  "Memory",
  "Document",
  "Researcher",
  "Planner",
  "Critic",
  "CTO",
  "CFO",
  "CMO",
  "CSO",
  "ADHD",
  "Fitness",
  "Therapist",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/** Per-agent reasoning mode and model config. */
export interface AgentConfig {
  name: AgentName;
  reasoning: ReasoningMode;
  description: string;
}
