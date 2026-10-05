/**
 * The Overview's arithmetic, pure: rows in, figures out. No BigQuery, no React.
 *
 * One daily query feeds every shop-first widget (tiles, chart, platform table,
 * period table). Everything below derives from those rows, so a figure shown in
 * two places is the same sum in both, and every ratio is SUM / SUM over the
 * rows it covers (`lib/paid/math.ts`), never an average of daily ratios.
 *
 * ── Spend that cannot be trusted is null ────────────────────────────────────
 * `paid_spend` in the daily mart is Meta + Google with a missing platform
 * counted as zero. When a month has no FX rate the platform's converted spend
 * is NULL, so the total silently understates. A day whose spend could not be
 * converted is flagged (`metaGap` / `googleGap`), and any sum that includes it
 * returns null for the affected spend and everything derived from it. A
 * comparison period with such a day gives no delta.
 */

import { addDays, type DateRange } from "@/lib/period";
import { bucketStart, ratio, relativeChange, sumOf } from "@/lib/paid/math";
import type { Grain } from "@/lib/paid/types";

type N = number | null;

// ── Rows ────────────────────────────────────────────────────────────────────

/** One day of the daily mart, money already in the display currency. */
export interface PaidDay {
  date: string;
  revenue: N;
  newCustomerRevenue: N;
  orders: N;
  newCustomerOrders: N;
  paidSpend: N;
  metaSpend: N;
  googleSpend: N;
  metaRevenue: N;
  googleRevenue: N;
  metaPurchases: N;
  googlePurchases: N;
  /** Meta delivered but its spend could not be converted (no FX rate). */
  metaGap: boolean;
  /** Same for Google. */
  googleGap: boolean;
}

/** Sums over any set of days. Spend fields are null when a gap day is inside. */
export interface Sums {
  revenue: N;
  newCustomerRevenue: N;
  orders: N;
  newCustomerOrders: N;
  paidSpend: N;
  metaSpend: N;
  googleSpend: N;
  metaRevenue: N;
  googleRevenue: N;
  metaPurchases: N;
  googlePurchases: N;
  metaGap: boolean;
  googleGap: boolean;
}

export function sumDays(rows: readonly PaidDay[]): Sums {
  const metaGap = rows.some((r) => r.metaGap);
  const googleGap = rows.some((r) => r.googleGap);
  const meta = metaGap ? null : sumOf(rows, (r) => r.metaSpend);
  const google = googleGap ? null : sumOf(rows, (r) => r.googleSpend);
  const paid = metaGap || googleGap ? null : sumOf(rows, (r) => r.paidSpend);
  return {
    revenue: sumOf(rows, (r) => r.revenue),
    newCustomerRevenue: sumOf(rows, (r) => r.newCustomerRevenue),
    orders: sumOf(rows, (r) => r.orders),
    newCustomerOrders: sumOf(rows, (r) => r.newCustomerOrders),
    paidSpend: paid,
    metaSpend: meta,
    googleSpend: google,
    metaRevenue: sumOf(rows, (r) => r.metaRevenue),
    googleRevenue: sumOf(rows, (r) => r.googleRevenue),
    metaPurchases: sumOf(rows, (r) => r.metaPurchases),
    googlePurchases: sumOf(rows, (r) => r.googlePurchases),
    metaGap,
    googleGap,
  };
}

/** The shop-first efficiency figures, all SUM / SUM. */
export interface Efficiency {
  /** New-customer revenue / paid spend. */
  amer: N;
  /** Revenue / paid spend. */
  mer: N;
  /** Paid spend / new customers. */
  ncac: N;
  /** Paid spend / all orders. */
  cac: N;
}

export function efficiency(s: Sums): Efficiency {
  return {
    amer: ratio(s.newCustomerRevenue, s.paidSpend),
    mer: ratio(s.revenue, s.paidSpend),
    ncac: ratio(s.paidSpend, s.newCustomerOrders),
    cac: ratio(s.paidSpend, s.orders),
  };
}

/** Rows of one range out of a scan that covers two. */
export function rowsIn(rows: readonly PaidDay[], range: DateRange): PaidDay[] {
  return rows.filter((r) => r.date >= range.from && r.date <= range.to);
}

/** A per-day series for a sparkline, in date order. Null days are gaps. */
export function dailySeries(rows: readonly PaidDay[], pick: (day: PaidDay) => N): N[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date)).map(pick);
}

// ── Buckets ─────────────────────────────────────────────────────────────────

export interface Bucket extends Sums {
  /** First day of the bucket (itself, its ISO Monday, or the 1st). */
  start: string;
  /** Last day of the bucket, clipped to the range. */
  end: string;
}

function lastDayOf(start: string, grain: Grain): string {
  if (grain === "day") return start;
  if (grain === "week") return addDays(start, 6);
  const [y, m] = start.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Group a range's days into buckets, oldest first. Ratios are taken from each bucket's own sums. */
export function bucketize(
  rows: readonly PaidDay[],
  range: DateRange,
  grain: Grain
): Bucket[] {
  const groups = new Map<string, PaidDay[]>();
  for (const r of rowsIn(rows, range)) {
    const key = bucketStart(r.date, grain);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, g]) => {
      const end = lastDayOf(start, grain);
      return { start, end: end > range.to ? range.to : end, ...sumDays(g) };
    });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 3" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Label of a bucket: a day, a week span ("Sep 28 to Oct 4") or a month ("Sep 2026"). */
