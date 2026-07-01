// lib/supabase/client.ts — browser-side Supabase client factory.
// Used in client components for sign-in, sign-out, and any user-driven reads.
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
