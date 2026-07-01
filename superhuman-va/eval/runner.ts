#!/usr/bin/env tsx
/**
 * eval/runner.ts — replay each golden question against the live CoS and
 * check the expected substrings + expected specialists. Exits 1 on any
 * failure. Used as a CI gate.
 *
 * Usage: pnpm eval
 */
import { readFileSync } from "fs";
import { join } from "path";
import { chiefOfStaff } from "../next-app/lib/agents/specialists/chief-of-staff";
import { Runner } from "@openai/agents";
import { deepseekModel } from "../next-app/lib/agents/model";

// Minimal YAML parser for our flat list of mappings.
// (Avoid adding a heavy dep — the file is hand-written and flat.)
function parseYamlFlat(text: string): any[] {
  const items: any[] = [];
  const blocks = text.split(/\n\n(?=- id:)/);
  for (const block of blocks) {
    const obj: any = {};
    const lines = block.split("\n");
    let currentArray: string[] | null = null;
    let arrayKey: string | null = null;
    for (const line of lines) {
      const m = line.match(/^(\s*)([^:]+):\s*(.*)$/);
      if (!m) continue;
      const [, , key, value] = m;
      if (value === "" && key.trim() !== "note") {
        currentArray = [];
        arrayKey = key.trim();
        obj[arrayKey] = currentArray;
      } else if (currentArray && line.startsWith("  - ")) {
        const v = line.slice(4).trim().replace(/^["']|["']$/g, "");
        currentArray.push(v);
      } else if (currentArray && /^\s*-\s/.test(line)) {
        // nested list — flatten
        const v = line.trim().slice(2).replace(/^["']|["']$/g, "");
        currentArray.push(v);
      } else {
        currentArray = null;
        arrayKey = null;
        obj[key.trim()] = value.replace(/^["']|["']$/g, "").trim();
      }
    }
    items.push(obj);
  }
  return items;
}

interface GoldenQuestion {
  id: string;
  input: string;
  expected_substrings: string[];
  expected_specialists: string[];
  expected_no_specialists: string[];
  category: string;
  note?: string;
}

async function replayOne(q: GoldenQuestion): Promise<{ pass: boolean; reason: string; observed: string[] }> {
  const consulted = new Set<string>();
  let finalText = "";

  try {
    const runner = new Runner({ model: deepseekModel });
    const result = await runner.run(chiefOfStaff, q.input, {
      context: {
        conversationId: `eval-${q.id}`,
        userId: "eval-user",
        turnId: `eval-${q.id}`,
        reasoning: "think_high",
        fromAgent: "CoS",
        a2aDepth: 0,
        a2aConsultsThisTurn: 0,
      },
      stream: true,
    } as any);
    if (Symbol.asyncIterator in Object(result)) {
      for await (const evt of result as any) {
        // tool_start
        if (evt?.type === "run_item_stream_event") {
          const item = evt?.item ?? evt?.data;
          if (item?.type === "tool_call" && item?.name === "consult_agent") {
            const args = typeof item.arguments === "string" ? JSON.parse(item.arguments) : item.arguments;
            if (args?.agent_name) consulted.add(args.agent_name);
          }
        }
        // text deltas
        if (evt?.type === "raw_model_stream_event") {
          const raw = evt?.data;
          if (raw?.type === "output_text_delta" && raw?.delta) {
            finalText += raw.delta;
          }
        }
      }
    } else {
      finalText = String((result as any).finalOutput ?? "");
    }
  } catch (err) {
    return { pass: false, reason: `runner error: ${(err as Error).message}`, observed: [] };
  }

  // Check substrings (any of them)
  const foundSubstr = q.expected_substrings.some((s) =>
    finalText.toLowerCase().includes(s.toLowerCase())
  );
  if (!foundSubstr) {
    return {
      pass: false,
      reason: `expected substrings not found: ${q.expected_substrings.join(", ")}`,
      observed: [finalText.slice(0, 200)],
    };
  }

  // Check specialists consulted
  if (q.expected_specialists.length > 0) {
    const ok = q.expected_specialists.some((s) => consulted.has(s));
    if (!ok) {
      return {
        pass: false,
        reason: `expected at least one of [${q.expected_specialists.join(", ")}] consulted; got [${[...consulted].join(", ")}]`,
        observed: [finalText.slice(0, 200)],
      };
    }
  }

  // Check specialists NOT consulted
  for (const bad of q.expected_no_specialists) {
    if (consulted.has(bad)) {
      return {
        pass: false,
        reason: `forbidden specialist consulted: ${bad}`,
        observed: [finalText.slice(0, 200)],
      };
    }
  }

  return { pass: true, reason: "ok", observed: [finalText.slice(0, 200)] };
}

async function main() {
  const file = readFileSync(join(__dirname, "golden.yaml"), "utf8");
  const questions = parseYamlFlat(file) as GoldenQuestion[];
  console.log(`\n=== Running ${questions.length} golden questions ===\n`);
  let pass = 0;
  let fail = 0;
  const failures: { id: string; reason: string }[] = [];
  for (const q of questions) {
    process.stdout.write(`[${q.category}] ${q.id} ... `);
    const r = await replayOne(q);
    if (r.pass) {
      pass += 1;
      console.log("PASS");
    } else {
      fail += 1;
      console.log(`FAIL — ${r.reason}`);
      failures.push({ id: q.id, reason: r.reason });
    }
  }
  console.log(`\n=== Results: ${pass}/${questions.length} passed ===\n`);
  if (fail > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f.id}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
