/**
 * Demo GA4 tab.
 *
 * Built on the same daily spine as the rest of the demo (`business.ts`), so spend
 * and shop revenue here are the numbers the other pages show. GA4 sees a share of
 * the shop's revenue (tracking is never complete), and the platforms claim more
 * than GA4 credits them, because that is the point the cross-check exists to make.
 *
 * Nothing is random at runtime: every figure is a pure function of its date.
 * The demo client has GA4 switched off in its capabilities, so the page never
 * reaches these functions today; they exist so the query module has the demo
 * branch every query module carries.
 */

import type { DateRange, ResolvedPeriod } from "@/lib/period";
import type { Ga4Platform } from "@/lib/paid/types";
import type {
  Ga4ChannelRow,
  Ga4CrossCheck,
  Ga4FunnelChannel,
  Ga4FunnelCounts,
  Ga4Kpis,
  Ga4LandingFilter,
  Ga4LandingRow,
  Ga4LastDate,
  Ga4PlatformSlice,
  Ga4Totals,
  ShopBasis,
} from "@/lib/queries/paidGa4";
import { dataThrough, days, type DemoDay } from "./business";
import { jitter } from "./random";

interface Row {
  date: string;
  platform: Ga4Platform;
  channel: string;
  path: string;
  sessions: number;
  engaged: number;
  viewItem: number;
  atc: number;
  checkout: number;
  sessionsPurchase: number;
  purchases: number;
  revenue: number;
}

const PATHS: Array<{ path: string; weight: number }> = [
  { path: "/", weight: 0.3 },
  { path: "/collections/all", weight: 0.22 },
  { path: "/products/starter-set", weight: 0.2 },
  { path: "/products/daily-serum", weight: 0.18 },
  { path: "/pages/about", weight: 0.1 },
];

const CHANNEL_SPLIT: Record<string, Array<{ channel: string; share: number }>> = {
  meta: [{ channel: "Paid Social", share: 1 }],
  google: [
    { channel: "Paid Search", share: 0.55 },
    { channel: "Paid Shopping", share: 0.3 },
    { channel: "Cross-network", share: 0.15 },
  ],
  non_paid: [
    { channel: "Direct", share: 0.4 },
    { channel: "Organic Search", share: 0.4 },
    { channel: "Email", share: 0.2 },
  ],
};

/** Per platform: cost per session, engaged rate, step rates off sessions, AOV. */
const SHAPE = {
  meta: { costPerSession: 0.95, engaged: 0.58, view: 0.46, atc: 0.07, checkout: 0.04, buy: 0.011, aov: 64 },
  google: { costPerSession: 0.72, engaged: 0.69, view: 0.52, atc: 0.1, checkout: 0.062, buy: 0.022, aov: 71 },
  non_paid: { costPerSession: 0, engaged: 0.66, view: 0.5, atc: 0.09, checkout: 0.055, buy: 0.019, aov: 78 },
} as const;

function rowsFor(range: DateRange): Row[] {
  const out: Row[] = [];
  for (const d of days(range.from, range.to)) {
    for (const platform of ["meta", "google", "non_paid"] as const) {
      const s = SHAPE[platform];
      const spend = platform === "meta" ? d.metaSpend : platform === "google" ? d.googleSpend : 0;
      const baseSessions =
        platform === "non_paid"
          ? d.orders * 36 * jitter(`ga4:np:${d.date}`, 0.08)
          : (spend / s.costPerSession) * jitter(`ga4:${platform}:${d.date}`, 0.08);

      for (const ch of CHANNEL_SPLIT[platform]) {
        for (const p of PATHS) {
          const sessions = Math.round(baseSessions * ch.share * p.weight);
          if (sessions <= 0) continue;
          const sessionsPurchase = Math.round(sessions * s.buy * jitter(`ga4:b:${platform}:${ch.channel}:${p.path}:${d.date}`, 0.15));
          const purchases = sessionsPurchase;
          out.push({
            date: d.date,
            platform,
            channel: ch.channel,
            path: p.path,
            sessions,
            engaged: Math.round(sessions * s.engaged),
            viewItem: Math.round(sessions * s.view),
            atc: Math.max(sessionsPurchase, Math.round(sessions * s.atc)),
            checkout: Math.max(sessionsPurchase, Math.round(sessions * s.checkout)),
            sessionsPurchase,
            purchases,
            revenue: Math.round(purchases * s.aov * jitter(`ga4:aov:${platform}:${d.date}`, 0.05) * 100) / 100,
          });
        }
      }
    }
  }
  return out;
}

const sum = <T,>(rows: T[], f: (r: T) => number): number | null =>
  rows.length === 0 ? null : rows.reduce((a, r) => a + f(r), 0);

const PAID = new Set<Ga4Platform>(["meta", "google", "other_paid"]);

function totals(range: DateRange): Ga4Totals {
  const rows = rowsFor(range);
  const paid = rows.filter((r) => PAID.has(r.platform));
  return {
    rows: rows.length,
    sessions: sum(paid, (r) => r.sessions),
    sessionsPurchase: sum(paid, (r) => r.sessionsPurchase),
    purchases: sum(paid, (r) => r.purchases),
    revenue: sum(paid, (r) => r.revenue),
    allRevenue: sum(rows, (r) => r.revenue),
    unattributedRevenue: null,
    fxMissing: null,
  };
}

