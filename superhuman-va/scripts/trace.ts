#!/usr/bin/env tsx
/**
 * scripts/trace.ts — list, get, or cleanup traces.
 *
 * Usage:
 *   pnpm trace list --turn <turnId>
 *   pnpm trace list --today
 *   pnpm trace cleanup
 */
import { TraceStore } from "../next-app/lib/tracing";

const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

switch (cmd) {
  case "list": {
    const turnId = getFlag("turn");
    if (turnId) {
      const rec = TraceStore.get(turnId);
      if (!rec) {
        console.error(`no trace found for turn ${turnId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(rec, null, 2));
    } else if (getFlag("today")) {
      const today = new Date().toISOString();
      const cost = TraceStore.costByDay(today);
      console.log(JSON.stringify(cost, null, 2));
    } else {
      console.log("Usage: pnpm trace list --turn <turnId> | --today");
      process.exit(1);
    }
    break;
  }
  case "cleanup": {
    const removed = TraceStore.cleanup();
    console.log(`removed ${removed} traces older than 30 days`);
    break;
  }
  default:
    console.log("Usage: pnpm trace <list|cleanup> [flags]");
    process.exit(1);
}
