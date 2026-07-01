/**
 * Specialist registry.
 *
 * Maps agent name → { agent, handoff, reasoning }.
 * Adding a new specialist is a 3-step recipe:
 *   1. Create specialists/<name>.ts exporting `agent` and `REASONING`.
 *   2. Import and register it here.
 *   3. Update the CoS prompt if it's a new domain.
 */
import { Agent } from "@openai/agents";
import type { AgentName, ReasoningMode } from "@/lib/agent-types";

export interface RegistryEntry {
  name: AgentName;
  agent: Agent;
  reasoning: ReasoningMode;
  description: string;
}

import { chiefOfStaff } from "./chief-of-staff";
import { memoryAgent } from "./memory-agent";
import { documentAgent } from "./document-agent";
import { researcherAgent } from "./researcher";
import { plannerAgent } from "./planner";
import { criticAgent } from "./critic";
import { ctoAgent } from "./cto";
import { cfoAgent } from "./cfo";
import { cmoAgent } from "./cmo";
import { csoAgent } from "./cso";
import { adhdCoachAgent } from "./adhd-coach";
import { fitnessCoachAgent } from "./fitness-coach";
import { therapistAgent } from "./therapist";

export const REGISTRY: Record<string, RegistryEntry> = {
  CoS: { name: "CoS", agent: chiefOfStaff, reasoning: "think_high", description: "Chief of Staff (user-facing hub)" },
  Memory: { name: "Memory", agent: memoryAgent, reasoning: "non_think", description: "Cross-conversation memory specialist" },
  Document: { name: "Document", agent: documentAgent, reasoning: "non_think", description: "Document RAG specialist" },
  Researcher: { name: "Researcher", agent: researcherAgent, reasoning: "non_think", description: "Web search specialist" },
  Planner: { name: "Planner", agent: plannerAgent, reasoning: "think_high", description: "Task decomposition specialist" },
  Critic: { name: "Critic", agent: criticAgent, reasoning: "think_max", description: "Reviewer + arbitration specialist" },
  CTO: { name: "CTO", agent: ctoAgent, reasoning: "think_high", description: "Architecture, code, tech" },
  CFO: { name: "CFO", agent: cfoAgent, reasoning: "think_high", description: "Finance, ROI, budget" },
  CMO: { name: "CMO", agent: cmoAgent, reasoning: "think_high", description: "Marketing, growth" },
  CSO: { name: "CSO", agent: csoAgent, reasoning: "think_high", description: "Security, compliance" },
  ADHD: { name: "ADHD", agent: adhdCoachAgent, reasoning: "non_think", description: "ADHD productivity coach" },
  Fitness: { name: "Fitness", agent: fitnessCoachAgent, reasoning: "non_think", description: "Fitness & health coach" },
  Therapist: { name: "Therapist", agent: therapistAgent, reasoning: "non_think", description: "Reflective listener" },
};

export const AGENT_NAMES: AgentName[] = Object.keys(REGISTRY) as AgentName[];

export function getAgent(name: string): Agent | undefined {
  return REGISTRY[name]?.agent;
}

export function getReasoning(name: string): ReasoningMode {
  return REGISTRY[name]?.reasoning ?? "think_high";
}

/** Async loader used by `consult_agent` (avoids circular import in Next). */
export async function importAgent(name: string): Promise<Agent> {
  const entry = REGISTRY[name];
  if (!entry) throw new Error(`unknown agent: ${name}`);
  return entry.agent;
}
