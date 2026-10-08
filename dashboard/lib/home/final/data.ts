import "server-only";

/**
 * Home: every read the page makes, split so each section can stream on its own.
 *
 * ── Sources ────────────────────────────────────────────────────────────────
 * Client health      `getHomeData()` (lib/home/queries.ts): Goals pacing,
 *                    daily actuals, ClickUp Clients and Invoice Tracker.
 * Daily actuals      mart.plan_actuals_daily, the last 75 days and the same
 *                    dates a year earlier, each row with its month's CZK rate
 *                    from ref.fx_rates. Feeds the money tiles, Incremental CM3
 *                    and the last-year ring of clients without a plan.
 * New ads            the Velocity launch read (mart.rpt_ad_launch), as the
 *                    Shopify variant.
 * New concepts       mart.mart_creative_perf: first day with spend per
 *                    client and concept.
 * Chips and cards    Velocity, mart.mart_creative_unmapped (minus mappings
 *                    confirmed in Postgres) and the latest CZK rates, through
 *                    the Shopify variant's rules (lib/home/shopify/rules.ts).
 *
 * Every loader is memoised per request (`perRequest`), so two sections that
 * need the same source share one read, and every source is guarded on its
 * own: a failing read turns its own figures n/a with the source named and the
 * rest of the page still renders.
 */

import * as React from "react";
import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { getClients, type Client } from "@/lib/clients";
import { isDemo } from "@/lib/demo/client";
import { withFallback } from "@/lib/queries/plan";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { getHomeData } from "@/lib/home/queries";
import { buildKpis, type DailyRow } from "@/lib/home/shopify/kpis";
import { fetchCzkRates, fetchUnmapped, fetchVelocity, guarded } from "@/lib/home/shopify/data";
import { actionChips, greetingLine, recommendations, type RuleInput } from "@/lib/home/shopify/rules";
import type { ActionChip, Kpi, Recommendation } from "@/lib/home/shopify/types";
import type { ClientSeries } from "@/lib/home/health/types";
import { buildClientTiles, type ClientTile } from "./clients";
import { incrementalCm3Kpi, newConceptsKpi, type ConceptLaunches } from "./kpis";

type Raw = Record<string, unknown>;

const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn);

const day = (v: unknown): string => isoDate(v as Parameters<typeof isoDate>[0]) ?? "";

/* ------------------------------------------------------------------------ */
/* Reads                                                                    */
/* ------------------------------------------------------------------------ */

async function fetchDailyWithLastYear(): Promise<DailyRow[]> {
  const sql = (full: boolean) => `
    WITH a AS (
      SELECT client_id, currency, date, revenue, meta_spend
        ${full ? ", cm3, new_customer_revenue, paid_spend" : ", NULL AS cm3, NULL AS new_customer_revenue, NULL AS paid_spend"}
      FROM ${PLAN_TABLES.actualsDaily}
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 75 DAY)
         OR date BETWEEN DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 75 DAY), INTERVAL 1 YEAR)
                     AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
    )
    SELECT a.*, IF(a.currency = 'CZK', 1, fx.rate) AS czk_rate
    FROM a
    LEFT JOIN \`${PROJECT_ID}.ref.fx_rates\` fx
      ON fx.month_start = DATE_TRUNC(a.date, MONTH)
     AND fx.from_currency = a.currency
     AND fx.to_currency = 'CZK'`;
  const rows = await withFallback(
    () => query<Raw>(sql(true)),
    () => query<Raw>(sql(false))
  );
  return rows
    .filter((r) => !isDemo(String(r.client_id)))
    .map((r) => ({
      clientId: String(r.client_id),
      date: day(r.date),
      revenue: num(r.revenue),
      cm3: num(r.cm3),
      ncr: num(r.new_customer_revenue),
      paid: num(r.paid_spend),
      meta: num(r.meta_spend),
      czk: num(r.czk_rate),
    }));
}

