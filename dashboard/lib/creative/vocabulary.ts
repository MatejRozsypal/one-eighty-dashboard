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

/**
 * The full angle vocabulary, verbatim from the ClickUp dropdown.
 *
 * ── These strings are a join key, not labels ───────────────────────────────
 * The coverage grid marks an angle "never run" by looking for its exact string
 * among the angles that have taken spend. Five of these were paraphrased in an
 * earlier draft — "Comparison / objection" for "Comparison / objection
 * handling", "Disqualification" for "Disqualification / reverse psychology" —
 * and every one of those angles would have shown as never run while quietly
 * holding budget, which is the exact opposite of what this screen is for.
 *
 * Read from the live field (`4fe4240c-94cb-4eb5-bbc5-1a29dbcf6e77` on the
 * concept list) on 9 Sep 2026, in its own order. If somebody renames an option
 * in ClickUp, this has to change with it and the sync's issue log will say so.
 */
export const ANGLES = [
  "Contrarian truth",
  "Problem agitation",
  "Curiosity gap",
  "Social proof",
  "Comparison / objection handling",
  "Transformation before/after",
  "Truth bomb",
  "Unique mechanism",
  "Myth list",
  "Category villain / common enemy",
  "Cost of inaction",
  "Reframe the cost",
  "Founder / origin story",
  "Demonstration / proof-in-action",
  "Disqualification / reverse psychology",
  "Scarcity / urgency",
  "FOMO / momentum",
  'Qualification / "if-then" callout',
] as const;

export type Angle = (typeof ANGLES)[number];

/**
 * Funnel stage. TOF / MOF / BOF only — `RT` was removed from the SOP because
 * retargeting is a property of the campaign the ad runs in, not of the
 * creative.
 *
 * ⚠ NO CLICKUP FIELD HOLDS THIS TODAY. `Content Purpose` looks like it should
 * and does not — its options are Net-new / Offer-Promo / Winner Variant, which
 * is production type, not funnel position. Until a `Funnel stage` field exists,
 * stage is parsed out of the ad name and is null wherever the name does not
 * carry it. See runbooks/29.
 */
export const STAGES = ["TOF", "MOF", "BOF"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * `Content Purpose` on the ad pipeline — what the ad is FOR, not where in the
 * funnel it sits.
 *
 * This turns out to be the better signal for the 80/20 rule than anything
 * derived from naming: "Net-new" against "Winner Variant" is precisely the
 * split the rule is about, stated by the person who briefed the ad rather than
 * inferred from whether its name ends in b1h1.
 */
export const PRODUCTION_TYPES = ["Net-new", "Offer-Promo", "Winner Variant"] as const;
export type ProductionType = (typeof PRODUCTION_TYPES)[number];

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

/**
 * The field on an `AdView` that each breakdown dimension groups by.
 *
 * ── Why this map has to exist ──────────────────────────────────────────────
 * Breakdown answers "which angle earned the spend"; the only useful next
 * question is "show me those ads", and the Creatives grid is where that is
 * answered. Linking the two needs the raw value the grid filters on, not the
 * label the table prints — `Concept` reads as "Curiosity gap" and matches on a
 * concept id; `Format` reads as "Video" and matches on `DYN`.
 *
 * Keyed by the same strings the picker uses, so a new dimension cannot be added
 * to one and forgotten in the other without TypeScript saying so.
 */
export const FOCUS_FIELD: Record<BreakdownKey, string> = {
  angle: "angle",
  persona: "persona",
  concept: "conceptId",
  offer: "offer",
  format: "format",
  stage: "stage",
  method: "method",
  creator: "creator",
  hook: "bodyHook",
  adset: "adsetName",
};

export function focusLabel(key: string): string {
  const dim = BREAKDOWN_DIMENSIONS.find((d) => FOCUS_FIELD[d.key] === key);
  return dim ? dim.label : key;
}
