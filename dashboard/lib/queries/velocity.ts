import "server-only";

/**
 * Warehouse reads for the Velocity area: `mart.mart_velocity_daily` (spend,
 * purchases, new-creative spend and new packs per client and day) and
 * `mart.mart_velocity_queue` (ClickUp ad tasks by queue bucket), both from
 * migration 281, plus the latest FX rates for the tier and the Goals plan's
 * ad budget for the spend default.
 *
 * ── Before 281 is deployed ─────────────────────────────────────────────────
 * A missing view reads as "no data" (null, or an empty map) through
 * `isMissingObject`, so the pages render n/a. Anything else is re-thrown.
 *
 * ── One query for every client ─────────────────────────────────────────────
 * The views are not partitioned by client, so filtering by client scans the
 * same bytes. Overview reads every client in one query and drops the ones it
 * does not show; the per-client pages filter in SQL for a smaller result.
 *
 * The demo client has no velocity data: every read returns empty for it.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { NEW_CREATIVE_DAYS } from "@/lib/creative/capacity";

type Raw = Record<string, unknown>;

const DAILY = `\`${PROJECT_ID}.mart.mart_velocity_daily\``;
const QUEUE = `\`${PROJECT_ID}.mart.mart_velocity_queue\``;

async function orEmpty<T>(run: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return empty;
  }
}

const n0 = (v: unknown): number => num(v) ?? 0;
const day = (v: unknown): string => String(isoDate(v as never));

/** `YYYY-MM-DD` minus `days`, in UTC. */
function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Trailing summary
// ---------------------------------------------------------------------------

/** One client's trailing figures, ending at the latest loaded day. */
export interface VelocitySummary {
  clientId: string;
  /** Latest loaded day. */
  through: string;
  /** First day of the client's Meta history. */
  historyStart: string;
  currency: string | null;
  spend30d: number;
  /** Measured new-creative share of the last 30 days; null when history is too short to tell. */
  share30d: number | null;
  packs30d: number;
  spend90d: number;
  purchases90d: number;
  /** spend90d / purchases90d; null without purchases. */
  cpa90d: number | null;
  /** New packs in the calendar month of `through`. */
  packsMonth: number;
}

const SUMMARY_SELECT = `
  m AS (
    SELECT client_id, MAX(date) AS through, MIN(history_start) AS history_start,
           ANY_VALUE(currency) AS currency
    FROM v GROUP BY client_id
  )
  SELECT
    m.client_id, m.through, m.history_start, m.currency,
    SUM(IF(v.date > DATE_SUB(m.through, INTERVAL 30 DAY), v.spend, 0))              AS spend_30d,
    SUM(IF(v.date > DATE_SUB(m.through, INTERVAL 30 DAY), v.new_creative_spend, 0)) AS new_spend_30d,
    SUM(IF(v.date > DATE_SUB(m.through, INTERVAL 30 DAY), v.new_packs, 0))          AS packs_30d,
    SUM(IF(v.date > DATE_SUB(m.through, INTERVAL 90 DAY), v.spend, 0))              AS spend_90d,
    SUM(IF(v.date > DATE_SUB(m.through, INTERVAL 90 DAY), v.purchases, 0))          AS purchases_90d,
    SUM(IF(DATE_TRUNC(v.date, MONTH) = DATE_TRUNC(m.through, MONTH), v.new_packs, 0)) AS packs_month
  FROM m JOIN v USING (client_id)
  GROUP BY m.client_id, m.through, m.history_start, m.currency`;

