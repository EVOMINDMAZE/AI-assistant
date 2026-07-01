/**
 * Auth session store backed by PocketBase.
 *
 * Replaces the in-memory `SESSIONS` map from the original `/api/auth` so
 * sessions survive Next.js process restarts (fix from
 * .trae/specs/fix-top3-broken).
 *
 * Each session is a row in the `auth_sessions` collection with:
 *   - token         (32 random bytes hex, unique)
 *   - user_id       (string, e.g. "local-user")
 *   - expires_at    (ISO date string)
 *   - created_at    (ISO date string, optional)
 *
 * Lookups also do an opportunistic cleanup: if `expires_at < now`, the
 * row is deleted and the lookup returns null.
 */

import { randomBytes } from "crypto";
import { pbAsAdmin } from "@/lib/pocketbase";

const DEFAULT_TTL_DAYS = 60;
const COLLECTION = "auth_sessions";

export interface SessionInfo {
  token: string;
  userId: string;
  expiresAt: string; // ISO
  createdAt?: string; // ISO
}

export interface CreateSessionOpts {
  userId: string;
  ttlDays?: number;
}

/** Create a new session. Returns the opaque token + metadata. */
export async function createSession(opts: CreateSessionOpts): Promise<SessionInfo> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000);
  const pb = await pbAsAdmin();
  try {
    const row = await pb.collection(COLLECTION).create({
      token,
      user_id: opts.userId,
      expires_at: expires.toISOString(),
      created_at: now.toISOString(),
    });
    return {
      token: row.token,
      userId: row.user_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  } catch (e) {
    console.error("[auth-store] createSession failed:", e);
    throw e;
  }
}

/** Look up a session by token. Returns null if not found, expired, or
 *  on any error. Opportunistically deletes expired rows. */
export async function lookupSession(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token) return null;
  let pb;
  try {
    pb = await pbAsAdmin();
  } catch {
    return null;
  }
  let row: any = null;
  try {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `token="${token.replace(/"/g, '\\"')}"`,
    });
    row = list.items?.[0];
  } catch (e) {
    console.warn("[auth-store] lookupSession failed:", e);
    return null;
  }
  if (!row) return null;
  const expiresAt = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    // Expired — clean up
    try {
      await pb.collection(COLLECTION).delete(row.id);
    } catch {}
    return null;
  }
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/** Delete a session by token. No-op if not found. */
export async function deleteSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  let pb;
  try {
    pb = await pbAsAdmin();
  } catch {
    return;
  }
  try {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `token="${token.replace(/"/g, '\\"')}"`,
    });
    for (const r of list.items ?? []) {
      await pb.collection(COLLECTION).delete(r.id);
    }
  } catch (e) {
    console.warn("[auth-store] deleteSession failed:", e);
  }
}

/** Delete all expired sessions. Called by a daily cron / scheduled job. */
export async function cleanupExpiredSessions(): Promise<number> {
  let pb;
  try {
    pb = await pbAsAdmin();
  } catch {
    return 0;
  }
  try {
    const cutoff = new Date().toISOString();
    const list = await pb.collection(COLLECTION).getList(1, 500, {
      filter: `expires_at < "${cutoff}"`,
    });
    let n = 0;
    for (const r of list.items ?? []) {
      try {
        await pb.collection(COLLECTION).delete(r.id);
        n++;
      } catch {}
    }
    return n;
  } catch {
    return 0;
  }
}
