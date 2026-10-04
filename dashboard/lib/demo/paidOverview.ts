/**
 * Demo data for Paid > Overview.
 *
 * Daily rows come from the same spine as the P&L, so the Overview's spend,
 * revenue and new customers are the very numbers the Snapshot shows. Platform
 * revenue is deliberately higher than the shop credits (platforms claim orders
 * they merely touched), which is the point the page exists to make.
 *
 * Campaign rows split each platform's range totals, so they add up to the
 * platform rows by construction.
 */

import type { ResolvedPeriod, DateRange } from "@/lib/period";
import type { CampaignAgg, PaidDay } from "@/components/paid/overview/model";
import { convertMoney, days } from "./business";
import { CAMPAIGNS } from "./catalog";
import { jitter } from "./random";

/** How much more revenue each platform claims than the shop credits it. */
const META_UPLIFT = 1.34;
const GOOGLE_UPLIFT = 1.18;
/** Orders a platform claims per new customer order, before its share. */
const META_PURCHASE_UPLIFT = 1.19;
const GOOGLE_PURCHASE_UPLIFT = 1.06;

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function demoPaidDays(bounds: DateRange, display: string): PaidDay[] {
  const money = (v: number) => convertMoney(v, display) as number;

  return days(bounds.from, bounds.to).map((d) => {
    const metaShare = d.paidSpend > 0 ? d.metaSpend / d.paidSpend : 0.71;
    return {
      date: d.date,
      revenue: money(d.revenue),
      newCustomerRevenue: money(d.newCustomerRevenue),
      orders: d.orders,
      newCustomerOrders: d.newCustomerOrders,
      paidSpend: money(d.paidSpend),
      metaSpend: money(d.metaSpend),
      googleSpend: money(d.googleSpend),
      metaRevenue: money(r2(d.newCustomerRevenue * metaShare * META_UPLIFT)),
      googleRevenue: money(r2(d.newCustomerRevenue * (1 - metaShare) * GOOGLE_UPLIFT)),
      metaPurchases: Math.round(d.newCustomerOrders * metaShare * META_PURCHASE_UPLIFT),
      googlePurchases: Math.round(d.newCustomerOrders * (1 - metaShare) * GOOGLE_PURCHASE_UPLIFT),
      metaGap: false,
      googleGap: false,
    };
  });
}

interface Totals {
  metaSpend: number;
  googleSpend: number;
  metaValue: number;
  googleValue: number;
  metaPurchases: number;
  googlePurchases: number;
}

function totalsOf(range: DateRange, display: string): Totals {
  const rows = demoPaidDays(range, display);
  const sum = (pick: (r: PaidDay) => number | null) =>
    rows.reduce((a, r) => a + (pick(r) ?? 0), 0);
  return {
    metaSpend: sum((r) => r.metaSpend),
    googleSpend: sum((r) => r.googleSpend),
    metaValue: sum((r) => r.metaRevenue),
    googleValue: sum((r) => r.googleRevenue),
    metaPurchases: sum((r) => r.metaPurchases),
    googlePurchases: sum((r) => r.googlePurchases),
  };
}

interface Spec {
  id: string;
  name: string;
  kind: string;
  brandClass: string | null;
  weight: number;
  /** How efficient the campaign is against its platform's average. */
  efficiency: number;
}

function stageOf(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("retarget")) return "retargeting";
  if (n.includes("prospect")) return "prospecting";
  return "unclassified";
}

const META_SPECS: Spec[] = CAMPAIGNS.map((name, i) => ({
  id: `demo-meta-${i + 1}`,
  name,
  kind: stageOf(name),
  brandClass: null,
  weight: Math.pow(0.68, i),
  efficiency: [1.15, 1.0, 0.9, 1.5, 0.8, 0.55][i % 6],
}));

const GOOGLE_SPECS: Spec[] = [
  { id: "demo-google-1", name: "Brand | Search", kind: "SEARCH", brandClass: "brand", weight: 0.2, efficiency: 2.4 },
  { id: "demo-google-2", name: "Non-brand | Search", kind: "SEARCH", brandClass: "non_brand", weight: 0.3, efficiency: 0.9 },
  { id: "demo-google-3", name: "PMax | All products", kind: "PERFORMANCE_MAX", brandClass: "shopping_pmax", weight: 0.35, efficiency: 0.95 },
  { id: "demo-google-4", name: "Shopping | Catalog", kind: "SHOPPING", brandClass: "shopping_pmax", weight: 0.15, efficiency: 0.8 },
];

/** Split a platform's totals over its campaigns. Value and purchases follow spend times efficiency. */
function split(
  platform: "meta" | "google",
  specs: Spec[],
  spend: number,
  value: number,
  purchases: number,
  salt: string
): Array<Pick<CampaignAgg, "id" | "spend" | "value" | "purchases">> {
  const w = specs.map((s) => s.weight * jitter(`ov:${platform}:${s.id}:${salt}`, 0.15));
  const wSum = w.reduce((a, b) => a + b, 0);
  const v = specs.map((s, i) => w[i] * s.efficiency);
  const vSum = v.reduce((a, b) => a + b, 0);
  return specs.map((s, i) => ({
    id: s.id,
    spend: r2((spend * w[i]) / wSum),
    value: r2((value * v[i]) / vSum),
    purchases: Math.round((purchases * v[i]) / vSum),
  }));
}

export function demoCampaigns(
  period: ResolvedPeriod,
  display: string,
  platforms: { meta: boolean; google: boolean }
): CampaignAgg[] {
  const cur = totalsOf(period.current, display);
  const prev = period.comparison ? totalsOf(period.comparison, display) : null;

  const build = (
    platform: "meta" | "google",
    specs: Spec[]
  ): CampaignAgg[] => {
    const pick = (t: Totals) =>
      platform === "meta"
        ? { s: t.metaSpend, v: t.metaValue, p: t.metaPurchases }
        : { s: t.googleSpend, v: t.googleValue, p: t.googlePurchases };
    const c = pick(cur);
    const now = split(platform, specs, c.s, c.v, c.p, "cur");
    const before = prev ? pick(prev) : null;
    const old = before ? split(platform, specs, before.s, before.v, before.p, "prev") : null;

    return specs.map((s, i) => ({
      platform,
      id: s.id,
      name: s.name,
      kind: s.kind,
      brandClass: s.brandClass,
      spend: now[i].spend,
      value: now[i].value,
      purchases: now[i].purchases,
      prevSpend: old ? old[i].spend : null,
      prevValue: old ? old[i].value : null,
      prevPurchases: old ? old[i].purchases : null,
    }));
  };

  return [
    ...(platforms.meta ? build("meta", META_SPECS) : []),
    ...(platforms.google ? build("google", GOOGLE_SPECS) : []),
  ];
}
