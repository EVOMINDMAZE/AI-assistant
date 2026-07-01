/**
 * Next.js middleware — enforces Supabase Auth on protected routes.
 *
 * Unauthenticated requests to `/chat` (and any other protected path) are
 * redirected to `/login`. The `?next=` query param is preserved so the
 * login page can send the user back to the page they were trying to view.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/chat", "/settings", "/conversations"];
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/cron"];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Allow public paths through unconditionally.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // Static assets / Next internals.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/health") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Build a Supabase client that reads/writes the session cookie.
  const res = NextResponse.next();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return req.cookies.get(name)?.value;
        },
        set(name, value, options) {
          req.cookies.set({ name, value, ...options });
          res.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          req.cookies.set({ name, value: "", ...options });
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
