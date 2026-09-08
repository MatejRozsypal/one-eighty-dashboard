/**
 * What one ad cost to make.
 *
 * UGC pay structures vary enough that a single "rate" column would mean six
 * different things depending on the creator, so the pay model is an enum and
 * the cost per ad is derived from it. The derivation lives here, once, so the
 * Production ROI screen and anything built later cannot disagree about it.
 *
 * ── Precedence ─────────────────────────────────────────────────────────────
 * A manual `Production cost` on the ClickUp task always wins. Below that, the
 * creator's pay model. Below that, the per-method rate from settings. Every
 * result carries which of the three it was, so the Production ROI screen can
 * say what share of its own input was estimated rather than measured — a
 * contribution-margin figure built on guessed costs is worth exactly as much as
 * the guesses, and the screen should say so rather than imply otherwise.
 */

import type { PayModel } from "@/lib/creative/vocabulary";

export interface CreatorTerms {
  creatorId: string;
  payModel: PayModel | null;
  rate: number | null;
  deliverablesPerShoot: number | null;
  productCogs: number | null;
  usageFee: number | null;
  revSharePct: number | null;
}

/** Per-asset estimates by production method and format, entered in settings. */
export interface ProductionRate {
  productionMethod: string;
  format: string | null;
  costPerAsset: number;
  includesInternalTime: boolean;
}

export type CostSource = "manual" | "creator" | "settings" | "unknown";

export interface AdCost {
  cost: number | null;
  source: CostSource;
}

export function adCost(input: {
  /** From the ClickUp `Production cost` field. Beats everything. */
  manualCost: number | null;
  productionMethod: string | null;
  format: string | null;
  creator: CreatorTerms | null;
  rates: ProductionRate[];
  /** Revenue attributed to this ad — only `rev_share` needs it. */
  attributedRevenue: number;
}): AdCost {
  if (input.manualCost !== null && input.manualCost > 0) {
    return { cost: input.manualCost, source: "manual" };
  }

  const fromCreator = creatorCost(input.creator, input.attributedRevenue);
  if (fromCreator !== null) return { cost: fromCreator, source: "creator" };

  const fromSettings = settingsCost(input.productionMethod, input.format, input.rates);
  if (fromSettings !== null) return { cost: fromSettings, source: "settings" };

  // Deliberately null rather than zero. A zero production cost makes every
  // return figure infinite and every method look equally free, which is exactly
  // the shape of answer that gets quoted in a meeting.
  return { cost: null, source: "unknown" };
}

function creatorCost(c: CreatorTerms | null, attributedRevenue: number): number | null {
  if (!c || !c.payModel) return null;
  const per = (total: number | null, n: number | null) =>
    total === null || !n || n <= 0 ? null : total / n;

  switch (c.payModel) {
    case "flat_per_asset":
      return c.rate;
    case "per_shoot":
      return per(c.rate, c.deliverablesPerShoot);
    case "product_gift":
      return c.productCogs;
    case "base_plus_usage": {
      const base = per(c.rate, c.deliverablesPerShoot);
      return base === null ? null : base + (c.usageFee ?? 0);
    }
    case "rev_share":
      // Recomputed from current attributed revenue every time this runs, which
      // is what makes it a real cost rather than a forecast: a rev-share
      // creator whose ad earns nothing costs nothing.
      return c.revSharePct === null ? null : c.revSharePct * attributedRevenue;
    case "internal":
      return null; // falls through to the settings rate for the method
  }
}

function settingsCost(
  method: string | null,
  format: string | null,
  rates: ProductionRate[]
): number | null {
  if (!method) return null;
  // Prefer an exact method+format rate; fall back to the method's default row.
  const exact = rates.find((r) => r.productionMethod === method && r.format === format);
  if (exact) return exact.costPerAsset;
  const any = rates.find((r) => r.productionMethod === method && r.format === null);
  return any ? any.costPerAsset : null;
}

/**
 * Contribution margin for a group, net of what it cost to produce.
 *
 * ── Why this never appears at ad level ─────────────────────────────────────
 * Ad level is a like-for-like comparison between creatives, not a profitability
 * analysis: the production cost of one ad in a six-hook batch is an allocation,
 * not a measurement, and dividing a shoot six ways then ranking the six on the
 * result compares allocation noise. Contribution margin enters at concept level
 * and above, and on the Production ROI screen where the cost is the subject
 * rather than a divisor.
 */
export function contributionMargin(
  revenue: number,
  spend: number,
  grossMargin: number | null
): number | null {
  if (grossMargin === null) return null;
  return revenue * grossMargin - spend;
}
