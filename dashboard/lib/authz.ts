import "server-only";

/**
 * Authorization decisions — who may see what.
 *
 * Deliberately separate from `lib/auth.ts`, which is *authentication*: proving
 * an account is who it says it is. Everything here answers the second question,
 * the one that actually keeps clients apart, and the one this app got wrong:
 * a signed-in account is not the same as an account entitled to the data on the
 * screen it just asked for.
 *
 * Every function here reads the role from the server-verified session. Nothing
 * in the browser — no URL, no cookie value, no hidden field — can influence it,
 * because the role is re-resolved from Postgres on each token refresh and the
 * JWT itself is signed.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Role } from "@/lib/users/store";

export interface Access {
  email: string;
  role: Role;
  /** Non-null only for `client` — the single client they may see. */
  clientId: string | null;
}

/** The signed-in account's access, or null if there is no usable session. */
export async function currentAccess(): Promise<Access | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const role = session?.user?.role ?? null;
  if (!email || !role) return null;
  return { email, role, clientId: session.user.clientId ?? null };
}

/** True for the agency's own staff — the roles allowed to see across clients. */
export function isInternal(role: Role | null): boolean {
  return role === "agency" || role === "admin";
}

/**
 * Gate a page that exposes information spanning every client.
 *
 * Data Health is the case this exists for: it lists each client by name with
 * their pipeline freshness, plus the agency's own workflow runs. None of that
 * is a single client's business, and under an NDA even the *roster* — which
 * brands are customers of this agency — is not a client's to read.
 *
 * Redirects rather than throwing, so a client-role user who follows a stale
 * link lands somewhere useful instead of on an error.
 */
export async function requireInternalRole(): Promise<Access> {
  const access = await currentAccess();
  if (!access) redirect("/auth/signin");
  if (!isInternal(access.role)) {
    console.warn(
      `[authz] ${access.email} (role=${access.role}) was refused an ` +
        `internal-only page`
    );
    redirect("/snapshot");
  }
  return access;
}
