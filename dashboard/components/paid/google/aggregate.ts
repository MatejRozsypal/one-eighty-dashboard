/**
 * Pure roll-ups for the Google tab.
 *
 * The campaign query returns summed components per campaign and period. Every
 * total, class column and KPI is built here by summing those components again
 * and dividing once, so a figure on the tab can always be rebuilt from the
 * campaign table beneath it.
 */

import { sumOf, ratio } from "@/lib/paid/math";
import type { BrandClass } from "@/lib/paid/types";
import type { GadsCampaignAgg, GadsMetrics } from "@/lib/queries/paidGoogle";

export type Part = "current" | "previous";

/** Sum of the fields every metrics row carries. Null when no campaign has that part. */
export function rollUp(rows: readonly GadsMetrics[]): GadsMetrics | null {
  if (rows.length === 0) return null;
  const s = (pick: (m: GadsMetrics) => number | null) => sumOf(rows, pick);
  return {
    spend: s((m) => m.spend),
    impressions: s((m) => m.impressions),
    clicks: s((m) => m.clicks),
    conversions: s((m) => m.conversions),
    value: s((m) => m.value),
    daysWithDelivery: null,
    isImpressions: s((m) => m.isImpressions),
    eligibleImpressions: s((m) => m.eligibleImpressions),
    lostBudgetImpressions: s((m) => m.lostBudgetImpressions),
    lostRankImpressions: s((m) => m.lostRankImpressions),
    topImpressions: s((m) => m.topImpressions),
    topEligibleImpressions: s((m) => m.topEligibleImpressions),
    absTopImpressions: s((m) => m.absTopImpressions),
    clickShareClicks: s((m) => m.clickShareClicks),
    eligibleClicks: s((m) => m.eligibleClicks),
  };
}

/** The campaigns' metrics for one period, skipping campaigns with no delivery in it. */
export function partOf(campaigns: readonly GadsCampaignAgg[], part: Part): GadsMetrics[] {
  const out: GadsMetrics[] = [];
  for (const c of campaigns) {
    const m = part === "current" ? c.current : c.previous;
    if (m) out.push(m);
  }
  return out;
}

/** The same, paired with the campaign's brand class, for the brand metrics in `lib/paid/math`. */
export function classedRows(
  campaigns: readonly GadsCampaignAgg[],
  part: Part
): Array<{ spend: number | null; value: number | null; brandClass: BrandClass }> {
  const out: Array<{ spend: number | null; value: number | null; brandClass: BrandClass }> = [];
  for (const c of campaigns) {
    const m = part === "current" ? c.current : c.previous;
    if (m) out.push({ spend: m.spend, value: m.value, brandClass: c.brandClass });
  }
  return out;
}

/** Rates over one set of summed components. Every one is sum over sum. */
export function rates(m: GadsMetrics | null) {
  return {
    roas: m ? ratio(m.value, m.spend) : null,
    cpa: m ? ratio(m.spend, m.conversions) : null,
    cvr: m ? ratio(m.conversions, m.clicks) : null,
    ctr: m ? ratio(m.clicks, m.impressions) : null,
    cpc: m ? ratio(m.spend, m.clicks) : null,
  };
}

export const BRAND_CLASSES: readonly BrandClass[] = [
  "brand",
  "non_brand",
  "shopping_pmax",
  "other",
];

/** Summed components per brand class, one entry per class that delivered in either period. */
export function classSplit(campaigns: readonly GadsCampaignAgg[]) {
  return BRAND_CLASSES.map((cls) => {
    const inClass = campaigns.filter((c) => c.brandClass === cls);
    return {
      cls,
      current: rollUp(partOf(inClass, "current")),
      previous: rollUp(partOf(inClass, "previous")),
    };
  }).filter((x) => x.current !== null);
}

/** Spend of campaigns whose channel type is in `types`, in the current period. */
export function channelSpend(
  campaigns: readonly GadsCampaignAgg[],
  types: readonly string[]
): number | null {
  return sumOf(
    campaigns.filter((c) => c.channelType !== null && types.includes(c.channelType)),
    (c) => c.current?.spend ?? null
  );
}
