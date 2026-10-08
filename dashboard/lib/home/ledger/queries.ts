import "server-only";

/**
 * Home, variant "ledger": the reads.
 *
 * ── Where each figure comes from ───────────────────────────────────────────
 * Per client       getHomeData() (lib/home/queries.ts), unchanged: month to
 *                  date and Goals status, agreed retainer (ref.contracts, else
 *                  ClickUp Retainer CZK), profit share and CM3 over baseline
 *                  (statements and the profit share mart, empty today).
 * Monthly CM3      mart.plan_actuals_daily summed per client and month, with
 *                  the month's rate to CZK from ref.fx_rates.
 * Invoices         every task in the ClickUp Invoice Tracker (./invoices.ts).
 * Setup            which clients have rows in ref.contracts, ref.cm3_baseline,
 *                  ref.client_monthly_costs and ops.profit_share_statements.
 *
 * Every read beyond getHomeData is wrapped so a missing table or a refused
 * permission becomes a state the page names, never an error page and never
 * a zero.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { getClientsIncludingInactive } from "@/lib/clients";
import { isMissingObject } from "@/lib/queries/errors";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { getHomeData } from "@/lib/home/queries";
import { readInvoices } from "./invoices";
import { buildLedger, TREND_MONTHS, type MonthRow, type Read } from "./model";
import type { LedgerData } from "./types";

type Raw = Record<string, unknown>;
type BqDate = Parameters<typeof isoDate>[0];

const T = (dataset: string, table: string) => `\`${PROJECT_ID}.${dataset}.${table}\``;

async function readState<T>(label: string, run: () => Promise<T[]>): Promise<Read<T>> {
  try {
    const rows = await run();
    return { state: rows.length === 0 ? "empty" : "ok", rows };
  } catch (error) {
    if (isMissingObject(error)) return { state: "missing", rows: [] };
    const message = String((error as { message?: string } | null)?.message ?? error);
    console.error(`[home/ledger] ${label} unreadable: ${message}`);
    return { state: /permission|access denied/i.test(message) ? "denied" : "error", rows: [] };
  }
}

/**
 * Client x month from the plan's daily actuals, for the trend months and the
 * month in progress. Summing a month and multiplying by that month's rate is
 * the same as converting each day at its month's rate.
 */
async function fetchMonths(): Promise<MonthRow[]> {
  const rows = await query<Raw>(
    `WITH a AS (
       SELECT client_id, date, revenue, cm3
       FROM ${PLAN_TABLES.actualsDaily}
       WHERE date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL @months MONTH)
     ),
     x AS (SELECT client_id, MAX(date) AS last_day FROM a GROUP BY client_id),
     m AS (
       SELECT client_id, DATE_TRUNC(date, MONTH) AS month, COUNT(*) AS days,
              SUM(revenue) AS revenue, SUM(cm3) AS cm3, COUNTIF(cm3 IS NULL) AS cm3_gaps
       FROM a GROUP BY 1, 2
     )
     SELECT m.client_id, m.month, x.last_day, m.days, m.revenue, m.cm3, m.cm3_gaps,
            c.currency, fx.rate
     FROM m
     JOIN x USING (client_id)
     JOIN ${T("ref", "clients")} c USING (client_id)
     LEFT JOIN ${T("ref", "fx_rates")} fx
       ON fx.month_start = m.month AND fx.from_currency = c.currency AND fx.to_currency = 'CZK'
     ORDER BY m.client_id, m.month`,
    { months: TREND_MONTHS + 1 }
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    month: isoDate(r.month as BqDate) ?? "",
    lastDay: isoDate(r.last_day as BqDate),
    days: num(r.days) ?? 0,
    revenue: num(r.revenue),
    cm3: num(r.cm3),
    cm3Gaps: num(r.cm3_gaps) ?? 0,
    currency: String(r.currency),
    rate: num(r.rate),
  }));
}

async function clientIds(dataset: string, table: string, where = "TRUE"): Promise<string[]> {
  const rows = await query<Raw>(`SELECT DISTINCT client_id FROM ${T(dataset, table)} WHERE ${where}`);
  return rows.map((r) => String(r.client_id));
}

async function clientMonths(dataset: string, table: string): Promise<Array<{ clientId: string; month: string }>> {
  const rows = await query<Raw>(
    `SELECT DISTINCT client_id, DATE_TRUNC(month, MONTH) AS month FROM ${T(dataset, table)}
     WHERE month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL @months MONTH)`,
    { months: TREND_MONTHS + 1 }
  );
  return rows.map((r) => ({ clientId: String(r.client_id), month: isoDate(r.month as BqDate) ?? "" }));
}

export async function getLedgerData(now = new Date()): Promise<LedgerData> {
  const [home, registry, months, invoices, contracts, baseline, monthlyCosts, statements] = await Promise.all([
    getHomeData(),
    getClientsIncludingInactive(),
    readState("mart.plan_actuals_daily", fetchMonths),
    readInvoices(),
    readState("ref.contracts", () =>
      clientIds("ref", "contracts", "valid_from <= CURRENT_DATE() AND (valid_to IS NULL OR valid_to >= CURRENT_DATE())")
    ),
    readState("ref.cm3_baseline", () => clientIds("ref", "cm3_baseline")),
    readState("ref.client_monthly_costs", () => clientMonths("ref", "client_monthly_costs")),
    readState("ops.profit_share_statements", () => clientMonths("ops", "profit_share_statements")),
  ]);

  return buildLedger({
    now,
    home,
    registry: registry.map((c) => ({
      clientId: c.clientId,
      name: c.name,
      currency: c.currency,
      shopPlatform: c.shopPlatform,
    })),
    months,
    invoices,
    contracts,
    baseline,
    monthlyCosts,
    statements,
  });
}
