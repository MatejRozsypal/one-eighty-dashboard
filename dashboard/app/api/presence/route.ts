/**
 * Presence heartbeat. The browser posts here about once a minute while an
 * internal person is actively on the dashboard (components/presence/
 * Heartbeat.tsx); `lib/presence/store.ts` turns that into streak days and
 * active minutes.
 *
 * The person is the server session, never anything in the request: the body
 * is ignored entirely. Client-role accounts are not tracked and get the same
 * empty 204, so the response says nothing about who is counted.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isInternal } from "@/lib/authz";
import { recordHeartbeat } from "@/lib/presence/store";

export const dynamic = "force-dynamic";

const NO_CONTENT = () => new Response(null, { status: 204 });

export async function POST() {
  // Outside the (app) layout, so this route enforces the session itself.
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !session.user.role) return new Response(null, { status: 401 });
  if (!isInternal(session.user.role) || session.user.mustChangePassword) return NO_CONTENT();

  try {
    await recordHeartbeat(email);
  } catch (error) {
    // Presence is bookkeeping: a failure is logged, never surfaced.
    console.error("[presence] heartbeat failed", error);
  }
  return NO_CONTENT();
}
