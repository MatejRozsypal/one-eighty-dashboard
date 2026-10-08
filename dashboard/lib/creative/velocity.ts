/**
 * Creative helpers that predate the Velocity area and are still read elsewhere:
 * whether an ad is net-new (Production ROI), how many personas a quarter can
 * read (Concepts), and packs launched per month (`LaunchCadence`).
 *
 * The capacity model the Velocity screens run on lives in `capacity.ts`. The
 * pack spec, the horizon table and the eight gauges that used to live here
 * were replaced by it (owner decisions 2026-10-08).
 */

import type { AdRow } from "@/lib/creative/model";

/**
 * Whether an ad is net-new, or null when nobody said.
 *
 * ClickUp's `Content Purpose` states it (Net-new against Winner Variant). For
 * ads that predate the field, a b1h1 code pair reads as net-new: the first hook
 * on the first body of a concept. An ad with neither is unknown, never
 * net-new: counting every untagged ad as net-new put every client at 58 to
 * 100 % against a 20 % target on 2026-10-08.
 */
export function isNetNew(a: AdRow): boolean | null {
  if (a.tags.productionType !== null) return a.tags.productionType === "Net-new";
  if (a.tags.hookCode !== null && a.tags.bodyCode !== null) {
    return a.tags.hookCode === "h1" && a.tags.bodyCode === "b1";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persona capacity
// ---------------------------------------------------------------------------

export interface PersonaCapacity {
  /** Purchases needed to read one persona to the client's precision target. */
  purchasesPerPersona: number;
  /** Spend that costs, at target CPA. */
  spendPerPersona: number;
  /** How many the current quarterly spend can actually read. */
  readablePerQuarter: number;
  activePersonas: number;
  /** Personas with no spend in 90 days. Inventory, not findings. */
  dormant: number;
}

/**
 * "At current spend you can read 6 personas per quarter. 12 are active."
 *
 * The arithmetic that settles the argument rather than continuing it: reading a
 * persona to ±25% takes about 84 purchases, which at a 527 Kč CPA is about
 * 44 300 Kč. The pilot client spends about 273 000 Kč a quarter. Cutting the active set
 * is the fix; a better dashboard is not.
 */
export function personaCapacity(
  purchasesNeeded: number,
  targetCpa: number,
  quarterlySpend: number,
  activePersonas: number,
  dormant: number
): PersonaCapacity {
  const spendPerPersona = purchasesNeeded * targetCpa;
  return {
    purchasesPerPersona: purchasesNeeded,
    spendPerPersona,
    readablePerQuarter:
      spendPerPersona > 0 ? Math.floor(quarterlySpend / spendPerPersona) : 0,
    activePersonas,
    dormant,
  };
}

// ---------------------------------------------------------------------------
// Launch cadence
// ---------------------------------------------------------------------------

export interface LaunchMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Short label for the axis. */
  label: string;
  packs: number;
}

/**
 * Packs launched per month, counted off the ad sets themselves.
 *
 * ── Why this is the chart and not a number ─────────────────────────────────
 * A count of packs launched in the last 30 days answers the wrong shape of
 * question: cadence is a rhythm, and a rhythm is only visible over
 * several months. An account that shipped four packs in June and none since
 * reads identically to one shipping two a month, on a gauge that only sees the
 * last thirty days, and those are opposite situations. One is a team that
 * stopped; the other is a team that is fine.
 *
 * A pack is an ad set, and the month it launched is the month its first
 * delivery landed in. Ad sets with no delivery at all are not launches: nothing
 * ran, so nothing can be judged, and counting them would let a folder of drafts
 * look like output.
 *
 * The dates come from `getAdsetLaunchDates`, which reads them lifetime, never
 * from `AdsetRow.firstDate`, which is clamped to the selected window and would
 * put the entire account's launches in the last thirty days.
 */
export function launchCadence(launchDates: string[], months = 6): LaunchMonth[] {
  const now = new Date();
  const buckets: LaunchMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      packs: 0,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.month, i]));

  for (const date of launchDates) {
    const at = index.get(date.slice(0, 7));
    if (at !== undefined) buckets[at].packs += 1;
  }
  return buckets;
}
