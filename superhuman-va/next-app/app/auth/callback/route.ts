// /auth/callback — Supabase OAuth/magic-link landing page.
// Exchanges the auth code for a session cookie via @supabase/ssr.
import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/chat";
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url));
  }
  const sb = createServerSupabase();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url));
  }
  return NextResponse.redirect(new URL(next, url));
}
