/**
 * Creative hit rate: winners as a share of the ads launched in a period.
 *
 * Pure. No database client, no React, no server-only import, so the fixtures in
 * `scripts/check-creative-hitrate.ts` can run it as it stands and so the Reports
 * package can reuse it later.
 *
 * ── The definitions (docs: 40_hit_rate_design.md, section 2.2) ──────────────
 *   launched  = ads whose first delivery falls in the period, not pre-existing
 *               when the client's Meta history starts, and not a relaunch of an
 *               asset that already ran
 *   winner    = `classify()` over the ad's LIFETIME totals, judged against the
 *               client's trailing-year ROAS stored on the row: purchases >=
 *               readPurchases, shrunk ROAS >= target, and at least
 *               `WINNER_MIN_AGE_DAYS` since first delivery. The scorecard, the
 *               grid, Concepts, Production, Paid and Reports call the same
 *               `classify()` with the same anchor and the same age rule.
 *   open      = not a winner and younger than 60 days. It may still qualify
 *   hit rate  = winners / launched, pooled (sum over sum) for any rollup
 *   reference = the client's OWN hit rate over its trailing 365 days of
 *               launches ("Your 12-mo rate"). There is no fixed benchmark.
 *
 * The anchor for shrinkage is the stored 12-month ROAS, not the mean of the
 * selected range, so the figure does not move when the date range changes.
 *
 * Needs a target ROAS and a read threshold only, never a Target CPA (C4).
 *
 * Thresholds are read from the existing creative settings and applied here, in
 * TypeScript. They never reach SQL.
 */

import { WINNER_MIN_AGE_DAYS, ZERO, classify } from "@/lib/creative/model";
import type { CreativeThresholds } from "@/lib/creative/stats";
import type { DateRange } from "@/lib/period";

/** Days an ad needs before "not a winner" means "not a winner yet" no longer applies. */
export const HIT_RATE_MATURITY_DAYS = 60;

/** What the reference line is called. Its value is the client's own trailing-year hit rate. */
export const HIT_RATE_REFERENCE_LABEL = "Your 12-mo rate";

/** Days of launches the reference rate pools, ending at the table's `through` day. */
export const HIT_RATE_REFERENCE_DAYS = 365;

/** Launch months shown by the trend. */
export const HIT_RATE_MONTHS = 12;

/** Share of launches in range that must carry a concept before the concept split is shown. */
export const CONCEPT_SPLIT_MIN_TAGGED = 0.5;

/** One ad, lifetime to date, as `mart.rpt_ad_launch` holds it. */
export interface LaunchRow {
  adId: string;
  adName: string;
  /** First day with impressions, `YYYY-MM-DD`. */
  firstDate: string;
  /** Days from first delivery to the latest loaded day. */
  ageDays: number;
  spend: number;
  revenue: number;
  purchases: number;
  isVideo: boolean;
  isRelaunch: boolean;
  /** Already delivering on the first day of the client's Meta history, so its true launch is unknown. */
  isPreexisting: boolean;
  conceptId: string | null;
  conceptName: string | null;
  /** The client's trailing 365-day Meta ROAS. Null when there was no spend to compute it from. */
  priorRoas: number | null;
  // Launch context (`mart.rpt_ad_launch` from the ME1 release). Absent
  // (undefined) when the table does not have the columns yet, which reads as
  // "not ready", never as a split. Null means the column exists and the value
  // is unknown for this ad.
  adsetId?: string | null;
  /** First delivery of the ad's ad set. */
  adsetFirstDate?: string | null;
  /** The ad's first delivery is within 2 days of its ad set's first delivery. */
  isNewAdset?: boolean | null;
}

export type FormatFilter = "all" | "video" | "static";

export const FORMAT_FILTERS: FormatFilter[] = ["all", "video", "static"];

export type LaunchStatus = "winner" | "open" | "settled";

/**
 * Winner, open, or settled (not a winner and old enough that waiting will not
 * change that). An ad without a prior cannot be judged, so it is never a winner.
 * An ad under `WINNER_MIN_AGE_DAYS` old is never a winner either, however well
 * it reads: `classify` returns `open` for it.
 */
