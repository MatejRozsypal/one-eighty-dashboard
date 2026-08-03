"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAccess = recordAccess;
exports.listAccessLog = listAccessLog;
exports.countRecentRefusals = countRecentRefusals;
require("server-only");
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
const db_1 = require("@/lib/users/db");
/**
 * This table's DDL is deliberately NOT in `db.ts`'s shared schema.
 *
 * That schema is applied before every single Postgres query, including the one
 * that authenticates a sign-in. A mistake in DDL living there takes the whole
 * application down — nobody can log in — which is a wildly disproportionate
 * blast radius for an audit table. Created here instead, behind its own
 * try/catch, the worst case is that logging is unavailable while the dashboard
 * carries on working.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS access_log (
  id                  BIGSERIAL PRIMARY KEY,
  at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email               TEXT NOT NULL,
  role                TEXT NOT NULL,
  event               TEXT NOT NULL CHECK (event IN ('view', 'refused')),
  client_id           TEXT,
  requested_client_id TEXT,
  detail              TEXT
);
CREATE INDEX IF NOT EXISTS access_log_at_idx ON access_log (at DESC);
CREATE INDEX IF NOT EXISTS access_log_client_idx ON access_log (client_id, at DESC);
CREATE INDEX IF NOT EXISTS access_log_email_idx ON access_log (LOWER(email), at DESC);
CREATE INDEX IF NOT EXISTS access_log_refused_idx ON access_log (at DESC) WHERE event = 'refused';
`;
const globalForLog = globalThis;
/** Ensure the table exists. Resolves false when it could not be created. */
function ensureTable() {
    if (!globalForLog.oeAccessLogReady) {
        globalForLog.oeAccessLogReady = (0, db_1.sql)(DDL)
            .then(() => true)
            .catch((error) => {
            const code = error?.code;
            // Two lambdas racing on CREATE ... IF NOT EXISTS: the loser sees a
            // duplicate-object error, which is the race resolving correctly.
            if (code === "23505" || code === "42P07" || code === "42710")
                return true;
            console.error("[accessLog] could not create access_log", error);
            globalForLog.oeAccessLogReady = undefined;
            return false;
        });
    }
    return globalForLog.oeAccessLogReady;
}
async function recordAccess(entry) {
    if (!(0, db_1.userStoreConfigured)())
        return;
    if (!(await ensureTable()))
        return;
    try {
        await (0, db_1.sql)(`INSERT INTO access_log
         (email, role, event, client_id, requested_client_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`, [
            entry.email.toLowerCase(),
            entry.role,
            entry.event,
            entry.clientId,
            entry.requestedClientId ?? null,
            entry.detail ?? null,
        ]);
    }
    catch (error) {
        console.error("[accessLog] could not record access", error);
    }
}
/**
 * Recent entries, newest first.
 *
 * `refusedOnly` is the view that matters in an incident: every time somebody
 * asked for a client that was not theirs.
 */
async function listAccessLog(options = {}) {
    const { limit = 100, clientId, refusedOnly = false } = options;
    const where = [];
    const params = [];
    if (clientId) {
        params.push(clientId);
        where.push(`(client_id = $${params.length} OR requested_client_id = $${params.length})`);
    }
    if (refusedOnly)
        where.push(`event = 'refused'`);
    params.push(Math.min(limit, 500));
    if (!(await ensureTable()))
        return [];
    const rows = await (0, db_1.sql)(`SELECT id, at, email, role, event, client_id, requested_client_id, detail
       FROM access_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY at DESC
      LIMIT $${params.length}`, params);
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
async function countRecentRefusals(days = 30) {
    if (!(await ensureTable()))
        return 0;
    const rows = await (0, db_1.sql)(`SELECT COUNT(*)::text AS n FROM access_log
      WHERE event = 'refused' AND at >= NOW() - ($1 || ' days')::interval`, [String(days)]);
    return Number(rows[0]?.n ?? 0);
}