export function bucketLabel(b: Pick<Bucket, "start" | "end">, grain: Grain): string {
  if (grain === "day") return shortDate(b.start);
  if (grain === "month") {
    const [y, m] = b.start.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)} to ${shortDate(b.end)}`;
}

// ── Chart points ────────────────────────────────────────────────────────────

export interface ChartPoint {
  label: string;
  meta: N;
  google: N;
  amer: N;
  mer: N;
  ncac: N;
  /** The same metrics over the comparison period, aligned by bucket index. */
  cAmer: N;
  cMer: N;
  cNcac: N;
}

export function chartPoints(
  current: readonly Bucket[],
  previous: readonly Bucket[] | null,
  grain: Grain
): ChartPoint[] {
  return current.map((b, i) => {
    const e = efficiency(b);
    const p = previous?.[i];
    const pe = p ? efficiency(p) : null;
    return {
      label: bucketLabel(b, grain),
      meta: b.metaSpend,
      google: b.googleSpend,
      amer: e.amer,
      mer: e.mer,
      ncac: e.ncac,
      cAmer: pe?.amer ?? null,
      cMer: pe?.mer ?? null,
      cNcac: pe?.ncac ?? null,
    };
  });
}

// ── Campaigns and spend mix ─────────────────────────────────────────────────

export type CampaignPlatform = "meta" | "google";

/** One campaign over the current range, plus the comparison range when comparing. Money in the display currency. */
export interface CampaignAgg {
  platform: CampaignPlatform;
  id: string;
  name: string | null;
  /** Meta: funnel stage. Google: channel type. */
  kind: string | null;
  /** Google only: brand class. */
  brandClass: string | null;
  spend: N;
  value: N;
  purchases: N;
  prevSpend: N;
  prevValue: N;
  prevPurchases: N;
}

const CHANNEL_LABELS: Record<string, string> = {
  SEARCH: "Search",
  SHOPPING: "Shopping",
  PERFORMANCE_MAX: "PMax",
  DEMAND_GEN: "Demand Gen",
  DISPLAY: "Display",
  VIDEO: "Video",
  SMART: "Smart",
  LOCAL: "Local",
  TRAVEL: "Travel",
  HOTEL: "Hotel",
  MULTI_CHANNEL: "App",
};

const STAGE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  retargeting: "Retargeting",
  retention: "Retention",
  unclassified: "Unclassified",
};

const CLASS_LABELS: Record<string, string> = {
  brand: "Brand",
  non_brand: "Non-brand",
  shopping_pmax: "Shopping & PMax",
  other: "Other",
};

function titleCase(raw: string): string {
  const t = raw.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The Type column: a Meta funnel stage, or a Google channel type with its brand class. */
export function campaignType(c: Pick<CampaignAgg, "platform" | "kind" | "brandClass">): string | null {
  if (c.platform === "meta") return STAGE_LABELS[c.kind ?? "unclassified"] ?? titleCase(c.kind ?? "");
  const channel = c.kind ? (CHANNEL_LABELS[c.kind] ?? titleCase(c.kind)) : null;
  if (!channel) return null;
  if (c.brandClass === "brand") return `${channel}, brand`;
  if (c.brandClass === "non_brand") return `${channel}, non-brand`;
  return channel;
}

/** Spend descending, rows without spend last. */
export function bySpend<T extends { spend: N }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.spend === null && b.spend === null) return 0;
    if (a.spend === null) return 1;
    if (b.spend === null) return -1;
    return b.spend - a.spend;
  });
}

export function topCampaigns(rows: readonly CampaignAgg[], limit: number): CampaignAgg[] {
  return bySpend(rows.filter((r) => r.spend !== null && r.spend > 0)).slice(0, limit);
}

export interface MixSegment {
  key: string;
  label: string;
  spend: number;
  /** Share of the bar, a fraction. */
  share: number;
  value: N;
  roas: N;
}

const META_STAGE_ORDER = ["prospecting", "retargeting", "retention", "unclassified"];
const GOOGLE_CLASS_ORDER = ["brand", "non_brand", "shopping_pmax", "other"];

/**
 * A platform's spend split into segments (Meta by funnel stage, Google by
 * brand class). Empty when the platform has no spend. A campaign with an
 * unknown spend is left out of the bar: it cannot be sized.
 */
export function spendMix(rows: readonly CampaignAgg[], platform: CampaignPlatform): MixSegment[] {
  const mine = rows.filter((r) => r.platform === platform && r.spend !== null && r.spend > 0);
  const order = platform === "meta" ? META_STAGE_ORDER : GOOGLE_CLASS_ORDER;
  const labels = platform === "meta" ? STAGE_LABELS : CLASS_LABELS;
  const total = sumOf(mine, (r) => r.spend);
  if (total === null || total <= 0) return [];

  const keyOf = (r: CampaignAgg): string =>
    (platform === "meta" ? r.kind : r.brandClass) ?? order[order.length - 1];

  const groups = new Map<string, CampaignAgg[]>();
  for (const r of mine) {
    const k = keyOf(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  const known = order.filter((k) => groups.has(k));
  const extra = [...groups.keys()].filter((k) => !order.includes(k));
  return [...known, ...extra].map((k) => {
    const g = groups.get(k) ?? [];
    const spend = sumOf(g, (r) => r.spend) ?? 0;
    const value = sumOf(g, (r) => r.value);
    return {
      key: k,
      label: labels[k] ?? titleCase(k),
      spend,
      share: spend / total,
      value,
      roas: ratio(value, spend),
    };
  });
}

// ── GA4 ─────────────────────────────────────────────────────────────────────

/** GA4 last-click revenue by attributed platform, in the display currency. Null revenue means partial FX. */
export interface Ga4Totals {
  meta: N;
  google: N;
  /** Every paid platform GA4 recognises, including ones this table has no row for. */
  paid: N;
}
