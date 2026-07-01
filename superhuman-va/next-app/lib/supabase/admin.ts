// lib/supabase/admin.ts — service-role Supabase client factory.
// ⚠️  BYPASSES Row-Level Security. Only use server-side, with a userId you
// trust (e.g. the one read from the session cookie, or passed in by an
// authenticated route handler). Never expose to the browser.
import "server-only";
import { createClient } from "@supabase/supabase-js";

let _admin: ReturnType<typeof createClient> | null = null;

export function createAdminSupabase() {
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
