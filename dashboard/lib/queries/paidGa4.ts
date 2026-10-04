/**
 * Paid > GA4 tab: every query behind it.
 *
 * Source: `mart.mart_ga4_sessions_daily` (money already in the client currency)
 * and, for spend, platform value and shop revenue, `mart.mart_daily_kpis`.
 *
 * ── Three rules this module enforces ────────────────────────────────────────
 * 1. Every rate is built from summed components in the caller (`lib/paid/math`),
 *    so this module returns sums and counts only.
 * 2. "Paid" is `platform IN ('meta', 'google', 'other_paid')`. The fifth platform
 *    value, `unattributed`, holds purchases GA4 recorded without a session
 *    (consent mode). It counts in all-channel revenue and nowhere in paid, and it
 *    carries no sessions, so it can never inflate a conversion rate.
 * 3. A sum with nothing to add up is null, not zero. `SUM()` over no rows is null
 *    in BigQuery and stays null all the way to the "n/a" glyph. Conditional sums
 *    use `IF(cond, x, NULL)` for the same reason.
 *
 * ── The view may not exist yet ──────────────────────────────────────────────
 * `getGa4LastDate` is the page's first call. If the view is not deployed it
 * reports `available: false` and the page renders "GA4 not connected". Only the
 * not-found error is swallowed (`optional`); permission errors, timeouts and
 * everything else are rethrown.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, isoDate } from "@/lib/coerce";
import { optional } from "@/lib/queries/errors";
import { fxParams, fxSql } from "@/lib/currency";
import { scanBounds, type DateRange, type ResolvedPeriod } from "@/lib/period";
import type { Ga4Platform } from "@/lib/paid/types";
import { isDemo } from "@/lib/demo/client";
import {
  demoGa4Channels,
  demoGa4CrossCheck,
  demoGa4Funnel,
  demoGa4Kpis,
  demoGa4LandingPages,
  demoGa4LastDate,
} from "@/lib/demo/paidGa4";

const VIEW = `\`${PROJECT_ID}.mart.mart_ga4_sessions_daily\``;
const KPIS = `\`${PROJECT_ID}.mart.mart_daily_kpis\``;

/** The platforms whose sessions count as paid. `unattributed` and `non_paid` never do. */
export const GA4_PAID_PLATFORMS: readonly Ga4Platform[] = ["meta", "google", "other_paid"];
const PAID_SQL = `platform IN ('meta', 'google', 'other_paid')`;

/**
 * The channel a paid session is shown under. GA4 files some Meta traffic under
 * Organic Social, Unassigned or Mobile Push (swapped UTM fields); the mart
 * already classes those sessions as Meta, so they are shown as Paid Social and
 * the channel table ties to the paid totals.
 */
const CHANNEL_SQL = `IF(platform = 'meta', 'Paid Social', channel_group)`;

/**
 * Revenue of a group. The mart leaves `revenue` null on a session that did not
 * buy, so a group with no purchases would sum to null and read "n/a". It is a
 * true zero. A group WITH purchases and a null sum is the opposite case: every
 * purchase lacked an FX rate, so the revenue really is unknown and stays null.
 */
const REV_SQL = `IF(IFNULL(SUM(purchases), 0) = 0, 0, SUM(revenue))`;
/** The same, restricted to the rows that satisfy a condition. */
const revWhere = (cond: string) =>
  `IF(IFNULL(SUM(IF(${cond}, purchases, 0)), 0) = 0, 0, SUM(IF(${cond}, revenue, NULL)))`;

// ── Funnel channel choices ──────────────────────────────────────────────────

export const GA4_FUNNEL_CHANNELS = [
  "all",
  "Paid Social",
  "Paid Search",
  "Paid Shopping",
  "Cross-network",
] as const;
export type Ga4FunnelChannel = (typeof GA4_FUNNEL_CHANNELS)[number];

export const GA4_LANDING_FILTERS = ["all", "meta", "google"] as const;
export type Ga4LandingFilter = (typeof GA4_LANDING_FILTERS)[number];

/** Whitelist a search param; anything unknown falls back to the first (default) choice. */
export function parseChoice<T extends string>(
  value: string | string[] | undefined,
  choices: readonly T[]
): T {
  const v = Array.isArray(value) ? value[0] : value;
  return choices.find((c) => c === v) ?? choices[0];
}

// ── Output shapes ───────────────────────────────────────────────────────────

