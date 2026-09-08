/**
 * The controlled vocabularies the Creative Engine reads.
 *
 * These live in code rather than in the warehouse on purpose. The angle list in
 * particular has to render *before* any data arrives — the Concepts screen
 * shows all eighteen angles and marks the unused ones "never run", which is the
 * single most useful thing on that screen and would be impossible if the list
 * were derived from what has already been spent on. A vocabulary derived from
 * usage can only ever tell you what you already did.
 *
 * They mirror the ClickUp dropdowns. When a dropdown gains an option, add it
 * here too; the sync records anything it cannot place in
 * `ops.clickup_sync_issues` rather than inventing a category, so drift is
 * visible rather than silent.
 */

/** The full angle vocabulary. Order is the ClickUp option order. */
export const ANGLES = [
  "Problem agitation",
  "Contrarian truth",
  "Curiosity gap",
  "Social proof",
  "Comparison / objection",
  "Transformation before/after",
  "Truth bomb",
  "Unique mechanism",
  "Myth list",
  "Category villain",
  "Cost of inaction",
  "Reframe the cost",
  "Founder / origin story",
  "Demonstration / proof",
  "Disqualification",
  "Scarcity / urgency",
  "FOMO / momentum",
  "Qualification if-then",
] as const;

export type Angle = (typeof ANGLES)[number];

/**
 * Funnel stage. TOF / MOF / BOF only — `RT` was removed from the SOP because
 * retargeting is a property of the campaign the ad runs in, not of the
 * creative.
 */
export const STAGES = ["TOF", "MOF", "BOF"] as const;
export type Stage = (typeof STAGES)[number];

export const FORMATS = ["STAT", "DYN", "CAR", "DPA"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<Format, string> = {
  STAT: "Static",
  DYN: "Video",
  CAR: "Carousel",
  DPA: "Catalogue",
};

/** Only video carries hook and hold rate. Everything else is judged on CTR. */
export function hasVideoMetrics(format: string | null): boolean {
  return format === "DYN";
}

export const PRODUCTION_METHODS = [
  "Internal studio",
  "AI generated",
  "UGC",
  "Influencer",
  "Agency",
] as const;
export type ProductionMethod = (typeof PRODUCTION_METHODS)[number];

export const CREATOR_TYPES = [
  "Agency",
  "Brand employee",
  "UGC creator",
  "Influencer",
] as const;
export type CreatorType = (typeof CREATOR_TYPES)[number];

/**
 * How a creator is paid, and therefore how cost-per-ad is derived. See
 * `lib/creative/cost.ts` — the derivation is there so the Production ROI screen
 * and any future report cannot disagree about what an ad cost.
 */
export const PAY_MODELS = [
  "flat_per_asset",
  "per_shoot",
  "product_gift",
  "base_plus_usage",
  "rev_share",
  "internal",
] as const;
export type PayModel = (typeof PAY_MODELS)[number];

export const PAY_MODEL_LABELS: Record<PayModel, string> = {
  flat_per_asset: "Flat per asset",
  per_shoot: "Per shoot",
  product_gift: "Product gift",
  base_plus_usage: "Base plus usage",
  rev_share: "Revenue share",
  internal: "Internal",
};

/** Breakdown dimensions offered on the Breakdown screen, in menu order. */
export const BREAKDOWN_DIMENSIONS = [
  { key: "angle", label: "Angle" },
  { key: "persona", label: "Persona" },
  { key: "concept", label: "Concept" },
  { key: "offer", label: "Offer" },
  { key: "format", label: "Format" },
  { key: "stage", label: "Funnel stage" },
  { key: "method", label: "Production method" },
  { key: "creator", label: "Creator" },
  { key: "hook", label: "Body & hook" },
  { key: "adset", label: "Ad set (delivery context)" },
] as const;

export type BreakdownKey = (typeof BREAKDOWN_DIMENSIONS)[number]["key"];

export function isBreakdownKey(v: string | undefined): v is BreakdownKey {
  return BREAKDOWN_DIMENSIONS.some((d) => d.key === v);
}
