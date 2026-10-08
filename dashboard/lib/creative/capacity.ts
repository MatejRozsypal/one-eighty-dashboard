/**
 * Creative velocity: how many new ads a Meta budget can bring to a verdict.
 *
 * Pure. No database, no React, no server-only import: the Plan calculator runs
 * it in the browser on every keystroke, the server pages run it for Overview,
 * This month and Track record, and `scripts/check-creative-velocity.ts` runs
 * the worked example. One function, so the four screens cannot disagree.
 *
 * ── The model (owner decisions 2026-10-08, design doc section 9) ───────────
 *   B = spend x share            new-creative spend a month
 *   V = N x CPA                  verdict cost: the money for N purchases
 *   verdicts a month = B / V
 *   d = B / 30.4                 daily money for new packs
 *   window = max(7, V / d)       days to a verdict, one pack launched at a time
 *   packs at once = floor(d x 7 / V), at least 1: how many packs the budget
 *                  carries side by side and still reaches a 7-day window
 *   capacity = verdicts a month x A          new ads a month
 *   winners  = capacity x hit rate; months per winner = 1 / winners
 *
 * Packs always run side by side under CBO, so extra budget buys more verdicts,
 * never a shorter cycle for one pack. The window is the no-touch rule: never
 * under 7 days, and longer until the pack has been paid N x CPA.
 *
 * Every output is null when an input it needs is missing or not positive. A
 * capacity of 0 would be a claim about the account; null renders n/a.
 */

/** Average days in a month. */
export const DAYS_IN_MONTH = 30.4;

/** The shortest no-touch window the SOP allows. */
export const MIN_WINDOW_DAYS = 7;

/** A window above this reads as a warning: the verdict arrives too late to act on. */
export const LONG_WINDOW_DAYS = 30;

/** An ad counts as new creative for its first 14 days of delivery (281). */
export const NEW_CREATIVE_DAYS = 14;

/** SOP per-ad signal floor, as a multiple of CPA a day. */
export const PER_AD_FLOOR_X = 0.5;

/** Default ads per pack when nobody has saved one. */
export const DEFAULT_ADS_PER_PACK = 4;

/** Overview and This month flag production above this multiple of capacity. */
export const OVER_CAPACITY_X = 1;

export interface CapacityInputs {
  /** Monthly Meta spend. */
  spend: number | null;
  /** Share of spend on new creative, 0..1. */
  share: number | null;
  cpa: number | null;
  /** Purchases a pack needs for a verdict (Settings "read at"). */
  verdictN: number | null;
  adsPerPack: number | null;
  /** Winners per launched ad, 0..1 (client's trailing 12 months). */
  hitRate: number | null;
}

export interface Capacity {
  /** B, a month. */
  newCreativeSpend: number | null;
  /** V. */
  verdictCost: number | null;
  /** B / V. */
  verdicts: number | null;
  /** d, a day. */
  daily: number | null;
  /** Days to a verdict with one pack launched at a time, at least 7. */
  windowDays: number | null;
  /** Packs the budget carries at once at a 7-day window, at least 1. */
  packsAtOnce: number | null;
  /** What one ad gets a day while its pack is in the window. */
  perAdDaily: number | null;
  /** 0.5 x CPA a day. */
  perAdFloor: number | null;
  /** New ads a month. */
  capacity: number | null;
  winners: number | null;
  monthsPerWinner: number | null;
  /** Monthly spend at which one pack reaches its verdict in 7 days. */
  spendFor7Day: number | null;
  /** New-creative spend a month at that point. */
  newCreativeFor7Day: number | null;
  /** Each ad gets less than the SOP per-ad floor. */
  belowPerAdFloor: boolean;
  /** The window runs past 30 days. */
  longWindow: boolean;
}

const pos = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v) && v > 0;

const nonNeg = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v) && v >= 0;

