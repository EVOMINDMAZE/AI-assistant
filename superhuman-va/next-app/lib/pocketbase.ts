// PocketBase client for the Next.js server.
// We hold a single admin-authenticated client at module scope and lazily
// refresh the token if it expires.
import "server-only";
import PocketBase from "pocketbase";

declare global {
  // eslint-disable-next-line no-var
  var __pb_admin__: PocketBase | undefined;
}

function makeClient() {
  const url = process.env.NEXT_PUBLIC_PB_URL ?? "http://localhost:8090";
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  return pb;
}

export function getPb(): PocketBase {
  if (!global.__pb_admin__) {
    global.__pb_admin__ = makeClient();
  }
  return global.__pb_admin__;
}

export async function pbAsAdmin(): Promise<PocketBase> {
  const pb = getPb();
  if (pb.authStore.isValid) return pb;

  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "PocketBase admin credentials not set in env (PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD)."
    );
  }
  await pb.admins.authWithPassword(email, password);
  return pb;
}
