/**
 * Demo data for the Paid > Google tab.
 *
 * Campaign spend splits the demo spine's daily Google spend (`days()`), so the
 * tab's total is the same number the Snapshot nets out of CM2. Everything is a
 * deterministic function of its key: the same range gives the same figures on
 * every render. Sub-entities (ad groups, devices, PMax networks) are fixed
 * shares of their campaign and sum to it exactly. Search terms and products
 * cover only part of the spend, like the real marts.
 *
 * Returns the same shapes as `lib/queries/paidGoogle.ts`; the page cannot tell
 * the two apart.
 */

import type { DateRange, ResolvedPeriod } from "@/lib/period";
import type {
  GadsAdGroupRow,
  GadsCampaignAgg,
  GadsCoverage,
  GadsDeviceRow,
  GadsKeywordRow,
  GadsLeakage,
  GadsMetrics,
  GadsPmaxNetworkRow,
  GadsProductGroup,
  GadsProductRow,
  GadsTermMode,
  GadsTermRow,
} from "@/lib/queries/paidGoogle";
import type { BrandClass } from "@/lib/paid/types";
import { days } from "./business";
import { jitter } from "./random";

const r2 = (n: number): number => Math.round(n * 100) / 100;

interface DemoCampaign {
  id: string;
  name: string;
  channel: string;
  brandClass: BrandClass;
  bidding: string;
  targetRoas: number | null;
  budget: number;
  weight: number;
  roas: number;
  cpc: number;
  ctr: number;
  /** Search impression share, null where Google reports none. */
  is: number | null;
  lostBudget: number;
  lostRank: number;
}

/** Weights sum to 1. */
const CAMPAIGNS: DemoCampaign[] = [
  { id: "d1", name: "US - S: Brand", channel: "SEARCH", brandClass: "brand", bidding: "MANUAL_CPC", targetRoas: null, budget: 55, weight: 0.08, roas: 9.2, cpc: 0.42, ctr: 0.11, is: 0.86, lostBudget: 0.03, lostRank: 0.11 },
  { id: "d2", name: "US - S: Skincare", channel: "SEARCH", brandClass: "non_brand", bidding: "MAXIMIZE_CONVERSION_VALUE", targetRoas: 3.5, budget: 160, weight: 0.22, roas: 3.7, cpc: 1.18, ctr: 0.052, is: 0.34, lostBudget: 0.21, lostRank: 0.45 },
  { id: "d3", name: "US - S: Competitors", channel: "SEARCH", brandClass: "non_brand", bidding: "TARGET_SPEND", targetRoas: null, budget: 45, weight: 0.06, roas: 1.5, cpc: 1.62, ctr: 0.031, is: 0.19, lostBudget: 0.05, lostRank: 0.76 },
  { id: "d4", name: "US - PLA: All products", channel: "SHOPPING", brandClass: "shopping_pmax", bidding: "TARGET_ROAS", targetRoas: null, budget: 130, weight: 0.2, roas: 4.2, cpc: 0.55, ctr: 0.018, is: 0.41, lostBudget: 0.14, lostRank: 0.45 },
  { id: "d5", name: "US - PMAX: Mixed", channel: "PERFORMANCE_MAX", brandClass: "shopping_pmax", bidding: "MAXIMIZE_CONVERSION_VALUE", targetRoas: 3.2, budget: 240, weight: 0.38, roas: 3.1, cpc: 0.48, ctr: 0.014, is: null, lostBudget: 0, lostRank: 0 },
  { id: "d6", name: "US - DG: Remarketing", channel: "DEMAND_GEN", brandClass: "other", bidding: "MAXIMIZE_CONVERSIONS", targetRoas: null, budget: 35, weight: 0.06, roas: 2.2, cpc: 0.36, ctr: 0.009, is: null, lostBudget: 0, lostRank: 0 },
];

const AOV = 72;