export function capacity(i: CapacityInputs): Capacity {
  const B = nonNeg(i.spend) && nonNeg(i.share) ? i.spend * i.share : null;
  const V = pos(i.verdictN) && pos(i.cpa) ? i.verdictN * i.cpa : null;
  const verdicts = B !== null && V !== null ? B / V : null;
  const daily = B !== null ? B / DAYS_IN_MONTH : null;
  const windowDays =
    V !== null && daily !== null && daily > 0 ? Math.max(MIN_WINDOW_DAYS, V / daily) : null;
  const packsAtOnce =
    V !== null && daily !== null && daily > 0 ? Math.max(1, Math.floor((daily * MIN_WINDOW_DAYS) / V)) : null;
  const A = pos(i.adsPerPack) ? i.adsPerPack : null;
  const perAdDaily = V !== null && windowDays !== null && A !== null ? V / windowDays / A : null;
  const perAdFloor = pos(i.cpa) ? i.cpa * PER_AD_FLOOR_X : null;
  const cap = verdicts !== null && A !== null ? verdicts * A : null;
  const winners = cap !== null && nonNeg(i.hitRate) ? cap * i.hitRate : null;
  const newCreativeFor7Day = V !== null ? (V / MIN_WINDOW_DAYS) * DAYS_IN_MONTH : null;

  return {
    newCreativeSpend: B,
    verdictCost: V,
    verdicts,
    daily,
    windowDays,
    packsAtOnce,
    perAdDaily,
    perAdFloor,
    capacity: cap,
    winners,
    monthsPerWinner: winners !== null && winners > 0 ? 1 / winners : null,
    spendFor7Day: newCreativeFor7Day !== null && pos(i.share) ? newCreativeFor7Day / i.share : null,
    newCreativeFor7Day,
    belowPerAdFloor: perAdDaily !== null && perAdFloor !== null && perAdDaily < perAdFloor,
    longWindow: windowDays !== null && windowDays > LONG_WINDOW_DAYS,
  };
}

/**
 * The reverse question: monthly spend needed to bring `target` new ads a month
 * to a verdict. (T / A) packs a month, each costing V, out of the share that
 * goes to new creative.
 */
export function spendForTarget(target: number | null, i: CapacityInputs): number | null {
  if (!nonNeg(target) || !pos(i.adsPerPack) || !pos(i.verdictN) || !pos(i.cpa) || !pos(i.share)) {
    return null;
  }
  return ((target / i.adsPerPack) * i.verdictN * i.cpa) / i.share;
}

/** Production against capacity: 1.0 means every new ad could be read. */
export function productionRatio(launched: number | null, cap: number | null): number | null {
  if (launched === null || cap === null || !(cap > 0)) return null;
  return launched / cap;
}

/** Brief quota for next month: capacity not already covered by the queue. */
export function briefQuota(cap: number | null, queued: number | null): number | null {
  if (cap === null || queued === null) return null;
  return Math.max(0, Math.round(cap) - queued);
}

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

export type Tier = "SMALL" | "MID" | "LARGE";

/** SOP tiers by monthly Meta spend in USD. */
export function tierOf(monthlyUsd: number | null): Tier | null {
  if (!nonNeg(monthlyUsd)) return null;
  if (monthlyUsd < 3000) return "SMALL";
  if (monthlyUsd <= 15000) return "MID";
  return "LARGE";
}

// ---------------------------------------------------------------------------
// Scenario ladder
// ---------------------------------------------------------------------------

/** Multiples of the input spend the ladder shows. */
export const LADDER_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** Two significant figures: 17,950 becomes 18,000, 538 becomes 540. */
export function roundNice(v: number): number {
  if (!(v > 0)) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}

export interface LadderRow {
  spend: number;
  current: boolean;
  result: Capacity;
}

/** The same inputs at other spend levels. The x1 row keeps the exact input. */
export function scenarioLadder(i: CapacityInputs): LadderRow[] {
  if (!pos(i.spend)) return [];
  const base = i.spend;
  return LADDER_STEPS.map((step) => {
    const spend = step === 1 ? base : roundNice(base * step);
    return { spend, current: step === 1, result: capacity({ ...i, spend }) };
  });
}

// ---------------------------------------------------------------------------
// The worked example the owner signed off (Ethia, 2026-10-08)
// ---------------------------------------------------------------------------

/**
 * Ethia from the warehouse on 2026-10-08: spend 35,900 Kc in 30 days, CPA 554
 * (90 days, 7d click + 1d view), share 28.9 %, N 10, 4 ads per pack. Expected:
 * B about 10,375, V 5,540, about 1.87 verdicts, about 341 a day, window about
 * 16.2 days, about 7.5 new ads a month, about 83,000 a month (24,000 on new
 * creative) for a 7-day window. `scripts/check-creative-velocity.ts` holds it.
 */
export const ETHIA_EXAMPLE: CapacityInputs = {
  spend: 35900,
  share: 0.289,
  cpa: 554,
  verdictN: 10,
  adsPerPack: 4,
  hitRate: null,
};