export function launchStatus(row: LaunchRow, t: CreativeThresholds): LaunchStatus {
  if (row.priorRoas !== null) {
    const outcome = classify(
      { ...ZERO, spend: row.spend, revenue: row.revenue, purchases: row.purchases },
      row.priorRoas,
      t,
      row.ageDays
    );
    if (outcome === "winner") return "winner";
  }
  return row.ageDays < HIT_RATE_MATURITY_DAYS ? "open" : "settled";
}

/** Launches that count: relaunches and pre-existing ads leave both numerator and denominator. */
export function eligible(rows: LaunchRow[], format: FormatFilter = "all"): LaunchRow[] {
  return rows.filter(
    (r) =>
      !r.isRelaunch &&
      !r.isPreexisting &&
      (format === "all" || (format === "video" ? r.isVideo : !r.isVideo))
  );
}

export function inRange(rows: LaunchRow[], range: DateRange): LaunchRow[] {
  return rows.filter((r) => r.firstDate >= range.from && r.firstDate <= range.to);
}

export interface HitRate {
  launched: number;
  /** Null when no thresholds are set: a "0 winners" would be a claim, and a false one. */
  winners: number | null;
  open: number | null;
  /** Null without thresholds or without launches. */
  rate: number | null;
  /** True when any launch is still open: the rate is a lower bound. */
  maturing: boolean;
}

/** Hit rate of the rows given. Callers filter by range and format first. */
export function hitRate(rows: LaunchRow[], t: CreativeThresholds | null): HitRate {
  const launches = eligible(rows);
  if (t === null) {
    return { launched: launches.length, winners: null, open: null, rate: null, maturing: false };
  }
  let winners = 0;
  let open = 0;
  for (const r of launches) {
    const s = launchStatus(r, t);
    if (s === "winner") winners += 1;
    else if (s === "open") open += 1;
  }
  return {
    launched: launches.length,
    winners,
    open,
    rate: launches.length > 0 ? winners / launches.length : null,
    maturing: open > 0,
  };
}

