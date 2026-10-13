/**
 * The client's lines, and where a number sits against them.
 *
 * ── Pure numbers (owner decision, 2026-10-13) ───────────────────────────────
 * Every screen shows the real ROAS, attributed revenue over spend, never
 * adjusted. Every verdict is a plain comparison of that number with the
 * client's kill line and target, behind spend gates in multiples of target CPA
 * and the 14-day winner age. No purchase count, confidence class or interval
 * decides, softens or greys anything any more.
 *
 * One piece of the old precision arithmetic survives, `purchasesForPrecision`,
 * and only as a planning figure: the Concepts persona-capacity tooltip. It
 * never touches a verdict.
 */

/**
 * Relative standard error on ROAS is about `1.17 / sqrt(purchases)`, Poisson
 * arrivals combined with order-value variance at a coefficient of variation
 * around 0.6. The 95% half-width is 1.96 times that, so `2.29 / sqrt(n)`.
 * Planning only, see `purchasesForPrecision`.
 */
export const Z = 2.29;

/**
 * Everything the engine needs to judge a number, per client.
 *
 * Defaults come from CREATIVE_ENGINE_BRIEF.md 4.2. They are defaults for a
 * *new* client only, a client with a settings row uses its own, and the
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
  /** Gross margin, 0..1. Only used above ad level, see the note in verdict.ts. */
  grossMargin: number | null;

  scaleMultiplier: number;
  aggressiveMultiplier: number;
  holdGateX: number;
  iterateGateX: number;
  killGateX: number;

  hookRateFloor: number;
  holdRateFloor: number;
  /**
   * Where the two floors above came from: `relative` is the client's own p25
   * of genuine video ads (`lib/creative/floors.ts`), `fallback` the stored
   * Settings values. Absent when nobody asked (checks, Reports). Diagnostic
   * only, a floor never decides a money verdict.
   */
  floorBasis?: "relative" | "fallback";
  frequencyWarn: number;
  frequencyAct: number;

  noTouchDays: number;
  minAdsetBudgetDaily: number | null;
  perAdFloorDaily: number | null;
  tier: string | null;
}

/**
 * Purchases needed to pull the 95% half-width under `maxCiHalfWidth`.
 *
 * A planning figure, not a gate: at the default 0.25 it is 84 purchases, which
 * is the number behind the persona-capacity statement on Concepts. Reading a
 * persona to ±25% costs about 44 300 Kč at the pilot client's CPA, and it
 * spends about 273 000 Kč a quarter, so it can properly read about six
 * personas a quarter.
 */
export function purchasesForPrecision(maxCiHalfWidth: number): number {
  return Math.ceil((Z / maxCiHalfWidth) ** 2);
}

/**
 * Where a ROAS sits against the two lines. A plain comparison of the real
 * number, the same one every verdict makes.
 */
export type Zone = "above-target" | "under-target" | "below-kill";

export function zoneOf(
  roas: number,
  t: Pick<CreativeThresholds, "killRoas" | "targetRoas">
): Zone {
  if (roas >= t.targetRoas) return "above-target";
  if (roas < t.killRoas) return "below-kill";
  return "under-target";
}

export const ZONE_LABELS: Record<Zone, string> = {
  "above-target": "At target",
  "under-target": "Under target",
  "below-kill": "Below kill line",
};
