// /api/cron/cleanup — Vercel cron route (0 3 * * *).
//
// Runs nightly to:
//   1. Prune cost_traces rows older than 30 days
//   2. Best-effort: trigger any other periodic cleanup
//
// Authentication: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
// If the header is missing or wrong, return 401 to stop the cron.
import { NextRequest, NextResponse } from "next/server";
import { TraceStore } from "@/lib/tracing";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth || !process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const removed = await TraceStore.cleanup();
  return NextResponse.json({
    ok: true,
    cost_traces_removed: removed,
    ran_at: new Date().toISOString(),
  });
}
