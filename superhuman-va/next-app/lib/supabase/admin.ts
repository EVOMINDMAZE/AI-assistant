// lib/supabase/admin.ts — service-role Supabase client factory.
// ⚠️  BYPASSES Row-Level Security. Only use server-side.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

/**
 * Returns a Supabase client using the service-role key.
 * Uses a permissive (untyped) schema for convenience — the typed
 * Database interface is in /types/database.ts for reference but the
 * Supabase JS v2 generic type system is overly strict for our dynamic
 * .from() usage. RLS bypass is the real safety guarantee here.
 */
export function createAdminSupabase(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin env not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
