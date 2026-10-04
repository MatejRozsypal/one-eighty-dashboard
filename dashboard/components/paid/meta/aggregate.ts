/**
 * Pure arithmetic for the Meta tab. No BigQuery, no React.
 *
 * Every figure on the tab comes from one set of rows: (campaign, date) rows of
 * summable components, tagged with the period they fall in. Totals, the funnel,
 * the trend, the campaign table and the audience list are all sums over
 * subsets of those rows, so they cannot disagree with each other.
 *
 * Every rate is SUM(numerator) / SUM(denominator) (`lib/paid/math.ts`). No
 * pre-divided daily rate is read anywhere. `null` is "not measured" and renders
 * "n/a"; it is never zero.
 */

import { addDays, type DateRange } from "@/lib/period";
import { bucketStart, perThousand, ratio, sumOf } from "@/lib/paid/math";
import type { FunnelStage, Grain } from "@/lib/paid/types";

export type PeriodTag = "current" | "comparison";

type Num = number | null;

/** One campaign on one day, in ad account currency. */
export interface MetaRow {
  date: string;
  period: PeriodTag;
  campaignId: string;
  campaignName: string | null;
  funnelStage: FunnelStage;
  /** Upper-case market code; null is "Unknown". */
  market: string | null;
  spend: Num;
  revenue: Num;
  purchases: Num;
  impressions: Num;
  reach: Num;
  addToCart: Num;
  initiateCheckout: Num;
  landingPageViews: Num;
  linkClicks: Num;
  viewContent: Num;
  addPaymentInfo: Num;
}

/** Summed components. Every field is null when no row carried a value. */
export interface MetaSums {
  spend: Num;
  revenue: Num;
  purchases: Num;
  impressions: Num;
  reach: Num;
  addToCart: Num;
  initiateCheckout: Num;
  landingPageViews: Num;
  linkClicks: Num;
  viewContent: Num;
  addPaymentInfo: Num;
}

/** Video components for ads that played video in the period. */
export interface VideoSums {
  plays: Num;
  thruplays: Num;
  impressions: Num;
}

export const EMPTY_VIDEO: VideoSums = { plays: null, thruplays: null, impressions: null };

export function sumRows(rows: readonly MetaRow[]): MetaSums {
  return {
    spend: sumOf(rows, (r) => r.spend),
    revenue: sumOf(rows, (r) => r.revenue),
    purchases: sumOf(rows, (r) => r.purchases),
    impressions: sumOf(rows, (r) => r.impressions),
    reach: sumOf(rows, (r) => r.reach),
    addToCart: sumOf(rows, (r) => r.addToCart),
    initiateCheckout: sumOf(rows, (r) => r.initiateCheckout),
    landingPageViews: sumOf(rows, (r) => r.landingPageViews),
    linkClicks: sumOf(rows, (r) => r.linkClicks),
    viewContent: sumOf(rows, (r) => r.viewContent),
    addPaymentInfo: sumOf(rows, (r) => r.addPaymentInfo),
  };
}

export function sumVideo(parts: readonly VideoSums[]): VideoSums {
  return {
    plays: sumOf(parts, (p) => p.plays),
    thruplays: sumOf(parts, (p) => p.thruplays),
    impressions: sumOf(parts, (p) => p.impressions),
  };
}

export interface MetaRates {
  roas: Num;
  cpa: Num;
  aov: Num;
  cpm: Num;
  linkCtr: Num;
  cpc: Num;
  costPerLpv: Num;
  costPerAtc: Num;
  atcToPurchase: Num;
  /** LPV / link clicks. */
  lpvRate: Num;
  /** Add to cart / LPV. */
  atcRate: Num;
  /** Average daily frequency: impressions / reach over daily rows. */
  frequency: Num;
}

/** Derive every rate from summed components. */
export function ratesOf(s: MetaSums): MetaRates {
  return {
    roas: ratio(s.revenue, s.spend),
    cpa: ratio(s.spend, s.purchases),
    aov: ratio(s.revenue, s.purchases),
    cpm: perThousand(s.spend, s.impressions),
    linkCtr: ratio(s.linkClicks, s.impressions),
    cpc: ratio(s.spend, s.linkClicks),
    costPerLpv: ratio(s.spend, s.landingPageViews),
    costPerAtc: ratio(s.spend, s.addToCart),
    atcToPurchase: ratio(s.purchases, s.addToCart),
    lpvRate: ratio(s.landingPageViews, s.linkClicks),
    atcRate: ratio(s.addToCart, s.landingPageViews),
    frequency: ratio(s.impressions, s.reach),
  };
}

/** Hook rate: video plays over the impressions of the ads that played video. */
export function hookRate(v: VideoSums): Num {
  return ratio(v.plays, v.impressions);
}

/** Hold rate: ThruPlays over the same impressions. */
export function holdRate(v: VideoSums): Num {
  return ratio(v.thruplays, v.impressions);
}

export function inPeriod(rows: readonly MetaRow[], tag: PeriodTag): MetaRow[] {
  return rows.filter((r) => r.period === tag);
}

// ── Funnel ──────────────────────────────────────────────────────────────────

export interface FunnelStepData {
  key: string;
  label: string;
  /** Heading of the step's cost: "Cost / link click", "CPM", "CPA". */
  costLabel: string;
  value: number;
  /** Cost per step: spend / step (CPM for impressions). Null when spend is missing. */
  cost: Num;
  /** True for the impressions step, whose cost is per thousand. */
  perThousand: boolean;
}

