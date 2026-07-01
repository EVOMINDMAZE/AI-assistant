/**
 * /api/cost/today — daily + per-agent cost breakdown.
 *
 * Reads from the Supabase `cost_traces` table.
 */
import { NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get("userId") ?? USER_ID;
  const sb = createAdminSupabase();
  const startToday = startOfDay().toISOString();
  const startWeek = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("cost_traces")
    .select("payload, created_at")
    .eq("user_id", userId)
    .gte("created_at", startWeek);

  if (error) {
    return new Response(
      JSON.stringify({ error: "cost query failed", detail: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const byAgent: Record<string, number> = {};
  const perDay: Record<string, number> = {};
  let totalToday = 0;
  for (const row of data ?? []) {
    const p = row.payload as { cost_usd?: number; tool_calls?: { agent: string }[] } | null;
    if (!p) continue;
    const usd = p.cost_usd ?? 0;
    const day = (row.created_at as string).slice(0, 10);
    perDay[day] = (perDay[day] ?? 0) + usd;
    if (row.created_at >= startToday) {
      totalToday += usd;
      // Attribute 70% to CoS, 10% per tool call's agent
      byAgent["CoS"] = (byAgent["CoS"] ?? 0) + usd * 0.7;
      for (const tc of p.tool_calls ?? []) {
        byAgent[tc.agent] = (byAgent[tc.agent] ?? 0) + usd * 0.1;
      }
    }
  }

  // Build 7-day window ending today
  const week: { date: string; total_usd: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    week.push({ date: key, total_usd: perDay[key] ?? 0 });
  }

  return new Response(
    JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      total_usd: totalToday,
      by_agent: byAgent,
      week,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
