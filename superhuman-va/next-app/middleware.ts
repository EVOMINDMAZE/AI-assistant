/**
 * Next.js middleware — currently a no-op pass-through.
 *
 * Real auth enforcement happens in the server components of the
 * protected routes themselves (see `app/chat/page.tsx`). A full
 * Edge-runtime-compatible Supabase Auth middleware needs a
 * separate Edge-safe import path; for now, the chat page's
 * server-component-level check is sufficient.
 */
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/chat", "/settings", "/conversations"];

export function middleware(req: NextRequest) {
  // Pass through. Auth check is done in the page-level server component
  // (which can use the Node.js runtime and the regular Supabase clients).
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
