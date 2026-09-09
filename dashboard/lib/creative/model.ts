/**
 * Shapes and aggregation for the Creative Engine.
 *
 * Pure — no database client, no React. The demo generator and the BigQuery
 * reader both produce `AdRow[]` and everything downstream works the same way,
 * which is what lets the screens be verified without a warehouse.
 *
 * ── The one rule this file exists to enforce ────────────────────────────────
 * Only SUMMABLE COMPONENTS are carried across an aggregation, and every rate is
 * recomputed afterwards from the summed parts (METRICS.md). Averaging stored
 * per-day ROAS across an ad's daily rows would weight a 40 Kč day the same as a
 * 4 000 Kč day; averaging it across a persona's ads would weight a 3-purchase
 * ad the same as a 195-purchase one. Both produce a number that looks like
 * ROAS, moves like ROAS, and is not ROAS.
 */

import { confidenceOf, interval, shrink, type Confidence, type CreativeThresholds } from "@/lib/creative/stats";

// ---------------------------------------------------------------------------
// Components — the only things allowed to cross a join or a GROUP BY
// ---------------------------------------------------------------------------

export interface Components {
  spend: number;
  revenue: number;
  purchases: number;
  impressions: number;
  clicks: number;
  reach: number;
  addToCart: number;
  initiateCheckout: number;
  landingPageViews: number;
  linkClicks: number;
  outboundClicks: number;
  uniqueOutboundClicks: number;
  videoViews: number;
  /** 3s+ plays. The hook-rate numerator. */
  videoPlays: number;
  /** 15s ThruPlays. The hold-rate numerator. */
  videoThruplays: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP95: number;
  videoP100: number;
  video30s: number;
}

export const ZERO: Components = {
  spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, reach: 0,
  addToCart: 0, initiateCheckout: 0, landingPageViews: 0, linkClicks: 0,
  outboundClicks: 0, uniqueOutboundClicks: 0, videoViews: 0, videoPlays: 0,
  videoThruplays: 0, videoP25: 0, videoP50: 0, videoP75: 0, videoP95: 0,
  videoP100: 0, video30s: 0,
};

const KEYS = Object.keys(ZERO) as (keyof Components)[];

export function add(a: Components, b: Components): Components {
  const out = {} as Components;
  for (const k of KEYS) out[k] = a[k] + b[k];
  return out;
}

