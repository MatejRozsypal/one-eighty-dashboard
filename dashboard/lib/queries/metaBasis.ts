/**
 * Campaign and day level Meta purchases and purchase value on the standard
 * basis (7-day click + 1-day view), for the reads whose mart has no basis
 * columns.
 *
 * `mart_meta_campaign_perf` and `mart_daily_kpis` (meta_revenue, meta_purchases)
 * carry only the figure on each ad set's own attribution setting. The ad mart
 * carries the basis (ME2, migration 256). Summed to a campaign and day, the ad
 * mart equals the campaign mart on purchases and purchase value for every
 * campaign day that has ad rows (checked live 2026-10-05, Dobias, Ethia and
 * Manami: zero mismatching days), so it replaces the stored figure one for one.
 * A campaign day without ad rows (Venev before its ad history starts) keeps the
 * stored figure.
 *
 * Pure SQL text, no server-only import: the check scripts load it.
 */

import { basisPurchasesSql, basisRevenueSql } from "@/lib/creative/attribution";

/**
 * A CTE body of the basis, one row per `date` (and `campaign_id` when
 * `byCampaign`), with `revenue` and `purchases`. `dateClause` is a predicate
 * written on the column `date`; `client_id` is `@clientId`.
 *
 * `ccy: "meta"` keeps the Meta ad account currency (the Paid > Meta tab).
 * `ccy: "client"` converts revenue to the client's currency with the month's
 * rate exactly as the marts do (`mart_daily_kpis.meta_revenue`,
 * `mart_meta_campaign_perf.revenue_client_ccy`): identity when the currencies
 * are equal, and a row whose rate is missing drops out of the sum.
 */
export function metaBasisSql(
  projectId: string,
  opts: { byCampaign: boolean; ccy: "meta" | "client"; dateClause: string }
): string {
  const keys = opts.byCampaign ? "a.date, a.campaign_id" : "a.date";
  const where = `a.client_id = @clientId AND (${opts.dateClause.replace(/\bdate\b/g, "a.date")})`;
  if (opts.ccy === "meta") {
    return `SELECT ${keys},
           SUM(${basisRevenueSql("a")})   AS revenue,
           SUM(${basisPurchasesSql("a")}) AS purchases
    FROM \`${projectId}.mart.mart_meta_ad_perf\` a
    WHERE ${where}
    GROUP BY ${keys}`;
  }
  return `SELECT ${keys},
           SUM(${basisRevenueSql("a")} * IF(cl.meta_currency = cl.currency, NUMERIC '1', mfx.rate)) AS revenue,
           SUM(${basisPurchasesSql("a")}) AS purchases
    FROM \`${projectId}.mart.mart_meta_ad_perf\` a
    JOIN \`${projectId}.ref.clients\` cl ON cl.client_id = a.client_id
    LEFT JOIN \`${projectId}.ref.fx_rates\` mfx
      ON  mfx.month_start   = DATE_TRUNC(a.date, MONTH)
      AND mfx.from_currency = cl.meta_currency
      AND mfx.to_currency   = cl.currency
    WHERE ${where}
    GROUP BY ${keys}`;
}