/** One period's headline sums. Paid fields cover meta, google and other_paid only. */
export interface Ga4Totals {
  /** Rows the view holds for the period. Zero means GA4 has nothing for it. */
  rows: number;
  sessions: number | null;
  sessionsPurchase: number | null;
  purchases: number | null;
  revenue: number | null;
  /** Revenue across every platform, `unattributed` included. */
  allRevenue: number | null;
  unattributedRevenue: number | null;
  /** Purchase sessions whose revenue is null for lack of an FX rate. Above 0 means revenue is partial. */
  fxMissing: number | null;
}

export interface Ga4Kpis {
  current: Ga4Totals;
  /** Null when compare is off or GA4 holds no rows for the comparison period. */
  previous: Ga4Totals | null;
}

export interface Ga4PlatformSlice {
  sessions: number | null;
  purchases: number | null;
  revenue: number | null;
}

export type ShopBasis = "gross" | "net";

export interface Ga4CrossCheck {
  ga4: Record<Ga4Platform, Ga4PlatformSlice>;
  /** Platform spend in the client currency. Null when the platform reports none. */
  spend: { meta: number | null; google: number | null; paid: number | null };
  /** Platform-attributed conversion value. */
  platformValue: { meta: number | null; google: number | null };
  /** Shop revenue on the stated basis: `gross` is incl. tax and shipping, `net` is `revenue`. */
  shopRevenue: number | null;
  fxMissing: number | null;
}

export interface Ga4ChannelRow {
  channel: string;
  sessions: number | null;
  engagedSessions: number | null;
  sessionsAtc: number | null;
  sessionsPurchase: number | null;
  purchases: number | null;
  revenue: number | null;
}

export interface Ga4FunnelCounts {
  sessions: number | null;
  viewItem: number | null;
  addToCart: number | null;
  checkout: number | null;
  purchase: number | null;
}

export interface Ga4LandingRow {
  path: string;
  sessions: number | null;
  metaSessions: number | null;
  googleSessions: number | null;
  engagedSessions: number | null;
  sessionsAtc: number | null;
  sessionsPurchase: number | null;
  revenue: number | null;
}

