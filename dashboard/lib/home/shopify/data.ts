import "server-only";

/**
 * Sidekick home: every read the page makes, in one call.
 *
 * ── Sources ────────────────────────────────────────────────────────────────
 * Client health      `getHomeData()` (lib/home/queries.ts), unchanged: Goals
 *                    pacing, daily actuals, ClickUp Clients.
 * KPI strip          mart.plan_actuals_daily, last 75 days, each row with its
 *                    month's CZK rate from ref.fx_rates; new ads from the
 *                    Velocity launch read (mart.rpt_ad_launch).
 * Velocity           `loadVelocityOverview()`: capacity, queue, brief quota,
 *                    window, production, per client with Meta.
 * Unmapped ads       mart.mart_creative_unmapped (ads after the client's ClickUp
 *                    pipeline began), minus mappings confirmed in the last hour
 *                    (Postgres), exactly as the Creative queue counts them.
 * Ordering rates     latest CZK rate per currency in ref.fx_rates.
 *
 * Each read is guarded on its own: one failing source turns its figures into
 * n/a with the source named, and the rest of Home still renders.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { getClients, type Client } from "@/lib/clients";
import { isDemo } from "@/lib/demo/client";
import { withFallback } from "@/lib/queries/plan";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { getHomeData } from "@/lib/home/queries";
import { listConfirmedMappings } from "@/lib/creative/store";
import { loadVelocityOverview, velocityFacts } from "@/lib/creative/velocityData";
import { eligible } from "@/lib/creative/hitRate";
import { buildKpis, type DailyRow, type LaunchDates } from "./kpis";
import { actionChips, greetingLine, recommendations, type UnmappedFact, type VelocityFact } from "./rules";
import type { SidekickHome } from "./types";

type Raw = Record<string, unknown>;

/** Logged, then turned into a note for the figures that needed the source. */
async function guarded<T>(label: string, run: () => Promise<T>): Promise<{ value: T | null; note: string | null }> {
  try {
    return { value: await run(), note: null };
  } catch (error) {
    const message = String((error as { message?: string } | null)?.message ?? error);
    console.error(`[home/shopify] ${label} unreadable: ${message}`);
    const denied = /permission|access denied/i.test(message);
    return { value: null, note: denied ? `No read access to ${label}.` : `${label} could not be read.` };
  }
}

async function fetchDaily(): Promise<DailyRow[]> {
  const sql = (full: boolean) => `
    WITH a AS (
      SELECT client_id, currency, date, revenue, meta_spend
        ${full ? ", cm3, new_customer_revenue, paid_spend" : ", NULL AS cm3, NULL AS new_customer_revenue, NULL AS paid_spend"}
      FROM ${PLAN_TABLES.actualsDaily}
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 75 DAY)
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
      date: String(isoDate(r.date as never)),
      revenue: num(r.revenue),
      cm3: num(r.cm3),
      ncr: num(r.new_customer_revenue),
      paid: num(r.paid_spend),
      meta: num(r.meta_spend),
      czk: num(r.czk_rate),
    }));
}

/** CZK per unit, latest month per currency. */
async function fetchCzkRates(): Promise<Map<string, number>> {
  const rows = await query<Raw>(
    `SELECT from_currency, rate
     FROM \`${PROJECT_ID}.ref.fx_rates\`
     WHERE to_currency = 'CZK' AND rate > 0
     QUALIFY ROW_NUMBER() OVER (PARTITION BY from_currency ORDER BY month_start DESC) = 1`
  );
  const out = new Map<string, number>([["CZK", 1]]);
  for (const r of rows) {
    const v = num(r.rate);
    if (v) out.set(String(r.from_currency), v);
  }
  return out;
}

async function fetchUnmapped(clients: Client[]): Promise<UnmappedFact[]> {
  const rows = await query<Raw>(
    `SELECT client_id, ad_id, spend
     FROM \`${PROJECT_ID}.mart.mart_creative_unmapped\`
     WHERE NOT before_pipeline`
  );
  const byClient = new Map<string, Array<{ adId: string; spend: number }>>();
  for (const r of rows) {
    const id = String(r.client_id);
    if (!byClient.has(id)) byClient.set(id, []);
    byClient.get(id)!.push({ adId: String(r.ad_id), spend: num(r.spend) ?? 0 });
  }
  const out: UnmappedFact[] = [];
  for (const c of clients) {
    const ads = byClient.get(c.clientId);
    if (!ads?.length || isDemo(c.clientId)) continue;
    // The Creative queue hides ads confirmed in the last hour, before the
    // ClickUp sync lands them in ref.creative_tags. Without Postgres the
    // warehouse count stands.
    const confirmed = await listConfirmedMappings(c.clientId)
      .then((m) => new Set(m.map((x) => x.adId)))
      .catch(() => new Set<string>());
    const open = ads.filter((a) => !confirmed.has(a.adId));
    out.push({
      clientId: c.clientId,
      name: c.name,
      ads: open.length,
      spend: open.reduce((s, a) => s + a.spend, 0),
      currency: c.metaCurrency ?? c.currency,
    });
  }
  return out;
}

async function fetchVelocity(): Promise<{ facts: VelocityFact[]; launches: LaunchDates[] }> {
  const overview = await loadVelocityOverview();
  const facts: VelocityFact[] = [];
  const launches: LaunchDates[] = [];
  for (const d of overview) {
    const f = velocityFacts(d);
    facts.push({
      clientId: d.client.clientId,
      name: d.client.name,
      currency: d.currency,
      brief: f.brief,
      capacity: f.plan.capacity,
      actualCapacity: f.actual.capacity,
      queued: f.queued,
      newAds30d: f.newAds30d,
      production: f.production,
      windowDays: f.plan.windowDays,
      longWindow: f.plan.longWindow,
    });
    if (d.launches.state === "ready") {
      launches.push({
        clientId: d.client.clientId,
        through: d.launches.through,
        dates: eligible(d.launches.rows).map((r) => r.firstDate),
      });
    }
  }
  return { facts, launches };
}

export async function getSidekickHome(): Promise<SidekickHome> {
  const registry = await getClients().catch(() => [] as Client[]);
  const [home, daily, rates, unmapped, velocity] = await Promise.all([
    getHomeData(),
    guarded("mart.plan_actuals_daily", fetchDaily),
    guarded("ref.fx_rates", fetchCzkRates),
    guarded("mart.mart_creative_unmapped", () => fetchUnmapped(registry)),
    guarded("the Velocity reads", fetchVelocity),
  ]);

  const names = new Map(registry.map((c) => [c.clientId, c.name]));
  const { kpis, through } = buildKpis(daily.value, velocity.value?.launches ?? null, names, {
    actuals: daily.note,
    launches: velocity.note,
  });

  const input = {
    clients: home.clients,
    velocity: velocity.value?.facts ?? null,
    velocityNote: velocity.note,
    unmapped: unmapped.value,
    unmappedNote: unmapped.note,
    czkRates: rates.value ?? new Map([["CZK", 1]]),
  };

  return {
    greetingLine: greetingLine(home.clients, home.summary.onPlan, home.summary.withPlan),
    kpis,
    kpiThrough: through,
    chips: actionChips(input),
    recommendations: recommendations(input),
    clients: home.clients,
    summary: home.summary,
  };
}