function summaryFrom(r: Raw): VelocitySummary {
  const through = day(r.through);
  const historyStart = day(r.history_start);
  const spend30d = n0(r.spend_30d);
  const spend90d = n0(r.spend_90d);
  const purchases90d = n0(r.purchases_90d);
  // Every ad already running when the history starts counts as new for its
  // first 14 days (281's first-day caveat). A window that reaches back into
  // those days would overstate the share, so it reads n/a instead.
  const windowStart = minusDays(through, 29);
  const clean = minusDays(windowStart, NEW_CREATIVE_DAYS) >= historyStart;
  return {
    clientId: String(r.client_id),
    through,
    historyStart,
    currency: r.currency ? String(r.currency) : null,
    spend30d,
    share30d: clean && spend30d > 0 ? n0(r.new_spend_30d) / spend30d : null,
    packs30d: n0(r.packs_30d),
    spend90d,
    purchases90d,
    cpa90d: purchases90d > 0 ? spend90d / purchases90d : null,
    packsMonth: n0(r.packs_month),
  };
}

/** Every client with rows in the view. */
export async function getVelocitySummaries(): Promise<Map<string, VelocitySummary>> {
  const rows = await orEmpty(
    () => query<Raw>(`WITH v AS (SELECT * FROM ${DAILY}), ${SUMMARY_SELECT}`),
    [] as Raw[]
  );
  return new Map(rows.map((r) => [String(r.client_id), summaryFrom(r)]));
}