export interface Ga4LastDate {
  /** False when the mart view does not exist yet. */
  available: boolean;
  lastDate: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PLATFORMS: Ga4Platform[] = ["meta", "google", "other_paid", "non_paid", "unattributed"];

const emptySlice = (): Ga4PlatformSlice => ({ sessions: null, purchases: null, revenue: null });

function totalsFrom(row: Record<string, unknown> | undefined, prefix: string): Ga4Totals {
  const g = (k: string) => num(row?.[`${prefix}${k}`]);
  return {
    rows: g("rows") ?? 0,
    sessions: g("sessions"),
    sessionsPurchase: g("sessions_purchase"),
    purchases: g("purchases"),
    revenue: g("revenue"),
    allRevenue: g("all_revenue"),
    unattributedRevenue: g("unattributed_revenue"),
    fxMissing: g("fx_missing"),
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Last day GA4 has data for this client. Powers the stale state and, through
 * `available`, the "not connected" fallback when the view is not deployed.
 */
export async function getGa4LastDate(clientId: string): Promise<Ga4LastDate> {
  if (isDemo(clientId)) return demoGa4LastDate();

  const rows = await optional<Array<Record<string, unknown>> | null>(
    () =>
      query<Record<string, unknown>>(
        `SELECT MAX(date) AS last_date
         FROM ${VIEW}
         WHERE client_id = @clientId`,
        { clientId }
      ),
    null
  );
  if (rows === null) return { available: false, lastDate: null };
  return { available: true, lastDate: isoDate(rows[0]?.last_date as never) };
}

/**
 * The five tiles: paid sessions, purchases, revenue, CVR inputs and the paid
 * share of GA4 revenue. Current and comparison periods in one scan.
 */
export async function getGa4Kpis(clientId: string, period: ResolvedPeriod): Promise<Ga4Kpis> {
  if (isDemo(clientId)) return demoGa4Kpis(period);

  const bounds = scanBounds(period);
  const cmp = period.comparison;
  // Without a comparison period the second window is empty (from > to never matches).
  const [pFrom, pTo] = cmp ? [cmp.from, cmp.to] : ["9999-01-01", "9999-01-01"];

  const agg = (flag: string, prefix: string) => `
    COUNTIF(${flag})                                                    AS ${prefix}rows,
    SUM(IF(${flag} AND ${PAID_SQL}, sessions, 0))                       AS ${prefix}sessions,
    SUM(IF(${flag} AND ${PAID_SQL}, sessions_purchase, 0))              AS ${prefix}sessions_purchase,
    SUM(IF(${flag} AND ${PAID_SQL}, purchases, 0))                      AS ${prefix}purchases,
    ${revWhere(`${flag} AND ${PAID_SQL}`)}                              AS ${prefix}revenue,
    ${revWhere(flag)}                                                   AS ${prefix}all_revenue,
    ${revWhere(`${flag} AND platform = 'unattributed'`)}                AS ${prefix}unattributed_revenue,
    SUM(IF(${flag}, sessions_fx_missing, 0))                            AS ${prefix}fx_missing`;

  const [row] = await query<Record<string, unknown>>(
    `SELECT ${agg("date BETWEEN @cFrom AND @cTo", "c_")},
            ${agg("date BETWEEN @pFrom AND @pTo", "p_")}
     FROM ${VIEW}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to`,
    {
      clientId,
      from: bounds.from,
      to: bounds.to,
      cFrom: period.current.from,
      cTo: period.current.to,
      pFrom,
      pTo,
    }
  );

  const current = totalsFrom(row, "c_");
  const previous = cmp ? totalsFrom(row, "p_") : null;
  return { current, previous: previous && previous.rows > 0 ? previous : null };
}

/**
 * GA4 side of the cross-check (revenue by platform) and the warehouse side
 * (spend, platform value, shop revenue). `basis` picks the shop column: Shopify
 * clients compare against revenue incl. tax and shipping, because that is what
 * GA4's purchase value contains; other shops compare against `revenue`.
 *
 * `mart_daily_kpis` is grained by currency (a shop can carry a few orders in a
 * second currency), so its money is converted to the client currency the same
 * way the mart view converts GA4 revenue: one rate per row's month, applied
 * before the sum, a missing rate giving null rather than a wrong number.
 */
export async function getGa4CrossCheck(
  clientId: string,
  range: DateRange,
  basis: ShopBasis,
  currency: string
): Promise<Ga4CrossCheck> {
  if (isDemo(clientId)) return demoGa4CrossCheck(range, basis);

  const fx = fxSql(currency, "k");
  const m = fx.wrap;

  const params = { clientId, from: range.from, to: range.to };

  const [ga4Rows, [kpi]] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT platform,
              SUM(sessions)            AS sessions,
              SUM(purchases)           AS purchases,
              ${REV_SQL}               AS revenue,
              SUM(sessions_fx_missing) AS fx_missing
       FROM ${VIEW}
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       GROUP BY platform`,
      params
    ),
    query<Record<string, unknown>>(
      `SELECT SUM(${m("k.meta_spend")})     AS meta_spend,
              SUM(${m("k.google_spend")})   AS google_spend,
              SUM(${m("k.paid_spend")})     AS paid_spend,
              SUM(${m("k.meta_revenue")})   AS meta_revenue,
              SUM(${m("k.google_revenue")}) AS google_revenue,
              SUM(${m(basis === "gross" ? "k.gross_revenue_incl_tax" : "k.revenue")}) AS shop_revenue
       FROM ${KPIS} k
       ${fx.join}
       WHERE k.client_id = @clientId AND k.date BETWEEN @from AND @to`,
      { ...params, ...fxParams(currency) }
    ),
  ]);

  const ga4 = Object.fromEntries(PLATFORMS.map((p) => [p, emptySlice()])) as Record<
    Ga4Platform,
    Ga4PlatformSlice
  >;
  let fxMissing: number | null = null;
  for (const r of ga4Rows) {
    const p = String(r.platform) as Ga4Platform;
    if (!(p in ga4)) continue;
    ga4[p] = { sessions: num(r.sessions), purchases: num(r.purchases), revenue: num(r.revenue) };
    const f = num(r.fx_missing);
    if (f !== null) fxMissing = (fxMissing ?? 0) + f;
  }

  return {
    ga4,
    spend: { meta: num(kpi?.meta_spend), google: num(kpi?.google_spend), paid: num(kpi?.paid_spend) },
    platformValue: { meta: num(kpi?.meta_revenue), google: num(kpi?.google_revenue) },
    shopRevenue: num(kpi?.shop_revenue),
    fxMissing,
  };
}

/** Paid sessions by channel, biggest first. */
export async function getGa4Channels(clientId: string, range: DateRange): Promise<Ga4ChannelRow[]> {
  if (isDemo(clientId)) return demoGa4Channels(range);

  const rows = await query<Record<string, unknown>>(
    `SELECT ${CHANNEL_SQL} AS channel,
            SUM(sessions)           AS sessions,
            SUM(engaged_sessions)   AS engaged_sessions,
            SUM(sessions_atc)       AS sessions_atc,
            SUM(sessions_purchase)  AS sessions_purchase,
            SUM(purchases)          AS purchases,
            ${REV_SQL}              AS revenue
     FROM ${VIEW}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to AND ${PAID_SQL}
     GROUP BY channel
     ORDER BY sessions DESC`,
    { clientId, from: range.from, to: range.to }
  );

  return rows.map((r) => ({
    channel: String(r.channel ?? "Unassigned"),
    sessions: num(r.sessions),
    engagedSessions: num(r.engaged_sessions),
    sessionsAtc: num(r.sessions_atc),
    sessionsPurchase: num(r.sessions_purchase),
    purchases: num(r.purchases),
    revenue: num(r.revenue),
  }));
}

/** The five funnel counts for paid sessions, all channels or one. */
export async function getGa4Funnel(
  clientId: string,
  range: DateRange,
  channel: Ga4FunnelChannel
): Promise<Ga4FunnelCounts> {
  if (isDemo(clientId)) return demoGa4Funnel(range, channel);

  const [row] = await query<Record<string, unknown>>(
    `SELECT SUM(sessions)           AS sessions,
            SUM(sessions_view_item) AS view_item,
            SUM(sessions_atc)       AS atc,
            SUM(sessions_checkout)  AS checkout,
            SUM(sessions_purchase)  AS purchase
     FROM ${VIEW}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to AND ${PAID_SQL}
       AND (@channel = 'all' OR ${CHANNEL_SQL} = @channel)`,
    { clientId, from: range.from, to: range.to, channel }
  );

  return {
    sessions: num(row?.sessions),
    viewItem: num(row?.view_item),
    addToCart: num(row?.atc),
    checkout: num(row?.checkout),
    purchase: num(row?.purchase),
  };
}

/**
 * Post-purchase and cart pages (`/orders/<token>`, `/checkouts/cn/<token>`,
 * `/cart`, optionally under a locale prefix) are not landing pages: a paid
 * session that "lands" there is the order-status link opened from an email.
 */
const NON_LANDING_PATH = String.raw`^(/[a-z]{2}(-[a-z]{2})?)?/(orders|checkouts|cart)(/|\?|$)`;

/** Top 50 landing paths of paid sessions by sessions, optionally one platform. */
export async function getGa4LandingPages(
  clientId: string,
  range: DateRange,
  platform: Ga4LandingFilter
): Promise<Ga4LandingRow[]> {
  if (isDemo(clientId)) return demoGa4LandingPages(range, platform);

  const rows = await query<Record<string, unknown>>(
    `SELECT IFNULL(landing_path, '(not set)')           AS path,
            SUM(sessions)                               AS sessions,
            SUM(IF(platform = 'meta', sessions, 0))     AS meta_sessions,
            SUM(IF(platform = 'google', sessions, 0))   AS google_sessions,
            SUM(engaged_sessions)                       AS engaged_sessions,
            SUM(sessions_atc)                           AS sessions_atc,
            SUM(sessions_purchase)                      AS sessions_purchase,
            ${REV_SQL}                                  AS revenue
     FROM ${VIEW}
     WHERE client_id = @clientId AND date BETWEEN @from AND @to AND ${PAID_SQL}
       AND (@platform = 'all' OR platform = @platform)
       AND NOT REGEXP_CONTAINS(IFNULL(landing_path, ''), r'${NON_LANDING_PATH}')
     GROUP BY path
     HAVING sessions > 0
     ORDER BY sessions DESC
     LIMIT 50`,
    { clientId, from: range.from, to: range.to, platform }
  );

  return rows.map((r) => ({
    path: String(r.path ?? "(not set)"),
    sessions: num(r.sessions),
    metaSessions: num(r.meta_sessions),
    googleSessions: num(r.google_sessions),
    engagedSessions: num(r.engaged_sessions),
    sessionsAtc: num(r.sessions_atc),
    sessionsPurchase: num(r.sessions_purchase),
    revenue: num(r.revenue),
  }));
}