/** First spend day of every concept per client, and each client's last day in the view. */
async function fetchConceptLaunches(): Promise<ConceptLaunches[]> {
  const rows = await query<Raw>(
    `WITH p AS (
       SELECT client_id, concept_id, date, spend
       FROM \`${PROJECT_ID}.mart.mart_creative_perf\`
     ),
     last AS (SELECT client_id, MAX(date) AS through FROM p GROUP BY client_id),
     firsts AS (
       SELECT client_id, concept_id, MIN(date) AS first_day
       FROM p
       WHERE concept_id IS NOT NULL AND spend > 0
       GROUP BY client_id, concept_id
     )
     SELECT last.client_id, last.through, firsts.first_day
     FROM last LEFT JOIN firsts USING (client_id)`
  );
  const out = new Map<string, ConceptLaunches>();
  for (const r of rows) {
    const id = String(r.client_id);
    if (isDemo(id)) continue;
    if (!out.has(id)) out.set(id, { clientId: id, through: day(r.through), firstDays: [] });
    const first = r.first_day === null || r.first_day === undefined ? null : day(r.first_day);
    if (first) out.get(id)!.firstDays.push(first);
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------------ */
/* Memoised per request                                                     */
/* ------------------------------------------------------------------------ */

const home = perRequest(() => getHomeData());
const registry = perRequest(() => getClients().catch(() => [] as Client[]));
const daily = perRequest(() => guarded("mart.plan_actuals_daily", fetchDailyWithLastYear));
const rates = perRequest(() => guarded("ref.fx_rates", fetchCzkRates));
const velocity = perRequest(() => guarded("the Velocity reads", fetchVelocity));
const unmapped = perRequest(async () => {
  const clients = await registry();
  return guarded("mart.mart_creative_unmapped", () => fetchUnmapped(clients));
});
const concepts = perRequest(() => guarded("mart.mart_creative_perf", fetchConceptLaunches));

async function names(): Promise<Map<string, string>> {
  return new Map((await registry()).map((c) => [c.clientId, c.name]));
}

/* ------------------------------------------------------------------------ */
/* What each section awaits                                                 */
/* ------------------------------------------------------------------------ */

/** Client revenue, Meta spend, CM3 and Incremental CM3: one warehouse read. */
export async function loadMoneyKpis(): Promise<{ revenue: Kpi; meta: Kpi; cm3: Kpi; incremental: Kpi; through: string | null }> {
  const [rows, n] = await Promise.all([daily(), names()]);
  const { kpis, through } = buildKpis(rows.value, [], n, { actuals: rows.note, launches: null });
  const pick = (key: Kpi["key"]) => kpis.find((k) => k.key === key)!;
  return {
    revenue: pick("revenue"),
    meta: pick("meta_spend"),
    cm3: pick("cm3"),
    incremental: incrementalCm3Kpi(rows.value, n, rows.note),
    through,
  };
}

export async function loadNewAdsKpi(): Promise<Kpi> {
  const [v, n] = await Promise.all([velocity(), names()]);
  const { kpis } = buildKpis(null, v.value?.launches ?? null, n, { actuals: null, launches: v.note });
  return kpis.find((k) => k.key === "new_ads")!;
}

export async function loadNewConceptsKpi(): Promise<Kpi> {
  const [c, n] = await Promise.all([concepts(), names()]);
  return newConceptsKpi(c.value, n, c.note);
}

export async function loadGreetingLine(): Promise<string> {
  const h = await home();
  return greetingLine(h.clients, h.summary.onPlan, h.summary.withPlan);
}

async function ruleInput(): Promise<RuleInput> {
  const [h, v, u, r] = await Promise.all([home(), velocity(), unmapped(), rates()]);
  return {
    clients: h.clients,
    velocity: v.value?.facts ?? null,
    velocityNote: v.note,
    unmapped: u.value,
    unmappedNote: u.note,
    czkRates: r.value ?? new Map([["CZK", 1]]),
  };
}

export async function loadChips(): Promise<ActionChip[]> {
  return actionChips(await ruleInput());
}

export async function loadRecommendations(): Promise<Recommendation[]> {
  return recommendations(await ruleInput());
}

/** The daily rows as Health series: each client's days to its own last day. */
function toSeries(rows: DailyRow[]): ClientSeries[] {
  const out = new Map<string, ClientSeries>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    let s = out.get(r.clientId);
    if (!s) {
      s = { clientId: r.clientId, asOf: r.date, days: [] };
      out.set(r.clientId, s);
    }
    s.asOf = r.date;
    s.days.push({
      date: r.date,
      revenue: r.revenue,
      cm3: r.cm3,
      ncr: r.ncr,
      paid: r.paid,
      revenueTargetCum: null,
      cm3TargetCum: null,
    });
  }
  return [...out.values()];
}

export async function loadClientTiles(): Promise<ClientTile[]> {
  const [h, rows] = await Promise.all([home(), daily()]);
  return buildClientTiles(h.clients, toSeries(rows.value ?? []));
}

/** Shared with lib/home/final/alerts.ts (For you), same per-request memo. */
export { ruleInput, velocity as velocityForRequest, rates as ratesForRequest };