/** The campaign's share of the day's Google spend. Shares sum to 1, so campaigns add up to the spine. */
function daySpend(c: DemoCampaign, date: string, googleSpend: number): number {
  const raw = (k: DemoCampaign) => k.weight * jitter(`gs:${k.id}:${date}`, 0.14);
  const total = CAMPAIGNS.reduce((a, k) => a + raw(k), 0);
  return googleSpend * (raw(c) / total);
}

function metricsFor(c: DemoCampaign, range: DateRange): GadsMetrics | null {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return null;

  let spend = 0, value = 0, clicks = 0, impressions = 0, delivered = 0;
  for (const d of rows) {
    const s = daySpend(c, d.date, d.googleSpend);
    if (s <= 0) continue;
    delivered++;
    spend += s;
    value += s * c.roas * jitter(`gv:${c.id}:${d.date}`, 0.22);
    const k = s / (c.cpc * jitter(`gc:${c.id}:${d.date}`, 0.08));
    clicks += k;
    impressions += k / c.ctr;
  }
  if (spend === 0) return null;

  const conversions = value / (AOV * jitter(`aov:${c.id}:${range.from}`, 0.05));
  const hasIs = c.is !== null;
  const eligible = hasIs ? impressions / (c.is as number) : null;
  const topShare = c.channel === "SHOPPING" ? null : (c.is ?? 0) * 0.62;

  return {
    spend: r2(spend),
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    conversions: r2(conversions),
    value: r2(value),
    daysWithDelivery: delivered,
    isImpressions: hasIs ? Math.round(impressions) : null,
    eligibleImpressions: eligible,
    lostBudgetImpressions: eligible === null ? null : eligible * c.lostBudget,
    lostRankImpressions: eligible === null ? null : eligible * c.lostRank,
    topImpressions: eligible === null || topShare === null ? null : eligible * topShare,
    topEligibleImpressions: eligible === null || topShare === null ? null : eligible,
    absTopImpressions: eligible === null ? null : eligible * (c.is as number) * 0.28,
    clickShareClicks: hasIs ? Math.round(clicks) : null,
    eligibleClicks: hasIs ? clicks / ((c.is as number) * 0.9) : null,
  };
}

export function demoCampaignAgg(period: ResolvedPeriod): GadsCampaignAgg[] {
  return CAMPAIGNS.map((c) => ({
    campaignId: c.id,
    campaignName: c.name,
    channelType: c.channel,
    brandClass: c.brandClass,
    status: "ENABLED",
    biddingStrategyType: c.bidding,
    targetRoas: c.targetRoas,
    budgetPerDay: c.budget,
    budgetShared: false,
    current: metricsFor(c, period.current),
    previous: period.comparison ? metricsFor(c, period.comparison) : null,
  }));
}

function campaignOf(id: string): DemoCampaign {
  return CAMPAIGNS.find((c) => c.id === id) ?? CAMPAIGNS[0];
}

// ── PMax networks ───────────────────────────────────────────────────────────

/** Spend share and value multiplier per network, each set summing to 1 on spend. */
const NETWORKS: Array<{ network: string; spend: number; valueMultiplier: number }> = [
  { network: "SEARCH", spend: 0.46, valueMultiplier: 1.7 },
  { network: "YOUTUBE", spend: 0.2, valueMultiplier: 0.6 },
  { network: "CONTENT", spend: 0.15, valueMultiplier: 0.5 },
  { network: "DISCOVER", spend: 0.12, valueMultiplier: 0.55 },
  { network: "GMAIL", spend: 0.01, valueMultiplier: 0.2 },
  { network: "SEARCH_PARTNERS", spend: 0.06, valueMultiplier: 0.3 },
];