/**
 * The funnel in order. A step with no value is dropped, not drawn as zero. The
 * order is fixed but the values are not assumed to fall: pixel view content can
 * exceed landing page views, and the Funnel shows the real step rate either way.
 */
export function funnelSteps(s: MetaSums): FunnelStepData[] {
  const defs: Array<{ key: string; label: string; costLabel: string; value: Num }> = [
    { key: "impressions", label: "Impressions", costLabel: "CPM", value: s.impressions },
    { key: "linkClicks", label: "Link clicks", costLabel: "Cost / link click", value: s.linkClicks },
    { key: "lpv", label: "LPV", costLabel: "Cost / LPV", value: s.landingPageViews },
    { key: "viewContent", label: "View content", costLabel: "Cost / view content", value: s.viewContent },
    { key: "atc", label: "Add to cart", costLabel: "Cost / ATC", value: s.addToCart },
    { key: "ic", label: "Checkout", costLabel: "Cost / checkout", value: s.initiateCheckout },
    { key: "api", label: "Payment info", costLabel: "Cost / payment info", value: s.addPaymentInfo },
    { key: "purchases", label: "Purchases", costLabel: "CPA", value: s.purchases },
  ];
  const out: FunnelStepData[] = [];
  for (const d of defs) {
    if (d.value === null) continue;
    const isImpr = d.key === "impressions";
    out.push({
      key: d.key,
      label: d.label,
      costLabel: d.costLabel,
      value: d.value,
      cost: isImpr ? perThousand(s.spend, d.value) : ratio(s.spend, d.value),
      perThousand: isImpr,
    });
  }
  return out;
}

// ── Trend ───────────────────────────────────────────────────────────────────

export interface Bucket {
  /** First day of the bucket. */
  start: string;
  sums: MetaSums;
}

/** Every bucket from `range.from` to `range.to`, in order, with gaps as empty sums. */
export function bucketList(range: DateRange, grain: Grain): string[] {
  const out: string[] = [];
  let last = "";
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const b = bucketStart(d, grain);
    if (b !== last) {
      out.push(b);
      last = b;
    }
  }
  return out;
}

/** Sums per bucket. Ratios are recomputed per bucket from these, never averaged. */
export function series(rows: readonly MetaRow[], range: DateRange, grain: Grain): Bucket[] {
  const keys = bucketList(range, grain);
  const byBucket = new Map<string, MetaRow[]>();
  for (const r of rows) {
    const b = bucketStart(r.date, grain);
    const list = byBucket.get(b);
    if (list) list.push(r);
    else byBucket.set(b, [r]);
  }
  return keys.map((start) => ({ start, sums: sumRows(byBucket.get(start) ?? []) }));
}

// ── Campaigns ───────────────────────────────────────────────────────────────

export interface CampaignAgg {
  campaignId: string;
  name: string;
  funnelStage: FunnelStage;
  market: string | null;
  current: MetaSums;
  previous: MetaSums | null;
}

/** One row per campaign that delivered in the current period, spend descending. */
export function campaignRows(rows: readonly MetaRow[], hasComparison: boolean): CampaignAgg[] {
  const groups = new Map<string, MetaRow[]>();
  for (const r of rows) {
    const g = groups.get(r.campaignId);
    if (g) g.push(r);
    else groups.set(r.campaignId, [r]);
  }
  const out: CampaignAgg[] = [];
  for (const [campaignId, list] of groups) {
    const cur = inPeriod(list, "current");
    const current = sumRows(cur);
    if ((current.spend ?? 0) <= 0 && (current.impressions ?? 0) <= 0) continue;
    const latest = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    out.push({
      campaignId,
      name: latest.campaignName ?? campaignId,
      funnelStage: latest.funnelStage,
      market: latest.market,
      current,
      previous: hasComparison ? sumRows(inPeriod(list, "comparison")) : null,
    });
  }
  out.sort((a, b) => (b.current.spend ?? 0) - (a.current.spend ?? 0));
  return out;
}

// ── Audience (naming dimensions) ────────────────────────────────────────────

export type NamingDimension = "stage" | "market";

export interface AudienceAgg {
  key: string;
  label: string;
  sums: MetaSums;
}

export const STAGE_LABEL: Record<FunnelStage, string> = {
  prospecting: "Prospecting",
  retargeting: "Retargeting",
  retention: "Retention",
  unclassified: "Unclassified",
};

export const STAGE_ORDER: FunnelStage[] = ["prospecting", "retargeting", "retention", "unclassified"];

export function marketLabel(market: string | null): string {
  return market ?? "Unknown";
}

/** Current-period sums grouped by funnel stage or market, spend descending. */
export function audienceRows(rows: readonly MetaRow[], dim: NamingDimension): AudienceAgg[] {
  const cur = inPeriod(rows, "current");
  const groups = new Map<string, MetaRow[]>();
  for (const r of cur) {
    const key = dim === "stage" ? r.funnelStage : marketLabel(r.market);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: AudienceAgg[] = [];
  for (const [key, list] of groups) {
    const sums = sumRows(list);
    if ((sums.spend ?? 0) <= 0 && (sums.impressions ?? 0) <= 0) continue;
    out.push({
      key,
      label: dim === "stage" ? STAGE_LABEL[key as FunnelStage] ?? key : key,
      sums,
    });
  }
  out.sort((a, b) => (b.sums.spend ?? 0) - (a.sums.spend ?? 0));
  return out;
}
