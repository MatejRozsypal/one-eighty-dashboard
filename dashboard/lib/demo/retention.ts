/**
 * Demo client data for the Repeat rate page.
 *
 * Customers, not totals: every customer gets a first order, an entry class and
 * the days of their later orders from a hash of their own key, and the cohort
 * rows and curve rows are then aggregated exactly as the warehouse does it
 * (the same definitions as the cohort view and the curve query). So the tiles,
 * the table, the trend and the curve cannot disagree, and every state the page
 * has appears without being drawn by hand:
 *
 *   early months        the first months after the data start (guard 180 days)
 *   a mixed month       customers on both sides of the guard
 *   small entry classes gift set and mixed entry fall below 30 and 100
 *   immature months     the last months of the data
 *   a cut-off with lag  customers after the cut-off are counted as entrants only
 *
 * Deterministic: a customer is a pure function of its key (see `random.ts`).
 * `today` defaults to the real date, so the figures stay current; the check
 * script pins it.
 */

import { between, intBetween, unit } from "./random";
import {
  HORIZONS,
  addDays,
  addMonths,
  daysBetween,
  monthStart,
  type ByHorizon,
  type CohortRow,
  type Horizon,
  type KmRow,
  type RetentionData,
} from "@/lib/retention/model";

/** Days the warehouse waits for late orders before it counts a day as complete. */
const SYNC_LAG = 3;
const GUARD_DAYS = 180;
const MONTHS_OF_DATA = 27;

const CLASS_MIX: Array<{ entry: string; share: number; repeat365: number; upgrade: number }> = [
  { entry: "discovery", share: 0.54, repeat365: 0.17, upgrade: 0.72 },
  { entry: "full", share: 0.2, repeat365: 0.2, upgrade: 0.9 },
  { entry: "sample", share: 0.09, repeat365: 0.21, upgrade: 0.78 },
  { entry: "other", share: 0.07, repeat365: 0.15, upgrade: 0.5 },
  { entry: "mixed", share: 0.06, repeat365: 0.24, upgrade: 0.85 },
  { entry: "gift", share: 0.04, repeat365: 0.12, upgrade: 0.6 },
];

export interface DemoCustomer {
  month: string;
  first: string;
  entry: string | null;
  early: boolean;
  /** Days from the first order to the second, if that order exists in the data (up to as-of). */
  to2nd: number | null;
  toFull: number | null;
  /** Days from the second order to the third. */
  to3rd: number | null;
  /** Days from the first order to the cut-off. */
  observed: number;
}

export interface DemoOptions {
  /** ISO date standing in for today. Default: the real date. */
  today?: string;
  /** False builds a client without product classes. */
  classes?: boolean;
}

function exponential(key: string, mean: number): number {
  return -Math.log(1 - unit(key) * 0.999999) * mean;
}

function entryFor(key: string): (typeof CLASS_MIX)[number] {
  let u = unit(`${key}:class`);
  for (const c of CLASS_MIX) {
    if (u < c.share) return c;
    u -= c.share;
  }
  return CLASS_MIX[0];
}

function customersInMonth(month: string, index: number): number {
  // About 150 to 320 a month, with a quiet start and a seasonal bump in November and December.
  const m = Number(month.slice(5, 7));
  const season = m === 11 || m === 12 ? 1.35 : m === 1 ? 0.85 : 1;
  const ramp = Math.min(1, 0.35 + index * 0.08);
  return Math.round(between(`demo-ret-n:${month}`, 150, 240) * season * ramp);
}