export function sum(rows: Array<{ components: Components }>): Components {
  return rows.reduce((acc, r) => add(acc, r.components), { ...ZERO });
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * What ClickUp says this ad is.
 *
 * Every field is nullable, and that is the normal case rather than an edge one:
 * on Manami today 34% of spend sits on a single untagged creative that predates
 * the Persona Bank. The UI renders a missing tag as a dashed "persona ?" chip
 * rather than hiding the ad, because an ad taking a third of the budget is the
 * most important row on the screen whether or not anybody filed it.
 */
export interface Tags {
  clickupTaskId: string | null;
  clickupUrl: string | null;
  conceptId: string | null;
  conceptName: string | null;
  personaId: string | null;
  personaName: string | null;
  angle: string | null;
  offer: string | null;
  stage: string | null;
  /** ClickUp `Content Purpose`: Net-new | Offer-Promo | Winner Variant. */
  productionType: string | null;
  format: string | null;
  bodyCode: string | null;
  hookCode: string | null;
  productionMethod: string | null;
  creatorId: string | null;
  creatorName: string | null;
  creatorType: string | null;
  productionCost: number | null;
  productionCostSource: string | null;
  briefUrl: string | null;
  market: string | null;
  launchedAt: string | null;
  matchMethod: string | null;
  matchConfidence: number | null;
}

export const NO_TAGS: Tags = {
  clickupTaskId: null, clickupUrl: null, conceptId: null, conceptName: null,
  personaId: null, personaName: null, angle: null, offer: null, stage: null,
  productionType: null, format: null, bodyCode: null, hookCode: null, productionMethod: null,
  creatorId: null, creatorName: null, creatorType: null, productionCost: null,
  productionCostSource: null, briefUrl: null, market: null, launchedAt: null,
  matchMethod: null, matchConfidence: null,
};

/** One ad, already aggregated over whatever window the page asked for. */
export interface AdRow {
  adId: string;
  adName: string;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  tags: Tags;
  components: Components;
  /** Spend by calendar month, oldest first. Feeds the share-over-time chart. */
  monthlySpend: MonthlySpend[];
}

export interface MonthlySpend {
  /** `YYYY-MM`. */
  month: string;
  spend: number;
}

/** One ad set, for the level at which money verdicts are actually taken. */
export interface AdsetRow {
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  campaignName: string | null;
  components: Components;
  firstDate: string | null;
  lastDate: string | null;
  /** Days since the ad set first delivered. Drives the no-touch gate. */
  ageDays: number | null;
  /** Meta-reported frequency on the most recent day. Never summed. */
  frequencyLatest: number | null;
}

// ---------------------------------------------------------------------------
// Derived metrics — computed AFTER aggregation, never carried through one
// ---------------------------------------------------------------------------

function div(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export interface Derived {
  roasRaw: number | null;
  cpa: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** video_play_actions / impressions. Only meaningful for video. */
  hookRate: number | null;
  /** video_thruplays / impressions. */
  holdRate: number | null;
  outboundCtr: number | null;
  atcRate: number | null;
}

export function derive(c: Components): Derived {
  return {
    roasRaw: div(c.revenue, c.spend),
    cpa: div(c.spend, c.purchases),
    ctr: div(c.clicks, c.impressions),
    cpc: div(c.spend, c.clicks),
    cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null,
    hookRate: div(c.videoPlays, c.impressions),
    holdRate: div(c.videoThruplays, c.impressions),
    outboundCtr: div(c.outboundClicks, c.impressions),
    atcRate: div(c.addToCart, c.clicks),
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface Group {
  key: string;
  label: string;
  /** True when this group is the catch-all for rows carrying no such tag. */
  untagged: boolean;
  ads: AdRow[];
  components: Components;
}

export const UNTAGGED = "— untagged —";

/**
 * Group ads by a tag, keeping untagged spend as its own visible row.
 *
 * Dropping the untagged rows would be the single easiest way to make this
 * product lie: it would silently rebase every share-of-spend percentage on a
 * denominator that excludes a third of the account, and every figure would
 * still look completely reasonable.
 */
export function groupBy(
  ads: AdRow[],
  keyOf: (ad: AdRow) => string | null,
  labelOf: (ad: AdRow, key: string) => string = (_a, k) => k
): Group[] {
  const groups = new Map<string, Group>();

  for (const ad of ads) {
    const raw = keyOf(ad);
    const key = raw ?? UNTAGGED;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label: raw === null ? UNTAGGED : labelOf(ad, key),
        untagged: raw === null,
        ads: [],
        components: { ...ZERO },
      };
      groups.set(key, g);
    }
    g.ads.push(ad);
    g.components = add(g.components, ad.components);
  }

  // Sorted by spend, everywhere, always. Nothing in this product sorts by ROAS:
  // spend share is what the algorithm decided, and ROAS is a noisy estimate of
  // what happened next. Under CBO roughly 4% of ads end up holding 64% of both.
  return [...groups.values()].sort((a, b) => b.components.spend - a.components.spend);
}

// ---------------------------------------------------------------------------
// The reported figure for a row
// ---------------------------------------------------------------------------

export interface Reading {
  /** Empirical-Bayes posterior. The number that sorts and colours. */
  roas: number | null;
  /** The raw ratio, shown beside it so the shrinkage is never hidden. */
  roasRaw: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  confidence: Confidence;
  purchases: number;
  spend: number;
  spendShare: number;
}

export function read(
  c: Components,
  accountMeanRoas: number,
  accountSpend: number,
  t: CreativeThresholds
): Reading {
  const raw = div(c.revenue, c.spend);

  // ── Zero purchases reports nothing, not the prior ─────────────────────────
  // Shrinkage with n = 0 returns the account mean exactly: (0*obs + k*mean)/k.
  // That is arithmetically right and a lie to look at. A wall of ads that never
  // sold anything rendered thirty tiles all reading the same ROAS 2.12, which
  // is not an estimate of any of them — it is the prior, wearing their names.
  //
  // With no conversions there is no evidence to shrink, so the honest output is
  // no number. The tile still shows the spend, the CTR and "0 purchases", which
  // is the whole of what is known.
  const roas =
    raw === null || c.purchases <= 0
      ? null
      : shrink(raw, c.purchases, accountMeanRoas, t.readPurchases);
  const [lo, hi] = roas === null ? [null, null] : interval(roas, c.purchases);
  return {
    roas,
    roasRaw: raw,
    ciLow: lo,
    ciHigh: hi,
    confidence: confidenceOf(c.purchases, t),
    purchases: c.purchases,
    spend: c.spend,
    spendShare: accountSpend > 0 ? c.spend / accountSpend : 0,
  };
}

// ---------------------------------------------------------------------------
// Winner economics
// ---------------------------------------------------------------------------

/**
 * The four buckets on the Creatives scorecard.
 *
 * `winner` requires Read confidence, not just a high number. That is the whole
 * point: Manami's measured net-new hit rate is 1.5% — one winner from 67 ads,
 * against Nathan's ~5% reference — and that single figure is the argument for
 * the 80/20 production split, for hook variants over new bodies, and for
 * cutting the active persona set. It only means anything if "winner" is a
 * defensible category rather than whatever happened to sort first.
 */
export type Outcome = "winner" | "carrier" | "loser" | "open";

export function classify(
  c: Components,
  accountMeanRoas: number,
  t: CreativeThresholds
): Outcome {
  const raw = div(c.revenue, c.spend);
  if (raw === null) return "open";
  const roas = shrink(raw, c.purchases, accountMeanRoas, t.readPurchases);

  if (c.purchases >= t.readPurchases && roas >= t.targetRoas) return "winner";
  if (c.purchases >= t.readPurchases && roas >= t.killRoas) return "carrier";
  // A loser has to have been given a fair run: past the 3x CPA kill gate, and
  // with enough purchases to be more than an unlucky week.
  if (
    c.purchases >= t.directionalPurchases &&
    roas < t.killRoas &&
    c.spend >= t.killGateX * t.targetCpa
  ) {
    return "loser";
  }
  return "open";
}

export interface WinnerEconomics {
  winners: number;
  carriers: number;
  losers: number;
  open: number;
  decided: number;
  /** winners / ads launched. Nathan's reference is about 5%. */
  hitRate: number | null;
}

export function winnerEconomics(
  ads: AdRow[],
  accountMeanRoas: number,
  t: CreativeThresholds
): WinnerEconomics {
  const counts: Record<Outcome, number> = { winner: 0, carrier: 0, loser: 0, open: 0 };
  for (const ad of ads) counts[classify(ad.components, accountMeanRoas, t)] += 1;
  return {
    winners: counts.winner,
    carriers: counts.carrier,
    losers: counts.loser,
    open: counts.open,
    decided: counts.winner + counts.carrier + counts.loser,
    hitRate: ads.length > 0 ? counts.winner / ads.length : null,
  };
}

// ---------------------------------------------------------------------------
// Account context
// ---------------------------------------------------------------------------

/**
 * The account-level figures every row is judged against.
 *
 * `meanRoas` is the shrinkage target, and it is computed from the SUM of
 * revenue over the SUM of spend — not the mean of per-ad ROAS, which would let
 * a 300 Kč freak at 17x drag the anchor that every other row is pulled toward.
 * The learnings file has that exact ad in it.
 */
export interface AccountContext {
  spend: number;
  revenue: number;
  purchases: number;
  meanRoas: number;
  cpa: number | null;
  ads: number;
}

export function accountContext(ads: AdRow[], fallbackRoas: number): AccountContext {
  const c = sum(ads);
  return {
    spend: c.spend,
    revenue: c.revenue,
    purchases: c.purchases,
    meanRoas: c.spend > 0 ? c.revenue / c.spend : fallbackRoas,
    cpa: div(c.spend, c.purchases),
    ads: ads.length,
  };
}
