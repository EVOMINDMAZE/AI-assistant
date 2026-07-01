// Lightweight health probe used by docker-compose + the Caddy /healthz route.
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