export function demoCustomers(options: DemoOptions = {}): { customers: DemoCustomer[]; cutoff: string; dataStart: string } {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const classes = options.classes !== false;
  const asOf = addDays(today, -1);
  const cutoff = addDays(asOf, -SYNC_LAG);
  const lastMonth = monthStart(asOf);
  const firstMonth = addMonths(lastMonth, -(MONTHS_OF_DATA - 1));
  const dataStart = addDays(firstMonth, 5);
  const earlyUntil = addDays(dataStart, GUARD_DAYS);

  const customers: DemoCustomer[] = [];
  for (let i = 0; i < MONTHS_OF_DATA; i++) {
    const month = addMonths(firstMonth, i);
    const n = customersInMonth(month, i);
    for (let c = 0; c < n; c++) {
      const key = `demo-ret:${month}:${c}`;
      const day = intBetween(`${key}:day`, 1, 28);
      const first = addDays(month, day - 1);
      if (first < dataStart || first > asOf) continue;

      const mix = entryFor(key);
      // The brand gets better at bringing people back: about 40% more repeaters across the two years.
      const improving = 0.8 + 0.4 * (i / (MONTHS_OF_DATA - 1));
      const ever = unit(`${key}:ever`) < (mix.repeat365 * improving) / 0.99;
      const delay = ever ? 7 + exponential(`${key}:delay`, 70) : null;
      let to2nd = delay === null ? null : Math.round(delay);
      if (to2nd !== null && daysBetween(first, asOf) < to2nd) to2nd = null; // not yet in the data

      let toFull: number | null = null;
      if (classes && to2nd !== null) {
        if (unit(`${key}:up`) < mix.upgrade) toFull = to2nd;
        else if (unit(`${key}:later`) < 0.35) toFull = to2nd + Math.round(10 + exponential(`${key}:laterd`, 80));
        if (toFull !== null && daysBetween(first, asOf) < toFull) toFull = null;
      }

      let to3rd: number | null = null;
      if (to2nd !== null && unit(`${key}:third`) < 0.36) {
        const d3 = Math.round(7 + exponential(`${key}:third-delay`, 80));
        if (daysBetween(first, asOf) >= to2nd + d3) to3rd = d3;
      }

      customers.push({
        month,
        first,
        entry: classes ? mix.entry : null,
        early: first < earlyUntil,
        to2nd,
        toFull,
        to3rd,
        observed: daysBetween(first, cutoff),
      });
    }
  }
  return { customers, cutoff, dataStart };
}

function zero(): ByHorizon {
  return { 30: 0, 60: 0, 90: 0, 180: 0, 365: 0 };
}

/** Aggregates customers the way the cohort view and the curve query do. */
export function aggregateDemo(
  customers: readonly DemoCustomer[],
  cutoff: string,
  dataStart: string,
  classes: boolean
): RetentionData {
  const cohort = new Map<string, CohortRow>();
  const curve = new Map<string, KmRow>();

  for (const c of customers) {
    const key = `${c.month}|${c.entry}|${c.early}`;
    let row = cohort.get(key);
    if (!row) {
      row = { month: c.month, entry: c.entry, early: c.early, n: 0, m: zero(), r: zero(), u: zero(), m23: 0, r23: 0 };
      cohort.set(key, row);
    }
    row.n += 1;
    for (const h of HORIZONS as readonly Horizon[]) {
      if (c.observed >= h) {
        row.m[h] += 1;
        if (c.to2nd !== null && c.to2nd <= h) row.r[h] += 1;
        if (c.toFull !== null && c.toFull <= h) row.u[h] += 1;
      }
    }
    if (c.to2nd !== null && c.observed - c.to2nd >= 180) {
      row.m23 += 1;
      if (c.to3rd !== null && c.to3rd <= 180) row.r23 += 1;
    }

    // Curve rows: non-early customers whose first order is within 547 days of the cut-off.
    if (c.early || c.observed < 0) continue;
    const group = c.observed < 182 ? "recent" : c.observed < 547 ? "older" : null;
    if (!group) continue;
    for (const event of classes ? (["repeat", "full"] as const) : (["repeat"] as const)) {
      const at = event === "repeat" ? c.to2nd : c.toFull;
      const had = at !== null && at <= c.observed;
      const t = Math.min(had ? (at as number) : c.observed, 366);
      const ck = `${c.entry}|${group}|${event}|${t}`;
      let r = curve.get(ck);
      if (!r) {
        r = { entry: c.entry, group, event, t, events: 0, censored: 0 };
        curve.set(ck, r);
      }
      if (had) r.events += 1;
      else r.censored += 1;
    }
  }

  return {
    meta: { cutoff, dataStart, guardDays: GUARD_DAYS, classes },
    rows: [...cohort.values()].sort((a, b) => (a.month === b.month ? String(a.entry).localeCompare(String(b.entry)) : a.month < b.month ? -1 : 1)),
    km: [...curve.values()],
    primaryHorizon: 90,
  };
}

const memo = new Map<string, RetentionData>();

export function demoRetention(options: DemoOptions = {}): RetentionData {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const classes = options.classes !== false;
  const key = `${today}|${classes}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const { customers, cutoff, dataStart } = demoCustomers({ today, classes });
  const data = aggregateDemo(customers, cutoff, dataStart, classes);
  memo.set(key, data);
  return data;
}
