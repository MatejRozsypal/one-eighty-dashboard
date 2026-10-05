/**
 * Retention statistics: pure, no imports, safe in the browser and in scripts.
 *
 * Design: 03_design.md section 1 (1.8 Wilson, 1.9 Newcombe, 1.10 Kaplan-Meier).
 *
 * Every rate on the Repeat rate page is a pooled count (k of n), never an
 * average of rates, and every one carries its 95% range:
 *
 *   wilson      the range of one rate. Behaves at small n and at 0 or 100%
 *               where the plain normal interval does not.
 *   newcombe    the range of the difference of two pooled windows (hybrid
 *               score), so a comparison is only called when the ranges agree.
 *   kaplanMeier the share converted by day since the first order, with
 *               customers who have not had the time yet counted until their
 *               last observed day instead of being dropped.
 */

/** 97.5th percentile of the standard normal. */
export const Z95 = 1.96;

/** A pooled count: `k` customers of `n`. */
export interface Rate {
  k: number;
  n: number;
}

export interface Wilson {
  /** k / n. */
  p: number;
  lo: number;
  hi: number;
}

/** Wilson score interval. Null when there is nobody (n is 0 or not a number). */
export function wilson(k: number, n: number, z: number = Z95): Wilson | null {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export type Verdict = "up" | "down" | "none";

export interface Newcombe {
  /** p1 - p2, as a fraction (0.027 is +2.7 pp). */
  diff: number;
  lo: number;
  hi: number;
  /** "up" when the range is above 0, "down" when below, else "none". */
  verdict: Verdict;
}

/**
 * Newcombe hybrid score interval for p1 - p2 (current minus previous).
 * Null when either side has nobody.
 */
export function newcombe(a: Rate, b: Rate): Newcombe | null {
  const w1 = wilson(a.k, a.n);
  const w2 = wilson(b.k, b.n);
  if (!w1 || !w2) return null;
  const diff = w1.p - w2.p;
  const lo = diff - Math.sqrt((w1.p - w1.lo) ** 2 + (w2.hi - w2.p) ** 2);
  const hi = diff + Math.sqrt((w1.hi - w1.p) ** 2 + (w2.p - w2.lo) ** 2);
  const verdict: Verdict = lo > 0 ? "up" : hi < 0 ? "down" : "none";
  return { diff, lo, hi, verdict };
}

// ---------------------------------------------------------------------------
// Display rules (1.11)
// ---------------------------------------------------------------------------

/** Below this many customers a rate is not shown. */
export const MIN_N = 30;
/** Below this many customers a rate is shown with a low-count marker. */
export const LOW_N = 100;

export type RateState = "ok" | "low" | "few";

export function rateState(n: number): RateState {
  return n < MIN_N ? "few" : n < LOW_N ? "low" : "ok";
}

// ---------------------------------------------------------------------------
// Kaplan-Meier
// ---------------------------------------------------------------------------

/** One distinct day: customers whose event fell on it and customers last observed on it. */
export interface KmInput {
  t: number;
  events: number;
  censored: number;
}

export interface KmPoint {
  t: number;
  /** Share that has had the event by day t: 1 - S(t). */
  cum: number;
  /** Greenwood band on `cum`, clipped to [0, 1]. */
  lo: number;
  hi: number;
  /** Customers still observed and without the event just before day t. */
  atRisk: number;
}

export interface KmCurve {
  /** Everyone in the group, including those beyond the display cap. */
  total: number;
  /** Step points, starting at day 0. The last point repeats the last value at `endT`. */
  points: KmPoint[];
  /** Last day drawn: the curve stops where fewer than `minAtRisk` customers remain. Null when it never starts. */
  endT: number | null;
  /** Events counted at or before `endT`. */
  events: number;
  /** At-risk bookkeeping for every distinct day up to `endT`, for `kmAt`. */
  steps: Array<{ t: number; atRisk: number; left: number }>;
}

export interface KmOptions {
  /** Stop the curve where fewer than this many are at risk. Default 30. */
  minAtRisk?: number;
  /** Last day shown. Default 365. */
  maxT?: number;
  z?: number;
}

/**
 * Kaplan-Meier cumulative incidence with a Greenwood band.
 *
 * `rows` may hold the same day twice (several entry classes pooled); they are
 * summed. An event on day t is counted before a censoring on day t. Rows with
 * t above `maxT` are not drawn but still count as customers (they stay at risk
 * through the whole display range).
 */
export function kaplanMeier(rows: readonly KmInput[], options: KmOptions = {}): KmCurve {
  const minAtRisk = options.minAtRisk ?? 30;
  const maxT = options.maxT ?? 365;
  const z = options.z ?? Z95;

  const byT = new Map<number, { events: number; censored: number }>();
  let total = 0;
  for (const r of rows) {
    if (!(r.events > 0 || r.censored > 0)) continue;
    const cur = byT.get(r.t) ?? { events: 0, censored: 0 };
    cur.events += r.events;
    cur.censored += r.censored;
    byT.set(r.t, cur);
    total += r.events + r.censored;
  }
  if (total < minAtRisk || total === 0) return { total, points: [], endT: null, events: 0, steps: [] };

  const times = [...byT.keys()].sort((a, b) => a - b);
  const points: KmPoint[] = [{ t: 0, cum: 0, lo: 0, hi: 0, atRisk: total }];
  let survival = 1;
  let greenwood = 0;
  let removed = 0; // customers with an event or a censoring on an earlier day
  let events = 0;
  let endT = maxT;
  let atRiskAtEnd = total;
  const steps: KmCurve["steps"] = [];

  for (const t of times) {
    if (t > maxT) {
      // Beyond the display range: they stay at risk through all of it.
      atRiskAtEnd = total - removed;
      break;
    }
    const { events: d, censored: c } = byT.get(t)!;
    const atRisk = total - removed;
    if (d > 0) {
      survival *= 1 - d / atRisk;
      greenwood += atRisk === d ? Infinity : d / (atRisk * (atRisk - d));
      events += d;
      const half = Number.isFinite(greenwood) ? z * survival * Math.sqrt(greenwood) : Infinity;
      points.push({
        t,
        cum: 1 - survival,
        lo: Number.isFinite(half) ? Math.max(0, 1 - (survival + half)) : 0,
        hi: Number.isFinite(half) ? Math.min(1, 1 - (survival - half)) : 1,
        atRisk,
      });
    }
    removed += d + c;
    steps.push({ t, atRisk, left: total - removed });
    atRiskAtEnd = atRisk;
    // Fewer than the floor remain after today: today is the last day drawn.
    if (total - removed < minAtRisk) {
      endT = t;
      break;
    }
  }

  const last = points[points.length - 1];
  if (endT > last.t) points.push({ ...last, t: endT, atRisk: atRiskAtEnd });
  return { total, points, endT, events, steps };
}

export interface KmReading {
  t: number;
  cum: number;
  lo: number;
  hi: number;
  /** Customers still observed and without the event on day t. */
  atRisk: number;
}

/** Curve value at day t: the last step at or before t. Null before day 0 or after the curve ends. */
export function kmAt(curve: KmCurve, t: number): KmReading | null {
  if (curve.endT === null || t < 0 || t > curve.endT) return null;
  let hit: KmPoint = curve.points[0];
  for (const p of curve.points) {
    if (p.t <= t) hit = p;
    else break;
  }
  let atRisk = curve.total;
  for (const s of curve.steps) {
    if (s.t === t) {
      atRisk = s.atRisk;
      break;
    }
    if (s.t > t) break;
    atRisk = s.left;
  }
  return { t, cum: hit.cum, lo: hit.lo, hi: hit.hi, atRisk };
}
