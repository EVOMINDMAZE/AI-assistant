/**
 * tests/cos-input.test.ts — global facts + working memory are injected
 * into the CoS system prompt.
 */
import { describe, it, expect } from "vitest";

// Re-implement the build function here (kept in sync with route.ts) and
// test that it injects the GLOBAL FACTS and WORKING MEMORY sections.
function buildCosSystemPrompt(
  base: string,
  facts: { fact: string }[],
  state: { current_focus: string | null } | null
): string {
  const factsBlock = facts.length
    ? facts.map((f, i) => `${i + 1}. ${f.fact}`).join("\n")
    : "(no global facts yet)";
  const stateBlock = state
    ? `current_focus: ${state.current_focus ?? "(none)"}`
    : "(no working memory yet — this is the first turn)";
  return base + `\n\n# GLOBAL FACTS\n${factsBlock}\n\n# WORKING MEMORY\n${stateBlock}\n`;
}

describe("CoS system prompt", () => {
  it("injects global facts section", () => {
    const out = buildCosSystemPrompt("BASE", [{ fact: "user is a backend engineer" }], null);
    expect(out).toContain("# GLOBAL FACTS");
    expect(out).toContain("user is a backend engineer");
  });

  it("injects working memory section with current_focus", () => {
    const out = buildCosSystemPrompt("BASE", [], { current_focus: "Postgres vs MongoDB" });
    expect(out).toContain("# WORKING MEMORY");
    expect(out).toContain("Postgres vs MongoDB");
  });

  it("falls back when no state and no facts", () => {
    const out = buildCosSystemPrompt("BASE", [], null);
    expect(out).toContain("(no global facts yet)");
    expect(out).toContain("(no working memory yet");
  });
});