export function demoGa4LastDate(): Ga4LastDate {
  return { available: true, lastDate: dataThrough() };
}

export function demoGa4Kpis(period: ResolvedPeriod): Ga4Kpis {
  const previous = period.comparison ? totals(period.comparison) : null;
  return {
    current: totals(period.current),
    previous: previous && previous.rows > 0 ? previous : null,
  };
}

export function demoGa4CrossCheck(range: DateRange, basis: ShopBasis): Ga4CrossCheck {
  const rows = rowsFor(range);
  const spendDays: DemoDay[] = days(range.from, range.to);

  const slice = (p: Ga4Platform): Ga4PlatformSlice => {
    const r = rows.filter((x) => x.platform === p);
    return {
      sessions: sum(r, (x) => x.sessions),
      purchases: sum(r, (x) => x.purchases),
      revenue: sum(r, (x) => x.revenue),
    };
  };

  const metaSpend = sum(spendDays, (d) => d.metaSpend);
  const googleSpend = sum(spendDays, (d) => d.googleSpend);
  const ga4Meta = slice("meta").revenue;
  const ga4Google = slice("google").revenue;

  return {
    ga4: {
      meta: slice("meta"),
      google: slice("google"),
      other_paid: { sessions: null, purchases: null, revenue: null },
      non_paid: slice("non_paid"),
      unattributed: { sessions: null, purchases: null, revenue: null },
    },
    spend: { meta: metaSpend, google: googleSpend, paid: sum(spendDays, (d) => d.paidSpend) },
    // Platforms claim more than GA4 credits them.
    platformValue: {
      meta: ga4Meta === null ? null : Math.round(ga4Meta * 1.34 * 100) / 100,
      google: ga4Google === null ? null : Math.round(ga4Google * 1.18 * 100) / 100,
    },
    shopRevenue: sum(spendDays, (d) => (basis === "gross" ? d.grossRevenueInclTax : d.revenue)),
    fxMissing: null,
  };
}

export function demoGa4Channels(range: DateRange): Ga4ChannelRow[] {
  const by = new Map<string, Ga4ChannelRow>();
  for (const r of rowsFor(range)) {
    if (!PAID.has(r.platform)) continue;
    const cur =
      by.get(r.channel) ??
      ({
        channel: r.channel,
        sessions: 0,
        engagedSessions: 0,
        sessionsAtc: 0,
        sessionsPurchase: 0,
        purchases: 0,
        revenue: 0,
      } satisfies Ga4ChannelRow);
    cur.sessions = (cur.sessions ?? 0) + r.sessions;
    cur.engagedSessions = (cur.engagedSessions ?? 0) + r.engaged;
    cur.sessionsAtc = (cur.sessionsAtc ?? 0) + r.atc;
    cur.sessionsPurchase = (cur.sessionsPurchase ?? 0) + r.sessionsPurchase;
    cur.purchases = (cur.purchases ?? 0) + r.purchases;
    cur.revenue = (cur.revenue ?? 0) + r.revenue;
    by.set(r.channel, cur);
  }
  return [...by.values()].sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0));
}

export function demoGa4Funnel(range: DateRange, channel: Ga4FunnelChannel): Ga4FunnelCounts {
  const rows = rowsFor(range).filter(
    (r) => PAID.has(r.platform) && (channel === "all" || r.channel === channel)
  );
  return {
    sessions: sum(rows, (r) => r.sessions),
    viewItem: sum(rows, (r) => r.viewItem),
    addToCart: sum(rows, (r) => r.atc),
    checkout: sum(rows, (r) => r.checkout),
    purchase: sum(rows, (r) => r.sessionsPurchase),
  };
}

export function demoGa4LandingPages(range: DateRange, platform: Ga4LandingFilter): Ga4LandingRow[] {
  const by = new Map<string, Ga4LandingRow>();
  for (const r of rowsFor(range)) {
    if (!PAID.has(r.platform)) continue;
    if (platform !== "all" && r.platform !== platform) continue;
    const cur =
      by.get(r.path) ??
      ({
        path: r.path,
        sessions: 0,
        metaSessions: 0,
        googleSessions: 0,
        engagedSessions: 0,
        sessionsAtc: 0,
        sessionsPurchase: 0,
        revenue: 0,
      } satisfies Ga4LandingRow);
    cur.sessions = (cur.sessions ?? 0) + r.sessions;
    if (r.platform === "meta") cur.metaSessions = (cur.metaSessions ?? 0) + r.sessions;
    if (r.platform === "google") cur.googleSessions = (cur.googleSessions ?? 0) + r.sessions;
    cur.engagedSessions = (cur.engagedSessions ?? 0) + r.engaged;
    cur.sessionsAtc = (cur.sessionsAtc ?? 0) + r.atc;
    cur.sessionsPurchase = (cur.sessionsPurchase ?? 0) + r.sessionsPurchase;
    cur.revenue = (cur.revenue ?? 0) + r.revenue;
    by.set(r.path, cur);
  }
  return [...by.values()].sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0)).slice(0, 50);
}
