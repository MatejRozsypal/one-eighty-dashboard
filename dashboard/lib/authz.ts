import "server-only";

/**
 * Authorization decisions: who may see what.
 *
 * Deliberately separate from `lib/auth.ts`, which is *authentication*: proving
 * an account is who it says it is. Everything here answers the second question,
 * the one that actually keeps clients apart, and the one this app got wrong:
 * a signed-in account is not the same as an account entitled to the data on the
 * screen it just asked for.
 *
 * Every function here reads the role from the server-verified session. Nothing
 * in the browser: no URL, no cookie value, no hidden field, can influence it,
 * because the role is re-resolved from Postgres on each token refresh and the
 * JWT itself is signed.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Role } from "@/lib/users/store";
import { recordAccess } from "@/lib/users/accessLog";
import { REPORTS_ROLES } from "@/lib/reports/contracts";

export interface Access {
  email: string;
  role: Role;
  /** Non-null only for `client`, the single client they may see. */
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

/** True for the agency's own staff, the roles allowed to see across clients. */
export function isInternal(role: Role | null): boolean {
  return role === "agency" || role === "admin";
}

/**
 * Gate a page that exposes information spanning every client.
 *
 * Data Health is the case this exists for: it lists each client by name with
 * their pipeline freshness, plus the agency's own workflow runs. None of that
 * is a single client's business, and under an NDA even the *roster*, which
 * brands are customers of this agency, is not a client's to read.
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

/**
 * Gate an action that changes business configuration, targets, cost
 * assumptions.
 *
 * Agency is enough here and deliberately so. These are stated inputs about how
 * the business is run, which is the agency's actual job; requiring an admin to
 * type a monthly target would put a security role in the way of routine work
 * and, predictably, end with admin being handed out to people who only needed
 * to edit a number.
 *
 * Access itself is a different question and stays with `requireAdminRole`.
 */
export async function requireInternalForConfig(): Promise<Access> {
  const access = await currentAccess();
  if (!access || !isInternal(access.role)) {
    throw new Error("Not authorised.");
  }
  return access;
}

/**
 * Gate an action that changes who can get in.
 *
 * Admin only, separate from config on purpose: granting access is the one
 * operation whose blast radius is other clients' data.
 */
export async function requireAdminRole(): Promise<Access> {
  const access = await currentAccess();
  if (access?.role !== "admin") {
    throw new Error("Not authorised.");
  }
  return access;
}

// ---------------------------------------------------------------------------
// Reports (cross-client report builder)
// ---------------------------------------------------------------------------

/**
 * Reports is the first surface that returns several clients' figures in one
 * response, so its gate is stricter than `isInternal()`: the role must be in
 * REPORTS_ROLES (admin, agency; never client) AND the email must be on an
 * internal domain (ALLOWED_EMAIL_DOMAIN, default oneeighty.cz).
 *
 * Why the domain on top of the role: `app_users` is the allow-list and an
 * admin can give any address the agency role, for example a freelancer on a
 * personal Gmail. That is fine for single-client pages, where `resolveClient`
 * scopes and logs every view. A report hands over the whole roster's numbers
 * at once, so it additionally requires an account the agency itself controls.
 *
 * Enforced in layers (design 3.1), each failing closed on its own:
 *   1. `app/(app)/reports/layout.tsx`: requireReportsAccess()
 *   2. each reports page: requireReportsAccess() again
 *   3. `app/api/reports/query/route.ts`: reportsAccessOrNull() before parsing
 *      the body or touching any cache; 404 on failure
 *   4. every server action in `app/(app)/reports/actions.ts`: assertReportsAccess()
 *   5. inside `lib/reports/run.ts`, `store.ts`, `clients.ts`, `benchmarks.ts`:
 *      assertReportsAccess(), so a future page that imports them by mistake
 *      throws instead of serving data
 *   6. rail and nav hiding: presentation only, never relied on
 */

export { REPORTS_ROLES };

/** Internal domains, read per call so a test or env change is honoured. Lower-cased, empty entries dropped. */
function internalDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAIN ?? "oneeighty.cz")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * The domain of a single, well-formed address, lower-cased; null otherwise.
 * Exactly one "@" and a non-empty local part, so "a@b@oneeighty.cz" and
 * "@oneeighty.cz" are refused rather than parsed generously.
 */
function emailDomain(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return null;
  const domain = trimmed.slice(at + 1).toLowerCase();
  return domain.length > 0 ? domain : null;
}

/**
 * Pure decision, no session read: true only for a REPORTS_ROLES role, no
 * client assignment, and an email on an internal domain (exact match, so a
 * look-alike such as "oneeighty.cz.evil.com" or a subdomain does not pass).
 *
 * The `clientId === null` condition is belt and braces: internal roles never
 * carry a client (lib/users/store.ts writes NULL for them), so a row that does
 * is inconsistent and is refused rather than trusted.
 */
export function canUseReports(access: Access | null): access is Access {
  if (!access) return false;
  if (!(REPORTS_ROLES as readonly string[]).includes(access.role)) return false;
  if (access.clientId !== null && access.clientId !== undefined) return false;
  const domain = emailDomain(access.email ?? "");
  return domain !== null && internalDomains().includes(domain);
}

/**
 * Record a refusal for an identified account. Anonymous requests have no
 * email or role to record (the access_log columns are NOT NULL) and are
 * simply refused. Never throws: recordAccess swallows its own failures.
 */
async function refuseReports(access: Access | null, where: string): Promise<void> {
  if (!access?.email || !access.role) return;
  console.warn(`[authz] ${access.email} (role=${access.role}) was refused Reports (${where})`);
  await recordAccess({
    email: access.email,
    role: access.role,
    event: "refused",
    clientId: null,
    detail: `reports:${where}`,
  });
}

/** Pages and layouts. Sign-in when there is no session, /snapshot when not allowed. */
export async function requireReportsAccess(): Promise<Access> {
  const access = await currentAccess();
  if (!access) redirect("/auth/signin");
  if (!canUseReports(access)) {
    await refuseReports(access, "page");
    redirect("/snapshot");
  }
  return access;
}

/**
 * Route handlers. Null on any failure; the caller answers 404 with an empty
 * body, so a refused caller cannot tell "forbidden" from "no such route or
 * report".
 */
export async function reportsAccessOrNull(): Promise<Access | null> {
  const access = await currentAccess();
  if (canUseReports(access)) return access;
  await refuseReports(access, "api");
  return null;
}

/** Server actions and lib functions. Throws the same message as the other asserts here. */
export async function assertReportsAccess(): Promise<Access> {
  const access = await currentAccess();
  if (canUseReports(access)) return access;
  await refuseReports(access, "lib");
  throw new Error("Not authorised.");
}
