/**
 * /api/cost/today — daily + per-agent cost breakdown.
 *
 * Reads from the local TraceStore. Returns:
 *   { date, total_usd, by_agent: { CoS: 1.20, CTO: 0.30, ... }, week: [...7 days] }
 */
import { NextRequest } from "next/server";
import { TraceStore } from "@/lib/tracing";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get("userId") ?? "local-user";
  // We don't currently store user_id in traces (they're not user-scoped
  // in the current SQLite schema). For now, return the global breakdown.
  const today = new Date().toISOString();
  const todayCost = TraceStore.costByDay(today);
  const week: { date: string; total_usd: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const c = TraceStore.costByDay(d.toISOString());
    week.push({ date: c.date, total_usd: c.total_usd });
  }
  return new Response(
    JSON.stringify({
      date: todayCost.date,
      total_usd: todayCost.total_usd,
      by_agent: todayCost.by_agent,
      week,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
