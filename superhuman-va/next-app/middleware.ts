/**
 * middleware.ts — gate the chat UI behind the session cookie.
 *
 * Unauthenticated requests to /chat (and any sub-route) are redirected to
 * /login. The /api/auth endpoint is allowed through.
 */
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "va_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }
  const cookieHeader = req.headers.get("cookie") ?? "";
  const hasSession = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=`).test(cookieHeader);
  if (hasSession) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
