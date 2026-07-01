# Break CoS ↔ Registry Circular Import

## Why

Real chat messages (anything not matching `SMALL_TALK` regex) return
`[error] Cannot access 'R' before initialization`. The minified `R` is
`chiefOfStaff` in `next-app/lib/agents/specialists/registry.ts` line 35.

**Cycle:**

```
lib/agents/specialists/chief-of-staff.ts
    └─ line 27: import { importAgent } from "./registry"
                                        ↓
lib/agents/specialists/registry.ts
    └─ line 20: import { chiefOfStaff } from "./chief-of-staff"
                                        ↓
                                    (back to top — TDZ)
```

When the chat route runs the first real message, it lazy-loads CoS via
`await import("@/lib/agents/specialists/chief-of-staff")` (line 320 in
`app/api/chat/route.ts`). That triggers `registry.ts` to load, which
re-enters `chief-of-staff.ts` for `chiefOfStaff`. CoS is still in the
middle of being initialized, so the `chiefOfStaff` export is in its
temporal dead zone → TDZ ReferenceError.

**Why small talk works:** the small-talk path (line 247 in
`app/api/chat/route.ts`) returns a canned response without ever
constructing or importing `chiefOfStaff`. That's why "hi" returns
"Hey! What's on your mind?" but "i want you to create a daily schedule"
fails.

**Why this is safe to fix:** the consult tool is for specialists to call
each other. The CoS is the user-facing hub — it calls specialists via
`consult_agent`, but no specialist ever calls CoS. So CoS does not
need to be in the consultable registry.

## What Changes

**Modified:**

- `next-app/lib/agents/specialists/registry.ts`
  - Remove `import { chiefOfStaff } from "./chief-of-staff";` (line 20).
  - Remove the `CoS: { ... }` entry from `REGISTRY` (line 35).
  - Update the file header comment to note that CoS is intentionally
    not in the registry.

- `next-app/lib/agent-types.ts`
  - Remove `"CoS"` from the `AGENT_NAMES` const array (line 36).
  - Update the JSDoc to note that the 12 entries are the consultable
    specialists; CoS is the entry-point hub and lives in
    `specialists/chief-of-staff.ts` but is not consultable.

- `next-app/lib/agents/specialists/chief-of-staff.ts`
  - No code changes needed — once registry doesn't import CoS, the
    cycle is broken and `import { importAgent } from "./registry"`
    works.
  - The CoS prompt's roster section (line 90,
    `${AGENT_NAMES.map((n) => `- ${n}`).join("\n")}`) will now show
    12 specialist names without "CoS" — that's correct, the CoS
    is the hub and doesn't list itself.
  - The `setRegisteredAgentNames([...AGENT_NAMES])` call (line 32) will
    register 12 names (not 13), which is the correct schema for the
    `consult_agent` tool.

**No breaking changes** for callers:
- `app/api/chat/route.ts` still lazy-loads
  `@/lib/agents/specialists/chief-of-staff` and uses
  `chiefOfStaff.instructions`, `chiefOfStaff.name`, `chiefOfStaff.tools`.
  These work unchanged.
- The 12 specialists in `REGISTRY` still resolve via
  `importAgent(name)`. The `consult_agent` tool can still consult
  Memory, Document, Researcher, Planner, Critic, CTO, CFO, CMO, CSO,
  ADHD, Fitness, Therapist.
- The `agent_messages` table, the consult depth/budget guards, and
  the resolve_conflict flow are unaffected.

## Impact

- Affected code:
  - `next-app/lib/agents/specialists/registry.ts` (remove 1 import,
    1 REGISTRY entry)
  - `next-app/lib/agent-types.ts` (remove 1 name from `AGENT_NAMES`)
- No other files need to change.
- The chat route's lazy import becomes effectively a no-op for the
  cycle (CoS now has a clean DAG), but we keep the lazy import as a
  safety belt.

## ADDED Requirements

### Requirement: No circular import between CoS and registry

`lib/agents/specialists/registry.ts` SHALL NOT import
`chief-of-staff` (directly or transitively). The CoS SHALL be
excluded from `REGISTRY`.

#### Scenario: Chat route loads CoS on first real message
- **WHEN** the user sends a real (non-small-talk) message
- **THEN** the `await import("@/lib/agents/specialists/chief-of-staff")`
  call in the chat route SHALL NOT throw
  `ReferenceError: Cannot access '<X>' before initialization` for
  any module-level binding in the load chain

### Requirement: CoS is not in the consultable agent list

`AGENT_NAMES` (in `lib/agent-types.ts`) SHALL contain only the 12
specialists. "CoS" SHALL NOT be present.

#### Scenario: consult_agent tool schema is generated
- **WHEN** `setRegisteredAgentNames([...AGENT_NAMES])` runs at CoS
  module load
- **THEN** the schema description for `agent_name` lists 12 names,
  not 13, and "CoS" is not among them

### Requirement: Specialists still consultable

All 12 specialist agents SHALL still be reachable via
`importAgent(name)`. Calling `consult_agent("Memory", "...")` SHALL
return the Memory agent's reply, same as before.

#### Scenario: Specialist-to-specialist consult
- **WHEN** CoS calls `consult_agent("CTO", "should I use Redis?")`
- **THEN** the consult tool loads `ctoAgent` from the registry and
  runs the CTO agent's `Runner.run()`, returning the reply

### Requirement: CoS prompt is unchanged in structure

The CoS system prompt SHALL still be a `ChiefOfStaff` agent with
`MODEL`, the same tool list, the same prompt template, and the
specialist roster (now 12 lines instead of 13).

## MODIFIED Requirements

(none — this is purely a build-time circularity fix; no spec
capability is changed)

## REMOVED Requirements

(none)

## Migration

No data migration. The deployment self-heals on first request after
the new code is deployed (the broken module state is per-function
instance; Vercel will spawn a fresh instance on the next request).