export function demoPmaxSplit(range: DateRange): GadsPmaxNetworkRow[] {
  const c = CAMPAIGNS.find((x) => x.channel === "PERFORMANCE_MAX");
  const m = c ? metricsFor(c, range) : null;
  if (!c || !m || m.spend === null || m.value === null) return [];

  const weighted = NETWORKS.reduce((a, n) => a + n.spend * n.valueMultiplier, 0);
  return NETWORKS.map((n) => ({
    campaignId: c.id,
    campaignName: c.name,
    network: n.network,
    spend: r2(m.spend! * n.spend),
    value: r2(m.value! * ((n.spend * n.valueMultiplier) / weighted)),
  }));
}

// ── Ad groups and devices ───────────────────────────────────────────────────

const AD_GROUPS: Record<string, Array<{ name: string; share: number; roas: number }>> = {
  d1: [{ name: "Brand exact", share: 0.7, roas: 1.1 }, { name: "Brand phrase", share: 0.3, roas: 0.9 }],
  d2: [
    { name: "Serums", share: 0.38, roas: 1.2 },
    { name: "Moisturisers", share: 0.27, roas: 1.0 },
    { name: "Cleansers", share: 0.2, roas: 0.9 },
    { name: "Eye care", share: 0.15, roas: 0.7 },
  ],
  d3: [{ name: "Competitor names", share: 0.6, roas: 1.0 }, { name: "Alternatives", share: 0.4, roas: 1.0 }],
  d4: [{ name: "Best sellers", share: 0.55, roas: 1.25 }, { name: "Everything else", share: 0.45, roas: 0.73 }],
  d6: [{ name: "Cart abandoners", share: 0.6, roas: 1.2 }, { name: "Site visitors", share: 0.4, roas: 0.7 }],
};

