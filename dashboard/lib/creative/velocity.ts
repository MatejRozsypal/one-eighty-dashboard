/**
 * Creative velocity — the pack, not the ad.
 *
 * ── Why the pack is the unit ───────────────────────────────────────────────
 * Nathan's model is `expected value per ad = mean spend per ad x 7-day-click
 * ROAS`, then `creatives per month = revenue target / expected value`. He names
 * its two failures himself: it ignores how long an ad takes to spend, and it
 * does not separate winners from losers.
 *
 * One Eighty launches weekly-to-biweekly batches into NEW ad sets with a
 * minimum daily spend held for a 7 to 14 day evaluation window. That has a
 * fixed cost to a verdict and a fixed duration, which closes both gaps. So the
 * mechanic is built on packs.
 *
 * ── The equation, and the two purchases it is short by ─────────────────────
 * From the learnings file: 25 purchases to a verdict, 860 Kč/day minimum on a
 * new pack (2x CPA), 215 Kč/day per-ad signal floor (0.5x CPA), 14-day no-touch.
 *
 *     ads per pack   = 860 / 215     =  4 ads      exactly what PACK6 launched with
 *     a 14-day pack  = 860 x 14      = 12 040 Kč   = 23 purchases at 527 Kč
 *     a verdict needs= 25 x 527      = 13 175 Kč   = 16 days at 860 Kč/day
 *
 * The ads-per-pack figure landing exactly on what PACK6 actually launched with
 * is a good sign the floor is set right. The horizon does not quite close: a
 * 14-day pack reaches 23 purchases and the test size is 25. Two short, every
 * pack — which means either the verdict is taken on thinner data than the
 * standard claims, or the no-touch window quietly runs long. `packSpec` states
 * that as one line with two answers rather than hiding it in a table.
 */

import type { AdRow, AdsetRow } from "@/lib/creative/model";

export interface PackSettings {
  /** Purchases a pack must reach before its verdict means anything. */
  testPurchases: number;
  targetCpa: number;
  /** 0.5x CPA. Below this an ad produces no creative signal at all. */
  perAdFloorDaily: number;
  /** 2x CPA. Below this the carriers starve the test pack under CBO. */
  minPackDaily: number;
  noTouchDays: number;
  monthlyBudget: number;
  packsPerMonthTarget: number;
  hooksPerBodyTarget: number;
  netNewShareTarget: number;
}

export interface PackSpec {
  /** Spend required to reach the test size. Fixed; only its spread is a choice. */
  verdictSpend: number;
  adsPerPack: number;
  packCost: number;
  purchasesReached: number;
  purchasesNeeded: number;
  daysToVerdict: number;
  /** True when a pack run for the no-touch window reaches the test size. */
  closes: boolean;
  /** Daily budget that would make it close inside the window. */
  dailyToClose: number;
  /** Days it would need at the current daily budget. */
  daysToClose: number;
}

export function packSpec(s: PackSettings): PackSpec {
  const verdictSpend = s.testPurchases * s.targetCpa;
  const adsPerPack = Math.max(1, Math.floor(s.minPackDaily / s.perAdFloorDaily));
  const packCost = s.minPackDaily * s.noTouchDays;
  const purchasesReached = Math.round(packCost / s.targetCpa);

  return {
    verdictSpend,
    adsPerPack,
    packCost,
    purchasesReached,
    purchasesNeeded: s.testPurchases,
    daysToVerdict: Math.ceil(verdictSpend / s.minPackDaily),
    closes: purchasesReached >= s.testPurchases,
    dailyToClose: Math.ceil(verdictSpend / s.noTouchDays),
    daysToClose: Math.ceil(verdictSpend / s.minPackDaily),
  };
}

export interface HorizonOption {
  days: number;
  dailyBudget: number;
  adsPerPack: number;
  packsPerMonth: number;
  newAdsPerMonth: number;
  shareOfBudget: number;
  current: boolean;
}

