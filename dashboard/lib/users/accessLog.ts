import "server-only";

/**
 * The access log — who saw whose data, and who tried to.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `resolveClient` already stops a client-role account reading another client's
 * numbers. That satisfies the security requirement. It does not satisfy the
 * compliance one, which is a different question asked at a different time: six
 * months from now, under an NDA, somebody asks "can you show that nobody at
 * Dobias ever saw our figures". A console line in Vercel's retention window
 * cannot answer that. A table can.
 *
 * ── Why it is written from `resolveClient` ──────────────────────────────────
 * Every data page funnels through that one function to turn `?client=` into the
 * client it renders, exactly once per render. So it is the only place that sees
 * every access with the identity, the role, what was asked for and what was
 * actually served — and the only place where adding a row cannot be forgotten
 * when the fourteenth page is written.
 *
 * ── Why a failure here is swallowed ─────────────────────────────────────────
 * Logging must never be able to take the dashboard down. If Postgres is
 * unreachable the page still renders: the access has already been *authorised*
 * correctly by the caller, and refusing to serve data because the audit trail
 * is unavailable trades a real outage for a bookkeeping gap. The failure is
 * reported to the console so it is not silent.
 *
 * The deliberate consequence: this log is evidence, not an enforcement
 * mechanism, and a gap in it means "we could not record", never "nobody
 * accessed". Anyone reading it for an audit needs to know that.
 */

import { sql } from "@/lib/users/db";
import { userStoreConfigured } from "@/lib/users/db";

export type AccessEvent = "view" | "refused";

export interface AccessEntry {
  email: string;
  role: string;
  event: AccessEvent;
  /** The client actually served. */
  clientId: string | null;
  /** Recorded only when the URL asked for something other than what was served. */
  requestedClientId?: string | null;
  detail?: string | null;
}

export async function recordAccess(entry: AccessEntry): Promise<void> {
  if (!userStoreConfigured()) return;

  try {
    await sql(
      `INSERT INTO access_log
         (email, role, event, client_id, requested_client_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.email.toLowerCase(),
        entry.role,
        entry.event,
        entry.clientId,
        entry.requestedClientId ?? null,
        entry.detail ?? null,
      ]
    );
  } catch (error) {
    console.error("[accessLog] could not record access", error);
  }
}

export interface AccessRow {
  id: string;
  at: string;
  email: string;
  role: string;
  event: AccessEvent;
  clientId: string | null;
  requestedClientId: string | null;
  detail: string | null;
}

interface Row extends Record<string, unknown> {
  id: string;
  at: Date;
  email: string;
  role: string;
  event: AccessEvent;
  client_id: string | null;
  requested_client_id: string | null;
  detail: string | null;
}

/**
 * Recent entries, newest first.
 *
 * `refusedOnly` is the view that matters in an incident: every time somebody
 * asked for a client that was not theirs.
 */
export async function listAccessLog(options: {
  limit?: number;
  clientId?: string;
  refusedOnly?: boolean;
} = {}): Promise<AccessRow[]> {
  const { limit = 100, clientId, refusedOnly = false } = options;

  const where: string[] = [];
  const params: unknown[] = [];

  if (clientId) {
    params.push(clientId);
    where.push(
      `(client_id = $${params.length} OR requested_client_id = $${params.length})`
    );
  }
  if (refusedOnly) where.push(`event = 'refused'`);

  params.push(Math.min(limit, 500));

  const rows = await sql<Row>(
    `SELECT id, at, email, role, event, client_id, requested_client_id, detail
       FROM access_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY at DESC
      LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: String(r.id),
    at: r.at.toISOString(),
    email: r.email,
    role: r.role,
    event: r.event,
    clientId: r.client_id,
    requestedClientId: r.requested_client_id,
    detail: r.detail,
  }));
}

/** Count of refusals in the last N days — the number worth alerting on. */
export async function countRecentRefusals(days = 30): Promise<number> {
  const rows = await sql<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM access_log
      WHERE event = 'refused' AND at >= NOW() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return Number(rows[0]?.n ?? 0);
}
