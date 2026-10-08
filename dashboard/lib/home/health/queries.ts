import "server-only";

/**
 * Home, "Summary" variant: every read in one place.
 *
 * ── Sources ────────────────────────────────────────────────────────────────
 * Clients, rings, money   getHomeData() (lib/home/queries.ts), unchanged: the
 *                         same pacing rows, actuals, ClickUp fields and agency
 *                         money layer the Home cards read.
 * Daily series            mart.plan_actuals_daily, the last 42 days to each
 *                         client's last day of data plus the same month-to-date
 *                         days a year earlier (revenue, CM3, new customer
 *                         revenue, paid spend).
 * Plan curve              mart.plan_targets_daily, cumulative month target per
 *                         day for revenue and CM3, the month of each client's
 *                         last day of data.
 * New creative share      mart.mart_velocity_daily via getVelocitySummaries().
 *
 * The three reads this page adds feed Highlights only. Each is allowed to
 * fail on its own: it is logged, the rules that needed it produce no
 * sentence, and the Highlights (i) names the source that could not be read.
 * Nothing is ever filled in as zero.
 */

import { query } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { getHomeData } from "@/lib/home/queries";
import { withFallback } from "@/lib/queries/plan";
import { getVelocitySummaries } from "@/lib/queries/velocity";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { buildClientRows } from "./clients";
import { buildHighlights } from "./highlights";
import { buildPinned } from "./pinned";
import type { ClientSeries, CreativeShare, DayPoint, SummaryData } from "./types";

type Raw = Record<string, unknown>;

const day = (v: unknown): string => isoDate(v as Parameters<typeof isoDate>[0]) ?? "";

async function attempt<T>(label: string, run: () => Promise<T>, gaps: string[], empty: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[home/summary] ${label} unreadable: ${(error as Error)?.message ?? error}`);
    gaps.push(label);
    return empty;
  }
}

interface ActualRow {
  clientId: string;
  lastDay: string;
  date: string;
  revenue: number | null;
  cm3: number | null;
  ncr: number | null;
  paid: number | null;
}

async function fetchDaily(): Promise<ActualRow[]> {
  const sql = (full: boolean) => `
    WITH a AS (
      SELECT * FROM ${PLAN_TABLES.actualsDaily}
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 400 DAY)
    ),
    x AS (SELECT client_id, MAX(date) AS last_day FROM a GROUP BY client_id)
    SELECT a.client_id, x.last_day, a.date, a.revenue,
      ${full ? "a.cm3, a.new_customer_revenue, a.paid_spend" : "NULL AS cm3, NULL AS new_customer_revenue, NULL AS paid_spend"}
    FROM a JOIN x USING (client_id)
    WHERE a.date > DATE_SUB(x.last_day, INTERVAL 42 DAY)
       OR a.date BETWEEN DATE_SUB(DATE_TRUNC(x.last_day, MONTH), INTERVAL 1 YEAR)
                     AND DATE_SUB(x.last_day, INTERVAL 1 YEAR)
    ORDER BY a.client_id, a.date`;
  const rows = await withFallback(
    () => query<Raw>(sql(true)),
    () => query<Raw>(sql(false))
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    lastDay: day(r.last_day),
    date: day(r.date),
    revenue: num(r.revenue),
    cm3: num(r.cm3),
    ncr: num(r.new_customer_revenue),
    paid: num(r.paid_spend),
  }));
}

interface TargetRow {
  clientId: string;
  date: string;
  metric: "revenue" | "cm3";
  cum: number | null;
}

async function fetchTargets(): Promise<TargetRow[]> {
  const rows = await query<Raw>(
    `WITH x AS (
       SELECT client_id, MAX(date) AS last_day FROM ${PLAN_TABLES.actualsDaily}
       WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
       GROUP BY client_id
     )
     SELECT t.client_id, t.date, t.metric, MAX(t.target_cum_month) AS target_cum_month
     FROM ${PLAN_TABLES.targetsDaily} t JOIN x USING (client_id)
     WHERE t.metric IN ('revenue', 'cm3')
       AND t.date BETWEEN DATE_TRUNC(x.last_day, MONTH) AND x.last_day
     GROUP BY t.client_id, t.date, t.metric`
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    date: day(r.date),
    metric: String(r.metric) === "cm3" ? "cm3" : "revenue",
    cum: num(r.target_cum_month),
  }));
}

function toSeries(actuals: ActualRow[], targets: TargetRow[]): ClientSeries[] {
  const out = new Map<string, ClientSeries>();
  const target = new Map(targets.map((t) => [`${t.clientId}|${t.date}|${t.metric}`, t.cum]));
  for (const r of actuals) {
    let s = out.get(r.clientId);
    if (!s) {
      s = { clientId: r.clientId, asOf: r.lastDay, days: [] };
      out.set(r.clientId, s);
    }
    const point: DayPoint = {
      date: r.date,
      revenue: r.revenue,
      cm3: r.cm3,
      ncr: r.ncr,
      paid: r.paid,
      revenueTargetCum: target.get(`${r.clientId}|${r.date}|revenue`) ?? null,
      cm3TargetCum: target.get(`${r.clientId}|${r.date}|cm3`) ?? null,
    };
    s.days.push(point);
  }
  return [...out.values()];
}

export async function getSummaryData(): Promise<SummaryData> {
  const gaps: string[] = [];
  const [home, actuals, targets, velocity] = await Promise.all([
    getHomeData(),
    attempt("mart.plan_actuals_daily", fetchDaily, gaps, [] as ActualRow[]),
    attempt("mart.plan_targets_daily", fetchTargets, gaps, [] as TargetRow[]),
    attempt("mart.mart_velocity_daily", () => getVelocitySummaries(), gaps, new Map()),
  ]);

  const series = toSeries(actuals, targets);
  const creative: CreativeShare[] = [...velocity.values()].map((v) => ({
    clientId: v.clientId,
    through: v.through,
    share30d: v.share30d,
    spend30d: v.spend30d,
    currency: v.currency,
  }));

  return {
    pinned: buildPinned(home.clients, series),
    highlights: buildHighlights({ clients: home.clients, series, creative }),
    clients: buildClientRows(home.clients),
    gaps,
  };
}