/**
 * The planner. The cost of a verdict is fixed; how you spread it is the choice,
 * and it is the only real lever in the whole system.
 *
 * Fourteen days is the right setting for a MID-tier account: it lands on about
 * nine new ads a month, the bottom of the SOP's 8-16 quota. Anything shorter
 * spends more than half the account on testing; anything longer outruns the
 * no-touch window and starves the pack.
 */
export function horizons(s: PackSettings, days = [7, 10, 14, 21]): HorizonOption[] {
  const verdictSpend = s.testPurchases * s.targetCpa;
  return days.map((d) => {
    const dailyBudget = Math.ceil(verdictSpend / d);
    const adsPerPack = Math.max(1, Math.floor(dailyBudget / s.perAdFloorDaily));
    const packsPerMonth = 30 / d;
    return {
      days: d,
      dailyBudget,
      adsPerPack,
      packsPerMonth,
      newAdsPerMonth: Math.round(packsPerMonth * adsPerPack),
      shareOfBudget: s.monthlyBudget > 0 ? (dailyBudget * 30) / s.monthlyBudget : 0,
      current: d === s.noTouchDays,
    };
  });
}

// ---------------------------------------------------------------------------
// The eight gauges
// ---------------------------------------------------------------------------

export type GaugeState = "ok" | "warn" | "bad";

export interface Gauge {
  label: string;
  /** Already formatted — the gauge tile prints numbers, not prose. */
  value: string;
  /** The target, phrased as a comparison. */
  against: string;
  /** 0..1, where 1 is "at target". Drives the bar fill. */
  fill: number;
  /** 0..1 position of the target tick on that bar. */
  mark: number;
  state: GaugeState;
}

export interface VelocityInput {
  ads: AdRow[];
  adsets: AdsetRow[];
  settings: PackSettings;
}

/**
 * Eight tiles, red / amber / green, no prose.
 *
 * On Manami today three read red: one pack launched in the last 30 days against
 * a target of two, 1.0 hooks per body against a target of six, and 80% net-new
 * production against a 20% target. None of the three needs more budget to fix,
 * which is the point of showing them together.
 */
