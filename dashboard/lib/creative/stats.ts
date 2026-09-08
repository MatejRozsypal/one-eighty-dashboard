/**
 * The arithmetic that stops this tool lying.
 *
 * ── The problem it exists for ───────────────────────────────────────────────
 * One Eighty's clients spend roughly two orders of magnitude less than the
 * accounts Motion and Blue Sense Digital's framework are built for. Manami runs
 * about 91 000 Kč a month at a 527 Kč CPA — about 173 purchases a month across
 * the entire account.
 *
 * Purchases are the denominator of every money metric, so at that volume a
 * single ad's 30-day ROAS carries a 95% interval of roughly ±60 to ±115%. A
 * dashboard that ranks twelve personas by last-30-days ROAS at this spend level
 * is a random number generator with a nice font, and because it looks
 * authoritative it makes decisions *worse* than the spreadsheet it replaces.
 * The learnings file records exactly that happening: format, funnel stage and
 * offer all "showed differences" that did not survive scrutiny.
 *
 * Everything in this file is one of the two defences against that.
 */

/**
 * Relative standard error on ROAS is about `1.17 / sqrt(purchases)` — Poisson
 * arrivals combined with order-value variance at a coefficient of variation
 * around 0.6. The 95% half-width is 1.96 times that, so:
 *
 *     half-width = 2.29 / sqrt(n)
 *
 * This constant is the single most consequential number in the product. Lower
 * it and the tool starts answering questions it cannot answer.
 */
export const Z = 2.29;

/**
 * Everything the engine needs to judge a number, per client.
 *
 * Defaults come from CREATIVE_ENGINE_BRIEF.md 4.2. They are defaults for a
 * *new* client only — a client with a settings row uses its own, and the
 * money-line values (kill, target, CPA) deliberately have no default at all,
 * because a guessed kill line silently reclassifies every ad in the account.
 */
export interface CreativeThresholds {
  /** Break-even. Below this every sale loses money. No default: must be stated. */
  killRoas: number;
  /** Set with the client at kickoff. No default. */
  targetRoas: number;
  /** Median cost per purchase. Drives every spend gate. No default. */
  targetCpa: number;
  /** Gross margin, 0..1. Only used above ad level — see the note in verdict.ts. */
  grossMargin: number | null;

  scaleMultiplier: number;
  aggressiveMultiplier: number;
  holdGateX: number;
  iterateGateX: number;
  killGateX: number;

  /** Purchases before a row is "Read" confidence. Also the shrinkage weight. */
  readPurchases: number;
  /** Purchases before a row is even "Directional". */
  directionalPurchases: number;
  /** Above this relative half-width, the verdict is NOT SEPARABLE. */
  maxCiHalfWidth: number;

  hookRateFloor: number;
  holdRateFloor: number;
  frequencyWarn: number;
  frequencyAct: number;

  noTouchDays: number;
  minAdsetBudgetDaily: number | null;
  perAdFloorDaily: number | null;
  tier: string | null;
}

/**
 * Shrinkage toward the account mean — defence one.
 *
 *     reported = (n x observed + k x account_mean) / (n + k)
 *
 * with `k` the client's read threshold. An ad with 4 purchases at a raw 3.38
 * reports as 2.17, not 3.38. This is the arithmetic version of the rule already
 * written in the learnings file: *a creative at 15x on trivial spend is not a
 * winner.* Piliero's rule, made continuous.
 *
 * Both numbers are shown in the UI. The shrunk one is the one that sorts and
 * colours, because it is the one that is defensible.
 */
export function shrink(
  observedRoas: number,
  purchases: number,
  accountMeanRoas: number,
  k: number
): number {
  if (!Number.isFinite(observedRoas)) return accountMeanRoas;
  const n = Math.max(0, purchases);
  return (n * observedRoas + k * accountMeanRoas) / (n + k);
}

/**
 * Relative 95% half-width at `n` purchases.
 *
 * Returns a deliberately absurd number below one purchase rather than Infinity:
 * the caller renders it, and "±900%" reads as "we know nothing", where a blank
 * or an ∞ reads as a bug.
 */
export function halfWidth(purchases: number): number {
  return purchases < 1 ? 9 : Z / Math.sqrt(purchases);
}

/** The 95% interval around a ROAS estimate. Never returns a negative floor. */
export function interval(roas: number, purchases: number): [number, number] {
  const h = halfWidth(purchases);
  return [Math.max(0, roas * (1 - h)), roas * (1 + h)];
}

export type Confidence = "read" | "directional" | "noise";

export function confidenceOf(
  purchases: number,
  t: Pick<CreativeThresholds, "readPurchases" | "directionalPurchases">
): Confidence {
  if (purchases >= t.readPurchases) return "read";
  if (purchases >= t.directionalPurchases) return "directional";
  return "noise";
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  read: "Read",
  directional: "Directional",
  noise: "Noise",
};

/**
 * Purchases needed for the lower bound of the interval to clear `line`.
 *
 * Solving `roas x (1 - Z/sqrt(n)) >= line` for n:
 *
 *     n >= (Z / (1 - line/roas))^2
 *
 * Null when the estimate is already at or below the line, because no amount of
 * data makes a losing number clear the line it is under — it makes it *more*
 * certainly under it, which is a different (and also useful) answer.
 */
export function purchasesToClear(roas: number, line: number): number | null {
  if (!Number.isFinite(roas) || roas <= line) return null;
  return Math.ceil((Z / (1 - line / roas)) ** 2);
}

/**
 * Purchases needed to pull the half-width under `maxCiHalfWidth`.
 *
 * At the default 0.25 and Z = 2.29 this is 84 purchases — which is the number
 * behind the persona-capacity statement in the brief: reading a persona to ±25%
 * costs about 44 300 Kč at Manami's CPA, and Manami spends about 273 000 Kč a
 * quarter, so it can properly read about six personas a quarter. Twelve are
 * active.
 */
export function purchasesForPrecision(maxCiHalfWidth: number): number {
  return Math.ceil((Z / maxCiHalfWidth) ** 2);
}

/**
 * "This costs 4 200 Kč to find out."
 *
 * The most useful single figure the product produces: it converts "we do not
 * know yet" into a price, which is a decision somebody can actually take.
 * Null when the question is already answered, or cannot be answered by spending
 * more.
 */
export function spendToDecide(
  roas: number,
  purchases: number,
  line: number,
  targetCpa: number
): number | null {
  const needed = purchasesToClear(roas, line);
  if (needed === null || needed <= purchases) return null;
  return (needed - purchases) * targetCpa;
}

/**
 * Where a row sits against the two lines, once the interval is taken into
 * account. This is what the Breakdown screen's plain-language readout says, and
 * it is deliberately willing to say "cannot tell yet".
 */
export type Separation =
  | "above-target"
  | "profitable-under-target"
  | "below-kill"
  | "cannot-tell"
  | "too-little-data";

export function separation(
  roas: number,
  purchases: number,
  t: Pick<CreativeThresholds, "killRoas" | "targetRoas" | "directionalPurchases">
): Separation {
  if (purchases < t.directionalPurchases) return "too-little-data";
  const [lo, hi] = interval(roas, purchases);
  if (lo >= t.targetRoas) return "above-target";
  if (hi < t.killRoas) return "below-kill";
  if (lo >= t.killRoas) return "profitable-under-target";
  return "cannot-tell";
}

export const SEPARATION_LABELS: Record<Separation, string> = {
  "above-target": "above target",
  "profitable-under-target": "profitable, under target",
  "below-kill": "below the kill line",
  "cannot-tell": "cannot tell yet",
  "too-little-data": "too little data",
};
