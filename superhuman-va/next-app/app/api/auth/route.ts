/**
 * /api/auth — POST { password } → 200 + HttpOnly session cookie, or 401.
 *
 * The password is compared against APP_PASSWORD_HASH (bcrypt hash). On success,
 * a session cookie is set with HttpOnly, SameSite=Strict, Path=/, 30-day
 * expiry. The cookie value is a server-generated opaque session token.
 */
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const COOKIE_NAME = "va_session";
const SESSION_TTL_DAYS = 30;

// In-memory session store. For production swap to Redis.
const SESSIONS = new Map<string, number>(); // token → expiry ms

function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const expiry = SESSIONS.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    SESSIONS.delete(token);
    return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const password = body?.password ?? "";
  const hash = process.env.APP_PASSWORD_HASH ?? "";
  if (!hash) {
    return new Response(JSON.stringify({ error: "Auth not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  let ok = false;
  try {
    ok = await bcrypt.compare(password, hash);
  } catch {
    ok = false;
  }
  if (!ok) {
    return new Response(JSON.stringify({ error: "Invalid password" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const token = randomBytes(32).toString("hex");
  SESSIONS.set(token, Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const res = new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  res.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`
  );
  return res;
}

export function isAuthenticated(req: NextRequest): boolean {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = m?.[1];
  return isValidSession(token);
}

export function checkAuthOrThrow(req: NextRequest): Response | null {
  if (isAuthenticated(req)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
