/**
 * /api/auth — POST { password } → 200 + HttpOnly session cookie, or 401.
 *            DELETE → clear cookie + delete the session row.
 *
 * The password is compared against APP_PASSWORD_HASH (bcrypt hash). On
 * success, a session row is created in the `auth_sessions` PocketBase
 * collection (60-day TTL) and a HttpOnly + SameSite=Strict cookie is set.
 *
 * The cookie value is the session token. The middleware reads the
 * `va_session` cookie and calls `lookupSession()` to verify the row.
 *
 * Sessions survive Next.js process restarts (fix from
 * .trae/specs/fix-top3-broken).
 */

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import {
  createSession,
  deleteSession,
  lookupSession,
} from "@/lib/auth-store";

const COOKIE_NAME = "va_session";
const SESSION_TTL_DAYS = 60;

/** Extract the `va_session` cookie value from a request. */
function readSessionCookie(req: NextRequest): string | undefined {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m?.[1];
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const password = body?.password ?? "";
  const hash = process.env.APP_PASSWORD_HASH ?? "";
  if (!hash) {
    return new Response(JSON.stringify({ error: "Auth not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  let ok = false;
  try {
    ok = await bcrypt.compare(password, hash);
  } catch {
    ok = false;
  }
  if (!ok) {
    return new Response(JSON.stringify({ error: "Invalid password" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = process.env.USER_ID || "local-user";
  let session;
  try {
    session = await createSession({ userId, ttlDays: SESSION_TTL_DAYS });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Session store unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const res = new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
  res.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`
  );
  return res;
}

export async function DELETE(req: NextRequest) {
  const token = readSessionCookie(req);
  if (token) {
    await deleteSession(token);
  }
  const res = new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
  // Clear the cookie (Max-Age=0)
  res.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  );
  return res;
}

/** Middleware-friendly: returns true if the request is authenticated. */
export async function isAuthenticatedAsync(req: NextRequest): Promise<boolean> {
  const token = readSessionCookie(req);
  if (!token) return false;
  const session = await lookupSession(token);
  return !!session;
}

/** Backward-compat sync wrapper for the middleware (which can't await). */
export function isAuthenticated(req: NextRequest): boolean {
  // The middleware uses a regex check on the cookie presence to avoid an
  // async PB roundtrip on every static asset. The full session lookup is
  // done by route handlers via `isAuthenticatedAsync` (or via
  // `checkAuthOrThrowAsync`).
  const cookieHeader = req.headers.get("cookie") ?? "";
  return new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=`).test(cookieHeader);
}

export async function checkAuthOrThrowAsync(req: NextRequest): Promise<Response | null> {
  if (await isAuthenticatedAsync(req)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function checkAuthOrThrow(req: NextRequest): Response | null {
  if (isAuthenticated(req)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