// ---------------------------------------------------------------------------
// Reference: the client's own trailing 12 months
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` minus `days` days, in UTC. */
function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** First day of the reference window: the 365 days ending at `through`. */
export function referenceStart(through: string): string {
  return minusDays(through, HIT_RATE_REFERENCE_DAYS - 1);
}

/**
 * The client's own hit rate over its trailing 365 days of launches, the
 * reference the tile and the trend compare against (D6). Pooled the same way
 * as every other hit rate. Null without thresholds or without launches: no
 * line is drawn rather than a made-up one.
 */
export function referenceRate(
  rows: LaunchRow[],
  t: CreativeThresholds | null,
  through: string
): number | null {
  if (t === null) return null;
  const from = referenceStart(through);
  return hitRate(rows.filter((r) => r.firstDate >= from && r.firstDate <= through), t).rate;
}

/**
 * True when the change against the comparison period must not be shown: the
 * current cohort still has open launches and the comparison has none, so the
 * older cohort simply had more time to win. Reports withholds on the same
 * condition.
 */
export function deltaWithheld(current: HitRate, comparison: HitRate): boolean {
  return (current.open ?? 0) > 0 && (comparison.open ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// Launch context: new ad set vs added to an existing one, and packs
// ---------------------------------------------------------------------------

export interface LaunchContext {
  /** False until the launch table carries the ad set columns (or when nothing launched). */
  ready: boolean;
  /** Ads whose first delivery came within 2 days of their ad set's first delivery. */
  newAdset: HitRate;
  /** Ads added to an ad set that was already delivering. */
  existing: HitRate;
  /** Launches whose ad set could not be told. In neither group. */
  unknown: number;
  /** Launches in the rows, whatever their context. */
  launches: number;
}

/** Hit rate by launch context. Callers filter by range first. */
export function launchContext(rows: LaunchRow[], t: CreativeThresholds | null): LaunchContext {
  const launches = eligible(rows);
  const ready = launches.length > 0 && launches.every((r) => r.isNewAdset !== undefined);
  return {
    ready,
    newAdset: hitRate(launches.filter((r) => r.isNewAdset === true), t),
    existing: hitRate(launches.filter((r) => r.isNewAdset === false), t),
    unknown: launches.filter((r) => r.isNewAdset === null).length,
    launches: launches.length,
  };
}

export interface PackHitRate extends HitRate {
  /** False until the launch table carries the ad set columns (or when nothing launched). */
  ready: boolean;
}

/**
 * Pack-level hit rate, the SOP's own unit: ad sets that first delivered in the
 * range, and how many of them hold at least one winner among their launched
 * ads. `launched` here counts ad sets, not ads. A pack with no winner yet and
 * an ad under 60 days old is open. Callers pass the launches in range.
 */
export function packHitRate(rows: LaunchRow[], t: CreativeThresholds | null, range: DateRange): PackHitRate {
  const launches = eligible(rows);
  const ready =
    launches.length > 0 && launches.every((r) => r.adsetId !== undefined && r.adsetFirstDate !== undefined);
  const packs = new Map<string, { winner: boolean; open: boolean }>();
  for (const r of launches) {
    if (!r.adsetId || !r.adsetFirstDate) continue;
    if (r.adsetFirstDate < range.from || r.adsetFirstDate > range.to) continue;
    const pack = packs.get(r.adsetId) ?? { winner: false, open: false };
    if (t !== null) {
      const status = launchStatus(r, t);
      if (status === "winner") pack.winner = true;
      else if (status === "open") pack.open = true;
    }
    packs.set(r.adsetId, pack);
  }
  const n = packs.size;
  if (t === null) {
    return { ready, launched: n, winners: null, open: null, rate: null, maturing: false };
  }
  let winners = 0;
  let open = 0;
  for (const p of packs.values()) {
    if (p.winner) winners += 1;
    else if (p.open) open += 1;
  }
  return { ready, launched: n, winners, open, rate: n > 0 ? winners / n : null, maturing: open > 0 };
}

// ---------------------------------------------------------------------------
// Trend by launch month
// ---------------------------------------------------------------------------

export interface LaunchMonth extends HitRate {
  /** `YYYY-MM`. */
  month: string;
  /** "Oct", or "Jan 26" on a January and on the first bar. */
  label: string;
  /** The month overlaps the page's date range. */
  inRange: boolean;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The `count` months ending at the month of `through`, oldest first, as `YYYY-MM`. */
export function trailingMonths(through: string, count: number = HIT_RATE_MONTHS): string[] {
  const y = Number(through.slice(0, 4));
  const m = Number(through.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const idx = y * 12 + m - i;
    const yy = Math.floor(idx / 12);
    const mm = idx % 12;
    out.push(`${yy}-${String(mm + 1).padStart(2, "0")}`);
  }
  return out;
}

/** First day of the oldest month the trend shows. */
export function trendStart(through: string, count: number = HIT_RATE_MONTHS): string {
  return `${trailingMonths(through, count)[0]}-01`;
}

export function launchMonths(
  rows: LaunchRow[],
  t: CreativeThresholds | null,
  through: string,
  range: DateRange,
  format: FormatFilter = "all",
  count: number = HIT_RATE_MONTHS
): LaunchMonth[] {
  const pool = eligible(rows, format);
  return trailingMonths(through, count).map((month, i) => {
    const mine = pool.filter((r) => r.firstDate.slice(0, 7) === month);
    const r = hitRate(mine, t);
    const mm = Number(month.slice(5, 7)) - 1;
    const label = mm === 0 || i === 0 ? `${MONTH_NAMES[mm]} ${month.slice(2, 4)}` : MONTH_NAMES[mm];
    return {
      ...r,
      month,
      label,
      inRange: range.from.slice(0, 7) <= month && month <= range.to.slice(0, 7),
    };
  });
}

// ---------------------------------------------------------------------------
// Concept split
// ---------------------------------------------------------------------------

export interface ConceptSplitRow extends HitRate {
  key: string;
  label: string;
  untagged: boolean;
}

/**
 * Hit rate by concept for launches in range, or null when fewer than half of
 * them carry a concept. A split that mostly says "Untagged" is not a split, and
 * showing it would be decoration. Today that hides it for every client.
 */
export function conceptSplit(
  rows: LaunchRow[],
  t: CreativeThresholds | null
): { taggedShare: number; rows: ConceptSplitRow[] } | null {
  const launches = eligible(rows);
  if (launches.length === 0) return null;
  const tagged = launches.filter((r) => r.conceptId !== null);
  const taggedShare = tagged.length / launches.length;
  if (taggedShare < CONCEPT_SPLIT_MIN_TAGGED) return null;

  const groups = new Map<string, { label: string; rows: LaunchRow[] }>();
  for (const r of launches) {
    const key = r.conceptId ?? "";
    const g = groups.get(key) ?? { label: r.conceptName ?? r.conceptId ?? "Untagged", rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const out = [...groups.entries()].map(([key, g]) => ({
    ...hitRate(g.rows, t),
    key: key || "untagged",
    label: key === "" ? "Untagged" : g.label,
    untagged: key === "",
  }));
  // Tagged concepts by launches, the untagged catch-all last.
  out.sort((a, b) => Number(a.untagged) - Number(b.untagged) || b.launched - a.launched);
  return { taggedShare, rows: out };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "15+ purchases, ROAS 2.25+" from the client's own settings. */
export function winnerBar(t: CreativeThresholds): string {
  return `${t.readPurchases}+ purchases, ROAS ${t.targetRoas.toFixed(2)}+`;
}

/** Whole-number-of-tenths percent: "7.4%". Null reads as the caller's NO_VALUE. */
export function formatRate(rate: number | null): string | null {
  return rate === null ? null : `${(rate * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// The tile, said once for both places that show it
// ---------------------------------------------------------------------------

export interface TileText {
  /** Null reads as n/a. */
  value: string | null;
  sub: string;
  /** At most 40 words. */
  info: string;
}

/**
 * Value, sub line and tooltip for the Creative "Hit rate" tile and the Paid
 * tile. Both call this, so for the same range they say the same thing.
 *
 * `result` is null when the launch table is not ready: n/a and one line, never
 * a zero. `reference` is the client's own trailing 12-month rate, or null.
 */
export function tileText(
  result: HitRate | null,
  t: CreativeThresholds | null,
  reference: number | null = null
): TileText {
  if (result === null) {
    return { value: null, sub: "Not ready", info: "Launch data is not ready." };
  }
  if (t === null) {
    return { value: null, sub: `${result.launched} launched`, info: "Set a target ROAS in Settings." };
  }
  if (result.launched === 0) {
    return { value: null, sub: "0 launched", info: tileInfo(t, reference) };
  }
  const open = result.open !== null && result.open > 0 ? ` · ${result.open} open` : "";
  return {
    value: formatRate(result.rate),
    sub: `${result.winners ?? 0} of ${result.launched} launched${open}`,
    info: tileInfo(t, reference),
  };
}

function tileInfo(t: CreativeThresholds, reference: number | null): string {
  const ref = reference === null ? "" : ` ${HIT_RATE_REFERENCE_LABEL}: ${formatRate(reference)}.`;
  return `Winners among ads first delivered in this period, relaunches excluded. Winner: ${winnerBar(t)} after shrinkage, ${WINNER_MIN_AGE_DAYS}+ days old.${ref}`;
}

// ---------------------------------------------------------------------------
// When the launch table was last built
// ---------------------------------------------------------------------------

/**
 * "Updated 10:10" for a table built today, "Updated 4 Oct 10:10" for an older
 * one, in Prague time. Null when the table has no timestamp. The hit rate is a
 * snapshot, so a stale one must be visible as stale (audit change C6).
 */
export function updatedLabel(refreshedAt: string | null, now: Date = new Date()): string | null {
  if (!refreshedAt) return null;
  const at = new Date(refreshedAt);
  if (Number.isNaN(at.getTime())) return null;
  const tz = "Europe/Prague";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  if (day(at) === day(now)) return `Updated ${time}`;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(at);
  return `Updated ${date} ${time}`;
}