export function demoAdGroups(range: DateRange, campaignId: string): GadsAdGroupRow[] {
  const c = campaignOf(campaignId);
  const m = metricsFor(c, range);
  const groups = AD_GROUPS[c.id];
  if (!m || !groups || m.spend === null || m.value === null) return [];

  const weighted = groups.reduce((a, g) => a + g.share * g.roas, 0);
  return groups
    .map((g, i) => {
      const spend = m.spend! * g.share;
      const value = m.value! * ((g.share * g.roas) / weighted);
      return {
        adGroupId: `${c.id}-g${i}`,
        adGroupName: g.name,
        spend: r2(spend),
        impressions: Math.round(m.impressions! * g.share),
        clicks: Math.round(m.clicks! * g.share),
        conversions: r2(m.conversions! * ((g.share * g.roas) / weighted)),
        value: r2(value),
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

const DEVICES: Array<{ device: string; share: number; roas: number }> = [
  { device: "MOBILE", share: 0.62, roas: 0.9 },
  { device: "DESKTOP", share: 0.3, roas: 1.25 },
  { device: "TABLET", share: 0.07, roas: 1.0 },
  { device: "CONNECTED_TV", share: 0.01, roas: 0.2 },
];

export function demoDevices(range: DateRange, campaignId: string): GadsDeviceRow[] {
  const m = metricsFor(campaignOf(campaignId), range);
  if (!m || m.spend === null || m.value === null) return [];
  const weighted = DEVICES.reduce((a, d) => a + d.share * d.roas, 0);
  return DEVICES.map((d) => ({
    device: d.device,
    spend: r2(m.spend! * d.share),
    impressions: Math.round(m.impressions! * d.share),
    clicks: Math.round(m.clicks! * d.share),
    conversions: r2(m.conversions! * ((d.share * d.roas) / weighted)),
    value: r2(m.value! * ((d.share * d.roas) / weighted)),
  }));
}

// ── Search terms and keywords ───────────────────────────────────────────────

interface DemoTerm {
  term: string;
  campaign: string;
  match: string;
  brand: boolean;
  status: string;
  /** Share of the campaign's spend. */
  share: number;
  /** Return relative to the campaign (0 is a term that never converts). */
  roas: number;
}

const TERMS: DemoTerm[] = [
  { term: "lumen botanicals", campaign: "d1", match: "EXACT", brand: true, status: "ADDED", share: 0.34, roas: 1.1 },
  { term: "lumen serum", campaign: "d1", match: "PHRASE", brand: true, status: "ADDED", share: 0.2, roas: 1.0 },
  { term: "lumen botanical reviews", campaign: "d1", match: "BROAD", brand: true, status: "NONE", share: 0.08, roas: 0.6 },
  { term: "best vitamin c serum", campaign: "d2", match: "BROAD", brand: false, status: "NONE", share: 0.16, roas: 1.2 },
  { term: "vitamin c serum for face", campaign: "d2", match: "PHRASE", brand: false, status: "ADDED", share: 0.12, roas: 1.3 },
  { term: "natural moisturiser", campaign: "d2", match: "BROAD", brand: false, status: "NONE", share: 0.1, roas: 0.9 },
  { term: "lumen botanicals serum", campaign: "d2", match: "BROAD", brand: true, status: "NONE", share: 0.05, roas: 1.6 },
  { term: "retinol alternative", campaign: "d2", match: "PHRASE", brand: false, status: "NONE", share: 0.07, roas: 1.0 },
  { term: "organic face oil", campaign: "d2", match: "BROAD", brand: false, status: "NONE", share: 0.06, roas: 0.5 },
  { term: "free skincare samples", campaign: "d2", match: "BROAD", brand: false, status: "NONE", share: 0.04, roas: 0 },
  { term: "diy face serum", campaign: "d2", match: "BROAD", brand: false, status: "EXCLUDED", share: 0.03, roas: 0 },
  { term: "cheap serum", campaign: "d2", match: "BROAD", brand: false, status: "NONE", share: 0.03, roas: 0 },
  { term: "eye cream for dark circles", campaign: "d2", match: "PHRASE", brand: false, status: "NONE", share: 0.05, roas: 0.8 },
  { term: "competitor a serum", campaign: "d3", match: "EXACT", brand: false, status: "ADDED", share: 0.3, roas: 1.0 },
  { term: "competitor b reviews", campaign: "d3", match: "PHRASE", brand: false, status: "NONE", share: 0.2, roas: 0.6 },
  { term: "alternative to competitor a", campaign: "d3", match: "BROAD", brand: false, status: "NONE", share: 0.14, roas: 1.4 },
  { term: "competitor a coupon", campaign: "d3", match: "BROAD", brand: false, status: "NONE", share: 0.09, roas: 0 },
];

function termRows(range: DateRange): GadsTermRow[] {
  const rows: GadsTermRow[] = [];
  for (const t of TERMS) {
    const c = campaignOf(t.campaign);
    const m = metricsFor(c, range);
    if (!m || m.spend === null || m.clicks === null || m.impressions === null) continue;
    const k = jitter(`term:${t.term}:${range.from}`, 0.1);
    const spend = m.spend * t.share * k;
    const value = t.roas === 0 ? 0 : spend * c.roas * t.roas * jitter(`termv:${t.term}:${range.from}`, 0.12);
    rows.push({
      searchTerm: t.term,
      campaignId: c.id,
      campaignName: c.name,
      matchType: t.match,
      status: t.status,
      isBrand: t.brand,
      spend: r2(spend),
      impressions: Math.round(m.impressions * t.share * k),
      clicks: Math.round(m.clicks * t.share * k),
      conversions: value === 0 ? 0 : r2(value / AOV),
      value: r2(value),
    });
  }
  return rows;
}

export function demoSearchTerms(range: DateRange, mode: GadsTermMode): GadsTermRow[] {
  return termRows(range)
    .filter((t) => {
      if (mode === "brand") return t.isBrand;
      if (mode === "nonbrand") return !t.isBrand;
      if (mode === "waste") return (t.spend ?? 0) > 0 && t.conversions === 0;
      return true;
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 200);
}

export function demoLeakage(period: ResolvedPeriod): GadsLeakage {
  const parts = (range: DateRange) => {
    const nonBrand = termRows(range).filter(
      (t) => campaignOf(t.campaignId).brandClass === "non_brand"
    );
    const total = nonBrand.reduce((a, t) => a + (t.spend ?? 0), 0);
    const brand = nonBrand.filter((t) => t.isBrand).reduce((a, t) => a + (t.spend ?? 0), 0);
    return total > 0 ? { brandSpend: r2(brand), totalSpend: r2(total) } : { brandSpend: null, totalSpend: null };
  };
  return {
    current: parts(period.current),
    previous: period.comparison ? parts(period.comparison) : null,
  };
}

const KEYWORDS: Array<{ text: string; match: string; campaign: string; share: number; roas: number; qs: number | null }> = [
  { text: "lumen botanicals", match: "EXACT", campaign: "d1", share: 0.6, roas: 1.1, qs: 10 },
  { text: "lumen serum", match: "PHRASE", campaign: "d1", share: 0.4, roas: 0.9, qs: 9 },
  { text: "vitamin c serum", match: "BROAD", campaign: "d2", share: 0.3, roas: 1.1, qs: 7 },
  { text: "face serum", match: "BROAD", campaign: "d2", share: 0.22, roas: 1.0, qs: 6 },
  { text: "natural skincare", match: "PHRASE", campaign: "d2", share: 0.18, roas: 1.1, qs: 7 },
  { text: "organic moisturiser", match: "BROAD", campaign: "d2", share: 0.14, roas: 0.7, qs: 5 },
  { text: "eye cream", match: "EXACT", campaign: "d2", share: 0.1, roas: 0.9, qs: 8 },
  { text: "competitor a", match: "EXACT", campaign: "d3", share: 0.55, roas: 1.0, qs: 4 },
  { text: "competitor b", match: "PHRASE", campaign: "d3", share: 0.45, roas: 0.7, qs: null },
];

export function demoKeywords(range: DateRange): GadsKeywordRow[] {
  const rows: GadsKeywordRow[] = [];
  for (const k of KEYWORDS) {
    const c = campaignOf(k.campaign);
    const m = metricsFor(c, range);
    if (!m || m.spend === null || m.clicks === null || m.impressions === null) continue;
    const spend = m.spend * k.share;
    const value = spend * c.roas * k.roas;
    rows.push({
      keyword: k.text,
      matchType: k.match,
      campaignId: c.id,
      campaignName: c.name,
      qualityScore: k.qs,
      spend: r2(spend),
      impressions: Math.round(m.impressions * k.share),
      clicks: Math.round(m.clicks * k.share),
      conversions: r2(value / AOV),
      value: r2(value),
    });
  }
  return rows.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

// ── Products ────────────────────────────────────────────────────────────────

const PRODUCTS: Array<{ id: string; type: string; brand: string; label: string; channel: string; share: number; roas: number }> = [
  { id: "LB-1001", type: "Serums", brand: "Lumen", label: "Best seller", channel: "SHOPPING", share: 0.2, roas: 1.4 },
  { id: "LB-1002", type: "Serums", brand: "Lumen", label: "Best seller", channel: "SHOPPING", share: 0.14, roas: 1.2 },
  { id: "LB-2001", type: "Moisturisers", brand: "Lumen", label: "Core", channel: "SHOPPING", share: 0.12, roas: 1.0 },
  { id: "LB-2002", type: "Moisturisers", brand: "Lumen", label: "Core", channel: "SHOPPING", share: 0.1, roas: 0.8 },
  { id: "LB-3001", type: "Cleansers", brand: "Lumen", label: "Core", channel: "SHOPPING", share: 0.08, roas: 0.9 },
  { id: "LB-4001", type: "Eye care", brand: "Lumen", label: "New", channel: "SHOPPING", share: 0.07, roas: 0.6 },
  { id: "LB-5001", type: "Sets", brand: "Lumen", label: "Gift", channel: "SHOPPING", share: 0.06, roas: 1.6 },
  { id: "LB-6001", type: "Sets", brand: "Lumen", label: "Gift", channel: "SHOPPING", share: 0.05, roas: 0 },
  { id: "LB-7001", type: "Masks", brand: "Lumen", label: "Clearance", channel: "SHOPPING", share: 0.04, roas: 0 },
  { id: "LB-1001", type: "Serums", brand: "Lumen", label: "Best seller", channel: "PERFORMANCE_MAX", share: 0.18, roas: 1.1 },
  { id: "LB-2001", type: "Moisturisers", brand: "Lumen", label: "Core", channel: "PERFORMANCE_MAX", share: 0.1, roas: 0.9 },
  { id: "LB-5001", type: "Sets", brand: "Lumen", label: "Gift", channel: "PERFORMANCE_MAX", share: 0.06, roas: 1.3 },
  { id: "LB-7001", type: "Masks", brand: "Lumen", label: "Clearance", channel: "PERFORMANCE_MAX", share: 0.03, roas: 0 },
];

function productRows(range: DateRange): Array<GadsProductRow & { type: string; brand: string; label: string }> {
  const out: Array<GadsProductRow & { type: string; brand: string; label: string }> = [];
  for (const p of PRODUCTS) {
    const c = CAMPAIGNS.find((x) => x.channel === p.channel);
    const m = c ? metricsFor(c, range) : null;
    if (!c || !m || m.spend === null || m.clicks === null || m.impressions === null) continue;
    // Shopping rows cover all of that campaign; PMax rows cover a fifth of it.
    const cover = p.channel === "SHOPPING" ? 1 : 0.2;
    const spend = m.spend * p.share * cover;
    const value = p.roas === 0 ? 0 : spend * c.roas * p.roas;
    out.push({
      key: p.id,
      productType: p.type,
      channelType: p.channel,
      spend: r2(spend),
      impressions: Math.round(m.impressions * p.share * cover),
      clicks: Math.round(m.clicks * p.share * cover),
      conversions: value === 0 ? 0 : r2(value / AOV),
      value: r2(value),
      type: p.type,
      brand: p.brand,
      label: p.label,
    });
  }
  return out;
}

export function demoProducts(
  range: DateRange,
  group: GadsProductGroup,
  zeroOnly: boolean
): GadsProductRow[] {
  const merged = new Map<string, GadsProductRow>();
  for (const r of productRows(range)) {
    const key = group === "item" ? r.key : group === "type" ? r.type : group === "brand" ? r.brand : r.label;
    const id = `${key}|${r.channelType}`;
    const prev = merged.get(id);
    if (!prev) {
      merged.set(id, {
        key,
        productType: group === "item" ? r.productType : null,
        channelType: r.channelType,
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        value: r.value,
      });
    } else {
      prev.spend = r2((prev.spend ?? 0) + (r.spend ?? 0));
      prev.impressions = (prev.impressions ?? 0) + (r.impressions ?? 0);
      prev.clicks = (prev.clicks ?? 0) + (r.clicks ?? 0);
      prev.conversions = r2((prev.conversions ?? 0) + (r.conversions ?? 0));
      prev.value = r2((prev.value ?? 0) + (r.value ?? 0));
    }
  }
  return [...merged.values()]
    .filter((r) => (r.spend ?? 0) > 0 && (!zeroOnly || r.conversions === 0))
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 200);
}

export function demoCoverage(range: DateRange): GadsCoverage {
  const terms = termRows(range).reduce((a, t) => a + (t.spend ?? 0), 0);
  const products = productRows(range).reduce((a, p) => a + (p.spend ?? 0), 0);
  return { termSpend: terms > 0 ? r2(terms) : null, productSpend: products > 0 ? r2(products) : null };
}