/** One client, or null before 281 or without Meta rows. */
export async function getVelocitySummary(clientId: string): Promise<VelocitySummary | null> {
  if (isDemo(clientId)) return null;
  const rows = await orEmpty(
    () =>
      query<Raw>(`WITH v AS (SELECT * FROM ${DAILY} WHERE client_id = @clientId), ${SUMMARY_SELECT}`, {
        clientId,
      }),
    [] as Raw[]
  );
  return rows[0] ? summaryFrom(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// By month
// ---------------------------------------------------------------------------

export interface VelocityMonth {
  /** `YYYY-MM`. */
  month: string;
  spend: number;
  purchases: number;
  newCreativeSpend: number;
  newPacks: number;
  /** True for the month the client's history starts in: first days are not real launches. */
  isFirst: boolean;
}

export async function getVelocityMonths(clientId: string): Promise<VelocityMonth[]> {
  if (isDemo(clientId)) return [];
  const rows = await orEmpty(
    () =>
      query<Raw>(
        `SELECT FORMAT_DATE('%Y-%m', date) AS month,
                SUM(spend) AS spend, SUM(purchases) AS purchases,
                SUM(new_creative_spend) AS new_creative_spend, SUM(new_packs) AS new_packs,
                LOGICAL_OR(DATE_TRUNC(date, MONTH) = DATE_TRUNC(history_start, MONTH)) AS is_first
         FROM ${DAILY}
         WHERE client_id = @clientId
         GROUP BY month
         ORDER BY month`,
        { clientId }
      ),
    [] as Raw[]
  );
  return rows.map((r) => ({
    month: String(r.month),
    spend: n0(r.spend),
    purchases: n0(r.purchases),
    newCreativeSpend: n0(r.new_creative_spend),
    newPacks: n0(r.new_packs),
    isFirst: r.is_first === true,
  }));
}

// ---------------------------------------------------------------------------
// The ClickUp queue
// ---------------------------------------------------------------------------

/** Ad tasks by bucket. Ready and in works are queue; briefing is shown, not counted. */
export interface VelocityQueue {
  ready: number;
  inWorks: number;
  briefing: number;
}

function queuesFrom(rows: Raw[]): Map<string, VelocityQueue> {
  const out = new Map<string, VelocityQueue>();
  for (const r of rows) {
    const id = String(r.client_id);
    // A client with any ClickUp ad task has a queue, even an empty one. The
    // view's `other` bucket is what makes that visible.
    const q = out.get(id) ?? { ready: 0, inWorks: 0, briefing: 0 };
    const tasks = n0(r.tasks);
    if (r.bucket === "ready") q.ready += tasks;
    else if (r.bucket === "in_works") q.inWorks += tasks;
    else if (r.bucket === "briefing") q.briefing += tasks;
    out.set(id, q);
  }
  return out;
}

/** Every client with ClickUp ad tasks. A client missing from the map has no queue (n/a). */
export async function getVelocityQueues(): Promise<Map<string, VelocityQueue>> {
  const rows = await orEmpty(() => query<Raw>(`SELECT client_id, bucket, tasks FROM ${QUEUE}`), [] as Raw[]);
  return queuesFrom(rows);
}

export async function getVelocityQueue(clientId: string): Promise<VelocityQueue | null> {
  if (isDemo(clientId)) return null;
  const rows = await orEmpty(
    () => query<Raw>(`SELECT client_id, bucket, tasks FROM ${QUEUE} WHERE client_id = @clientId`, { clientId }),
    [] as Raw[]
  );
  return queuesFrom(rows).get(clientId) ?? null;
}

// ---------------------------------------------------------------------------
// FX to USD, for the tier
// ---------------------------------------------------------------------------

/**
 * USD per one unit of each currency, from the latest month of `ref.fx_rates`.
 * The table holds USD to CZK and EUR to CZK, so CZK and EUR go through CZK.
 * A currency it cannot reach is absent: the tier then reads n/a.
 */
export async function getUsdRates(): Promise<Map<string, number>> {
  const rows = await orEmpty(
    () =>
      query<Raw>(
        `SELECT from_currency, to_currency, rate
         FROM \`${PROJECT_ID}.ref.fx_rates\`
         WHERE rate > 0
         QUALIFY ROW_NUMBER() OVER (PARTITION BY from_currency, to_currency ORDER BY month_start DESC) = 1`
      ),
    [] as Raw[]
  );
  const rate = (from: string, to: string) =>
    num(rows.find((r) => r.from_currency === from && r.to_currency === to)?.rate);
  const out = new Map<string, number>([["USD", 1]]);
  const czkPerUsd = rate("USD", "CZK");
  if (czkPerUsd) {
    out.set("CZK", 1 / czkPerUsd);
    const czkPerEur = rate("EUR", "CZK");
    if (czkPerEur) out.set("EUR", czkPerEur / czkPerUsd);
  }
  for (const r of rows) {
    const v = num(r.rate);
    if (r.to_currency === "USD" && v && !out.has(String(r.from_currency))) out.set(String(r.from_currency), v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Goals plan's ad budget
// ---------------------------------------------------------------------------

export interface PlanBudget {
  /** "October 2026". */
  label: string;
  amount: number;
}

/**
 * This month's ad spend target from the Goals plan, by client. The plan's
 * ad spend is Meta spend (its actual is `meta_spend`), in the client's trading
 * currency; callers use it only where that equals the Meta account currency.
 */
export async function getPlanBudgets(): Promise<Map<string, PlanBudget>> {
  const rows = await orEmpty(
    () =>
      query<Raw>(
        `SELECT client_id, period_label, target_total
         FROM ${PLAN_TABLES.pacing}
         WHERE period_type = 'month' AND metric = 'ad_spend' AND target_total > 0
           AND CURRENT_DATE() BETWEEN period_start AND period_end`
      ),
    [] as Raw[]
  );
  return new Map(
    rows.map((r) => [String(r.client_id), { label: String(r.period_label), amount: n0(r.target_total) }])
  );
}

export async function getPlanBudget(clientId: string): Promise<PlanBudget | null> {
  if (isDemo(clientId)) return null;
  const rows = await orEmpty(
    () =>
      query<Raw>(
        `SELECT period_label, target_total
         FROM ${PLAN_TABLES.pacing}
         WHERE client_id = @clientId AND period_type = 'month' AND metric = 'ad_spend'
           AND target_total > 0 AND CURRENT_DATE() BETWEEN period_start AND period_end`,
        { clientId }
      ),
    [] as Raw[]
  );
  return rows[0] ? { label: String(rows[0].period_label), amount: n0(rows[0].target_total) } : null;
}
