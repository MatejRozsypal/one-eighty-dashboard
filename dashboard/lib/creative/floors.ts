/**
 * Relative hook and hold floors (audit change C5, decision D4).
 *
 * Pure. No database client, no React, so `scripts/check-creative-hitrate.ts`
 * runs it as it stands.
 *
 * ── Why relative ───────────────────────────────────────────────────────────
 * A fixed 20 % hook floor and 5 % hold floor were written for a different
 * definition and flag the wrong ads: the hold floor alone flagged up to half
 * of a client's genuine videos. The floor is now where the client's own video
 * ads sit: the 25th percentile of hook rate and of hold rate over the genuine
 * video ads of the trailing 180 days. With fewer than `FLOOR_MIN_ADS` such ads
 * the percentile is not worth trusting and the stored Settings floors (default
 * 20 % and 5 %) apply.
 *
 * ── Genuine video ──────────────────────────────────────────────────────────
 * An ad whose video starts are at least `GENUINE_VIDEO_START_SHARE` of its
 * impressions, with at least `FLOOR_MIN_IMPRESSIONS` impressions. This is the
 * same 30 % that decides `is_video` in `mart.rpt_ad_launch`. It keeps banners
 * with incidental video starts (a few percent of impressions) out of the
 * percentile: their hook rate is not a hook.
 *
 * Hook and hold stay DIAGNOSTIC. Hook rate does not separate winners from
 * non-winners at any client (correlation with ROAS is zero or negative), so a
 * floor never decides a money verdict.
 */

/** Video starts over impressions at which an ad counts as a genuine video ad. */
export const GENUINE_VIDEO_START_SHARE = 0.3;

/** Impressions an ad needs in the window before its rates count. Matches `diagnose`. */
export const FLOOR_MIN_IMPRESSIONS = 5000;

/** Genuine video ads needed before the percentile replaces the stored floors. */
export const FLOOR_MIN_ADS = 15;

/** Days of delivery the percentile looks at, ending at the client's latest loaded day. */
export const FLOOR_WINDOW_DAYS = 180;

/** The percentile the floor sits at. */
export const FLOOR_PERCENTILE = 0.25;

/** One ad's totals over the window. */
export interface VideoAdRates {
  impressions: number;
  /** 3-second plays (`video_views`). */
  plays: number;
  /** ThruPlays. */
  thruplays: number;
  /** Video starts (`video_play_actions`). */
  starts: number;
}

export interface VideoFloors {
  hookRateFloor: number;
  holdRateFloor: number;
  basis: "relative" | "fallback";
  /** Genuine video ads the percentile was taken over. */
  ads: number;
}

/** Linear-interpolation percentile of an ascending list (SQL PERCENTILE_CONT). Null for an empty list. */
export function percentile(sortedAsc: number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** True when the ad is a genuine video ad in the window. */
export function isGenuineVideo(a: VideoAdRates): boolean {
  return a.impressions >= FLOOR_MIN_IMPRESSIONS && a.starts / a.impressions >= GENUINE_VIDEO_START_SHARE;
}

/**
 * The client's floors: p25 of hook and of hold over genuine video ads, or the
 * stored fallback when there are fewer than `FLOOR_MIN_ADS`.
 */
export function relativeFloors(
  ads: VideoAdRates[],
  fallback: { hookRateFloor: number; holdRateFloor: number }
): VideoFloors {
  const genuine = ads.filter(isGenuineVideo);
  if (genuine.length < FLOOR_MIN_ADS) {
    return { ...fallback, basis: "fallback", ads: genuine.length };
  }
  const hooks = genuine.map((a) => a.plays / a.impressions).sort((x, y) => x - y);
  const holds = genuine.map((a) => a.thruplays / a.impressions).sort((x, y) => x - y);
  return {
    hookRateFloor: percentile(hooks, FLOOR_PERCENTILE) ?? fallback.hookRateFloor,
    holdRateFloor: percentile(holds, FLOOR_PERCENTILE) ?? fallback.holdRateFloor,
    basis: "relative",
    ads: genuine.length,
  };
}

/** Thresholds with the floors replaced. Everything else is untouched. */
export function withFloors<T extends { hookRateFloor: number; holdRateFloor: number; floorBasis?: "relative" | "fallback" }>(
  t: T,
  floors: VideoFloors | null
): T {
  if (floors === null) return t;
  return {
    ...t,
    hookRateFloor: floors.hookRateFloor,
    holdRateFloor: floors.holdRateFloor,
    floorBasis: floors.basis,
  };
}
