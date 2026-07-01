#!/usr/bin/env tsx
/**
 * scripts/trace.ts — list, get, or cleanup traces from Supabase `cost_traces`.
 *
 * Usage:
 *   pnpm trace list --turn <turnId>
 *   pnpm trace list --today
 *   pnpm trace cleanup
 *
 * Requires the Supabase env vars in .env.local to be set
 * (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { TraceStore } from "../next-app/lib/tracing";

const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main() {
  switch (cmd) {
    case "list": {
      const turnId = getFlag("turn");
      if (turnId) {
        const rec = await TraceStore.get(turnId);
        if (!rec) {
          console.error(`no trace found for turn ${turnId}`);
          process.exit(1);
        }
        console.log(JSON.stringify(rec, null, 2));
      } else if (getFlag("today")) {
        const userId = getFlag("user") ?? process.env.USER_ID ?? "local-user";
        const today = new Date().toISOString();
        const cost = await TraceStore.costByDay(userId, today);
        console.log(JSON.stringify(cost, null, 2));
      } else {
        console.log("Usage: pnpm trace list --turn <turnId> | --today [--user <id>]");
        process.exit(1);
      }
      break;
    }
    case "cleanup": {
      const removed = await TraceStore.cleanup();
      console.log(`removed ${removed} traces older than 30 days`);
      break;
    }
    default:
      console.log("Usage: pnpm trace <list|cleanup> [flags]");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