export function gauges(input: VelocityInput): Gauge[] {
  const { ads, adsets, settings: s } = input;
  const spec = packSpec(s);

  const recent = adsets.filter((a) => a.ageDays !== null && a.ageDays <= 30);
  const packsLast30 = recent.length;
  const newest = [...adsets]
    .filter((a) => a.ageDays !== null)
    .sort((a, b) => (a.ageDays ?? 0) - (b.ageDays ?? 0))[0];

  const adsInLastPack = newest
    ? ads.filter((a) => a.adsetId === newest.adsetId).length
    : 0;

  const adsLast30 = ads.filter((a) =>
    recent.some((r) => r.adsetId === a.adsetId)
  ).length;
  const adsTarget = Math.round(s.packsPerMonthTarget * spec.adsPerPack);

  // Hooks per body. Nathan: two bodies and fifteen hooks beats five bodies and
  // two hooks. This is the only creative test One Eighty has the sample size to
  // read, it is the cheapest production there is — re-record three to five
  // seconds — and it has never been run once.
  const bodies = new Set(
    ads.map((a) => `${a.tags.conceptId ?? a.adId}|${a.tags.bodyCode ?? "b?"}`)
  ).size;
  const hooksPerBody = bodies > 0 ? ads.length / bodies : 0;

  // Net-new share, for the 80/20 rule.
  //
  // ClickUp's `Content Purpose` states this directly — Net-new against Winner
  // Variant is exactly the split the rule is about — so it is used wherever it
  // is filled in. The b1h1 reading is the fallback for the ads that predate the
  // field: first hook on the first body of a concept is a fresh idea rather
  // than an iteration of a proven one. Inference only where nobody stated it.
  const stated = ads.filter((a) => a.tags.productionType !== null);
  const netNew =
    stated.length > 0
      ? stated.filter((a) => a.tags.productionType === "Net-new").length / stated.length
      : ads.length
        ? ads.filter(
            (a) => (a.tags.hookCode ?? "h1") === "h1" && (a.tags.bodyCode ?? "b1") === "b1"
          ).length / ads.length
        : 0;

  const testShare = s.monthlyBudget > 0 ? (s.minPackDaily * 30) / s.monthlyBudget : 0;

  const band = (v: number, ok: boolean, warn: boolean): GaugeState =>
    ok ? "ok" : warn ? "warn" : "bad";

  return [
    {
      label: "Packs launched, 30d",
      value: String(packsLast30),
      against: `target ${s.packsPerMonthTarget}`,
      fill: clamp(packsLast30 / s.packsPerMonthTarget),
      mark: 1,
      state: band(packsLast30, packsLast30 >= s.packsPerMonthTarget, packsLast30 >= 1),
    },
    {
      label: "Ads in last pack",
      value: String(adsInLastPack),
      against: `budget feeds ${spec.adsPerPack}`,
      fill: clamp(adsInLastPack / spec.adsPerPack),
      mark: 1,
      // Above the cap dilutes the signal below the per-ad floor; below it
      // wastes the budget the pack is holding.
      state:
        adsInLastPack === spec.adsPerPack
          ? "ok"
          : adsInLastPack > spec.adsPerPack
            ? "bad"
            : "warn",
    },
    {
      label: "Days to a verdict",
      value: String(spec.daysToVerdict),
      against: `no-touch ${s.noTouchDays}`,
      fill: clamp(spec.daysToVerdict / s.noTouchDays),
      mark: 1,
      state: band(
        spec.daysToVerdict,
        spec.daysToVerdict <= s.noTouchDays,
        spec.daysToVerdict <= s.noTouchDays * 1.4
      ),
    },
    {
      label: "New ads, 30d",
      value: String(adsLast30),
      against: `target ${adsTarget}`,
      fill: adsTarget > 0 ? clamp(adsLast30 / adsTarget) : 0,
      mark: 1,
      state: band(adsLast30, adsLast30 >= adsTarget, adsLast30 >= adsTarget * 0.5),
    },
    {
      label: "Hooks per body",
      value: hooksPerBody.toFixed(1),
      against: `target ${s.hooksPerBodyTarget}`,
      fill: clamp(hooksPerBody / s.hooksPerBodyTarget),
      mark: 1,
      state: band(
        hooksPerBody,
        hooksPerBody >= s.hooksPerBodyTarget * 0.7,
        hooksPerBody >= 2
      ),
    },
    {
      label: "Net-new share",
      value: `${Math.round(netNew * 100)}%`,
      against: `target ${Math.round(s.netNewShareTarget * 100)}%`,
      // Scaled against 60% so the bar has somewhere to go: this is a gauge you
      // want LOW, and a full bar meaning "bad" would read backwards.
      fill: clamp(netNew / 0.6),
      mark: s.netNewShareTarget / 0.6,
      state: band(netNew, netNew <= s.netNewShareTarget * 1.5, netNew <= 0.45),
    },
    {
      label: "Testing share of budget",
      value: `${Math.round(testShare * 100)}%`,
      against: "target 20–30%",
      fill: clamp(testShare / 0.4),
      mark: 0.75,
      state: testShare >= 0.18 && testShare <= 0.32 ? "ok" : "warn",
    },
    {
      label: "Pack daily budget",
      value: Math.round(s.minPackDaily).toLocaleString("en-US"),
      against: `floor ${Math.round(2 * s.targetCpa).toLocaleString("en-US")}`,
      fill: clamp(s.minPackDaily / (2 * s.targetCpa)),
      mark: 1,
      state: band(
        s.minPackDaily,
        s.minPackDaily >= 2 * s.targetCpa,
        s.minPackDaily >= 1.5 * s.targetCpa
      ),
    },
  ];
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
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
 * 44 300 Kč. Manami spends about 273 000 Kč a quarter. Cutting the active set
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
