#!/usr/bin/env node
/**
 * scripts/apply-migrations.mjs — apply every .sql file under
 * supabase/migrations/ to the Supabase project via the Management API
 * (https://api.supabase.com/v1/projects/{ref}/database/query).
 *
 * The sandbox can't open a direct TCP connection to the Postgres pooler,
 * but it CAN reach the Management API. Each .sql file is sent as a single
 * multi-statement query; the API runs them sequentially.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PROJECT_REF = process.env.PROJECT_REF || "onzcjkppkiuupvlgtims";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is required");
  process.exit(1);
}

const MIG_DIR = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
console.log(`[migrate] Found ${files.length} migration files: ${files.join(", ")}`);

for (const f of files) {
  const path = join(MIG_DIR, f);
  const sql = readFileSync(path, "utf8");
  console.log(`\n[migrate] Applying ${f} (${sql.length} bytes)...`);
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[migrate] FAILED ${f}: HTTP ${res.status}\n${text}`);
    process.exit(1);
  }
  console.log(`[migrate] OK ${f}: ${text.slice(0, 200)}`);
}

console.log("\n[migrate] Done. All migrations applied.");
