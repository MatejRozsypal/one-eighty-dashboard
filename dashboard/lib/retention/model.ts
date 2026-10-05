/**
 * Retention model: the page's numbers from the warehouse rows. Pure, no
 * imports from the server layer, so the page, the demo and the check script
 * all compute through the same functions.
 *
 * Design: 03_design.md sections 1.5 to 1.7 and 3.3.
 *
 * Input is one row per (cohort month, entry class, early flag) from the cohort
 * view: counts that are summed, never averaged. Two maturity rules, both from
 * the design:
 *
 *   month level     a cohort month is mature for H days when its last day plus
 *                   H is on or before the cut-off. Headlines, the trend and
 *                   the "Last 6" row use only such months, so every customer in
 *                   them has had the full horizon.
 *   customer level  m_H already counts only customers whose own first order is
 *                   H days old. The "All mature" row and the Entry products
 *                   table pool these, exactly like the Customers page tile.
 *
 * Early customers (first seen in the guard period after the data start, so
 * possibly returning customers from before it) are never in a pooled figure.
 */

import { kaplanMeier, newcombe, rateState, wilson, type KmCurve, type Newcombe, type Rate, type RateState, type Wilson } from "@/lib/retention/stats";

export const HORIZONS = [30, 60, 90, 180, 365] as const;
export type Horizon = (typeof HORIZONS)[number];
export type EventKind = "repeat" | "full";
export type VsKind = "year" | "prior";

export const ENTRY_CLASSES = ["discovery", "full", "mixed", "sample", "gift", "other"] as const;
export type EntryClass = (typeof ENTRY_CLASSES)[number];

export const ENTRY_LABELS: Record<EntryClass, string> = {
  discovery: "Discovery set",
  full: "Full size",
  mixed: "Mixed",
  sample: "Single sample",
  gift: "Gift set",
  other: "Other",
};

/** Customers needed in an entry class (mature at 90 days) before it is offered as a filter. */
export const MIN_ENTRY_CUSTOMERS = 30;
/** Entrants needed in the 90 day window before Discovery set is the default filter. */
export const DEFAULT_ENTRY_MIN = 100;
/** Months pooled into a headline. */
export const HEADLINE_MONTHS = 6;

export type ByHorizon = Record<Horizon, number>;

/** One row of the cohort view. */
export interface CohortRow {
  /** First day of the first-order month, YYYY-MM-DD. */
  month: string;
  /** Null for a client without product classes. */
  entry: string | null;
  early: boolean;
  n: number;
  m: ByHorizon;
  r: ByHorizon;
  u: ByHorizon;
  m23: number;
  r23: number;
}

export interface RetentionMeta {
  /** Last day whose orders are counted as complete, YYYY-MM-DD. */
  cutoff: string;
  dataStart: string | null;
  guardDays: number;
  /** False for a client without product classes: no entry or event controls. */
  classes: boolean;
}

export interface KmRow {
  entry: string | null;
  group: "recent" | "older";
  event: EventKind;
  /** Day since the first order, 1 to 365, or 366 for "later". */
  t: number;
  events: number;
  censored: number;
}

export interface RetentionData {
  meta: RetentionMeta;
  rows: CohortRow[];
  km: KmRow[];
  /** `primary_horizon_days` from the client's settings. */
  primaryHorizon: number;
}

// ---------------------------------------------------------------------------
// Dates (UTC, ISO strings)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / DAY_MS);
}

/** First day of the month `n` months after `monthIso` (n may be negative). */
export function addMonths(monthIso: string, n: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Last day of the month that starts on `monthIso`. */
export function lastDayOfMonth(monthIso: string): string {
  return addDays(addMonths(monthIso, 1), -1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 2026". */
export function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Oct 30". */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Jan to Jun 2026", or "Oct 2025 to Mar 2026" across a year. */
export function windowLabel(from: string, to: string): string {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (from === to) return monthLabel(from);
  return fy === ty ? `${MONTHS[fm - 1]} to ${MONTHS[tm - 1]} ${ty}` : `${MONTHS[fm - 1]} ${fy} to ${MONTHS[tm - 1]} ${ty}`;
}

// ---------------------------------------------------------------------------
// Maturity
// ---------------------------------------------------------------------------

/** The cut-off a cohort month needs before it is mature for `horizon` days. */
export function matureOn(monthIso: string, horizon: number): string {
  return addDays(lastDayOfMonth(monthIso), horizon);
}

/** Month level maturity: every customer in the month has had `horizon` days. */
export function monthMature(monthIso: string, cutoff: string, horizon: number): boolean {
  return matureOn(monthIso, horizon) <= cutoff;
}

export interface MonthWindow {
  /** First month, YYYY-MM-01. */
  from: string;
  /** Last month, YYYY-MM-01. */
  to: string;
  label: string;
}

/** The last `count` months that are fully mature for `horizon` at `cutoff`. */
export function lastMatureWindow(cutoff: string, horizon: number, count: number = HEADLINE_MONTHS): MonthWindow {
  let to = monthStart(cutoff);
  // The latest candidate is the cut-off's own month; step back to the first mature one.
  while (!monthMature(to, cutoff, horizon)) to = addMonths(to, -1);
  const from = addMonths(to, -(count - 1));
  return { from, to, label: windowLabel(from, to) };
}

/** The comparison window: the same months a year earlier, or the months right before. */
export function compareWindow(window: MonthWindow, vs: VsKind, count: number = HEADLINE_MONTHS): MonthWindow {
  const shift = vs === "year" ? -12 : -count;
  const from = addMonths(window.from, shift);
  const to = addMonths(window.to, shift);
  return { from, to, label: windowLabel(from, to) };
}

// ---------------------------------------------------------------------------
// Pooling
// ---------------------------------------------------------------------------

export function entryMatches(row: CohortRow, entry: string): boolean {
  return entry === "all" || row.entry === entry;
}

/** r (repeat) or u (full size) for one horizon. */
export function hits(row: CohortRow, event: EventKind, horizon: Horizon): number {
  return event === "repeat" ? row.r[horizon] : row.u[horizon];
}

export interface PoolOptions {
  entry: string;
  event: EventKind;
  horizon: Horizon;
  /** Inclusive first and last month. Omit for every month. */
  window?: { from: string; to: string };
  /** Month level (true): only months fully mature at the cut-off. Customer level (false): m_H decides. */
  monthLevel: boolean;
  cutoff: string;
}

/** k of n over non-early rows, summed (never averaged). */
export function poolRows(rows: readonly CohortRow[], o: PoolOptions): Rate {
  let k = 0;
  let n = 0;
  for (const row of rows) {
    if (row.early || !entryMatches(row, o.entry)) continue;
    if (o.window && (row.month < o.window.from || row.month > o.window.to)) continue;
    if (o.monthLevel) {
      if (!monthMature(row.month, o.cutoff, o.horizon)) continue;
      n += row.m[o.horizon];
      k += hits(row, o.event, o.horizon);
    } else {
      n += row.m[o.horizon];
      k += hits(row, o.event, o.horizon);
    }
  }
  return { k, n };
}

export interface RateView extends Rate {
  state: RateState;
  /** Null when n is 0. */
  ci: Wilson | null;
  /** k / n, null when there is nobody. */
  p: number | null;
}

/** A pooled count with its display state and Wilson range. */
export function rateView(rate: Rate): RateView {
  return { ...rate, state: rateState(rate.n), ci: wilson(rate.k, rate.n), p: rate.n > 0 ? rate.k / rate.n : null };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export interface EntryOption {
  value: string;
  label: string;
}

/**
 * The Entry control: All, plus each class with at least 30 customers whose
 * first order is 90 days old (non-early). Empty for a client without classes.
 */
export function entryOptions(rows: readonly CohortRow[], meta: RetentionMeta): EntryOption[] {
  if (!meta.classes) return [];
  const mature = new Map<string, number>();
  for (const row of rows) {
    if (row.early || row.entry === null) continue;
    mature.set(row.entry, (mature.get(row.entry) ?? 0) + row.m[90]);
  }
  const out: EntryOption[] = [{ value: "all", label: "All" }];
  for (const c of ENTRY_CLASSES) {
    if ((mature.get(c) ?? 0) >= MIN_ENTRY_CUSTOMERS) out.push({ value: c, label: ENTRY_LABELS[c] });
  }
  return out;
}

/** Discovery set when it has 100 or more entrants in the 90 day window, else All. */
export function defaultEntry(rows: readonly CohortRow[], meta: RetentionMeta): string {
  if (!meta.classes) return "all";
  const w = lastMatureWindow(meta.cutoff, 90);
  const pool = poolRows(rows, { entry: "discovery", event: "repeat", horizon: 90, window: w, monthLevel: true, cutoff: meta.cutoff });
  return pool.n >= DEFAULT_ENTRY_MIN ? "discovery" : "all";
}

/** The requested entry when it is offered, else the default. */
export function resolveEntry(requested: string | undefined, rows: readonly CohortRow[], meta: RetentionMeta): string {
  const options = entryOptions(rows, meta);
  if (requested && options.some((o) => o.value === requested)) return requested;
  return defaultEntry(rows, meta);
}

export function parseHorizon(value: unknown, fallback: Horizon = 90): Horizon {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (HORIZONS as readonly number[]).includes(n) ? (n as Horizon) : fallback;
}

/** The settings horizon when it is one of the five, else 90. */
export function primaryHorizon(days: number | null | undefined): Horizon {
  return (HORIZONS as readonly number[]).includes(days as number) ? (days as Horizon) : 90;
}

export function parseVs(value: unknown): VsKind {
  return (Array.isArray(value) ? value[0] : value) === "prior" ? "prior" : "year";
}

export function parseEvent(value: unknown, meta: RetentionMeta): EventKind {
  return meta.classes && (Array.isArray(value) ? value[0] : value) === "full" ? "full" : "repeat";
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export interface Tile {
  key: string;
  event: EventKind;
  horizon: Horizon;
  window: MonthWindow;
  compare: MonthWindow;
  current: RateView;
  previous: RateView;
  /** Null when either window has fewer than 30 customers. */
  diff: Newcombe | null;
}

export function tile(rows: readonly CohortRow[], meta: RetentionMeta, entry: string, event: EventKind, horizon: Horizon, vs: VsKind): Tile {
  const window = lastMatureWindow(meta.cutoff, horizon);
  const compare = compareWindow(window, vs);
  const base = { entry, event, horizon, monthLevel: true, cutoff: meta.cutoff };
  const current = rateView(poolRows(rows, { ...base, window }));
  const previous = rateView(poolRows(rows, { ...base, window: compare }));
  const diff = current.state !== "few" && previous.state !== "few" ? newcombe(current, previous) : null;
  return { key: `${event}${horizon}`, event, horizon, window, compare, current, previous, diff };
}

/** Customers of the selected entry not yet mature for 90 days (non-early). */
export function maturing(rows: readonly CohortRow[], entry: string): number {
  let total = 0;
  for (const row of rows) {
    if (row.early || !entryMatches(row, entry)) continue;
    total += row.n - row.m[90];
  }
  return total;
}

// ---------------------------------------------------------------------------
// Cohort table and trend
// ---------------------------------------------------------------------------

export interface CohortCell extends RateView {
  /** False when the month is not yet mature for the horizon: shown as n/a. */
  mature: boolean;
  /** The cut-off date the month needs, for "Matures {date}". */
  maturesOn: string;
}

export interface CohortLine {
  month: string;
  /** Customers entering that month (non-early, or all of them for a fully early month). */
  entrants: number;
  /** True when every customer of the month is early. */
  early: boolean;
  /** Early customers left out of a mixed month. */
  earlyLeftOut: number;
  cells: Record<Horizon, CohortCell>;
}

export interface SummaryLine {
  label: "Last 6" | "All mature";
  entrants: number;
  cells: Record<Horizon, RateView>;
}

export interface CohortTable {
  summary: SummaryLine[];
  /** Newest first. */
  lines: CohortLine[];
}

interface MonthAgg {
  month: string;
  rows: CohortRow[];
}

function groupByMonth(rows: readonly CohortRow[], entry: string): MonthAgg[] {
  const map = new Map<string, CohortRow[]>();
  for (const row of rows) {
    if (!entryMatches(row, entry)) continue;
    const list = map.get(row.month) ?? [];
    list.push(row);
    map.set(row.month, list);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, list]) => ({ month, rows: list }));
}

/** One cell of a month, from the rows that represent it (non-early, or the early ones for a fully early month). */
function monthCell(month: string, rows: readonly CohortRow[], event: EventKind, horizon: Horizon, cutoff: string): CohortCell {
  let k = 0;
  let n = 0;
  for (const row of rows) {
    n += row.m[horizon];
    k += hits(row, event, horizon);
  }
  const mature = monthMature(month, cutoff, horizon);
  return { ...rateView({ k: mature ? k : 0, n: mature ? n : 0 }), mature, maturesOn: matureOn(month, horizon) };
}

/** Rows that represent a month: its non-early customers, or the early ones when there are no others. */
export function representativeRows(rows: readonly CohortRow[]): { rows: CohortRow[]; early: boolean; earlyLeftOut: number } {
  const normal = rows.filter((r) => !r.early);
  const early = rows.filter((r) => r.early);
  if (normal.length > 0) return { rows: normal, early: false, earlyLeftOut: early.reduce((s, r) => s + r.n, 0) };
  return { rows: early, early: true, earlyLeftOut: 0 };
}

export function cohortTable(rows: readonly CohortRow[], meta: RetentionMeta, entry: string, event: EventKind, months: number | null): CohortTable {
  const aggs = groupByMonth(rows, entry);
  const lines: CohortLine[] = aggs.map(({ month, rows: list }) => {
    const rep = representativeRows(list);
    const cells = {} as Record<Horizon, CohortCell>;
    for (const h of HORIZONS) cells[h] = monthCell(month, rep.rows, event, h, meta.cutoff);
    return { month, entrants: rep.rows.reduce((s, r) => s + r.n, 0), early: rep.early, earlyLeftOut: rep.earlyLeftOut, cells };
  });
  lines.reverse();
  const shown = months === null ? lines : lines.slice(0, months);

  const entrants = rows.reduce((s, r) => (r.early || !entryMatches(r, entry) ? s : s + r.n), 0);
  const last6 = {} as Record<Horizon, RateView>;
  const all = {} as Record<Horizon, RateView>;
  for (const h of HORIZONS) {
    const window = lastMatureWindow(meta.cutoff, h);
    last6[h] = rateView(poolRows(rows, { entry, event, horizon: h, window, monthLevel: true, cutoff: meta.cutoff }));
    all[h] = rateView(poolRows(rows, { entry, event, horizon: h, monthLevel: false, cutoff: meta.cutoff }));
  }
  const last6Entrants = poolEntrants(rows, entry, meta.cutoff);
  return {
    summary: [
      { label: "Last 6", entrants: last6Entrants, cells: last6 },
      { label: "All mature", entrants, cells: all },
    ],
    lines: shown,
  };
}

/** Entrants (non-early) in the last 6 months that are mature for the 30 day horizon, the first column's window. */
function poolEntrants(rows: readonly CohortRow[], entry: string, cutoff: string): number {
  const w = lastMatureWindow(cutoff, 30);
  let n = 0;
  for (const row of rows) {
    if (row.early || !entryMatches(row, entry) || row.month < w.from || row.month > w.to) continue;
    n += row.n;
  }
  return n;
}

export interface TrendPoint {
  month: string;
  rate: RateView;
  /** Fully early month: drawn hollow. */
  early: boolean;
}

export interface TrendQuarter {
  /** First day of the quarter's first month. */
  from: string;
  /** First day of the quarter's last month. */
  to: string;
  label: string;
  rate: RateView;
}

export interface Trend {
  horizon: Horizon;
  /** Oldest first. Only months mature for the horizon. */
  points: TrendPoint[];
  quarters: TrendQuarter[];
  /** Entrants per month shown, for the bar strip. */
  entrants: Array<{ month: string; n: number }>;
}

/** Pooled calendar quarters whose three months are all mature and not early. */
export function trend(rows: readonly CohortRow[], meta: RetentionMeta, entry: string, event: EventKind, horizon: Horizon, months: number | null): Trend {
  const aggs = groupByMonth(rows, entry);
  const all: TrendPoint[] = [];
  const entrants: Trend["entrants"] = [];
  const byMonth = new Map<string, { rep: ReturnType<typeof representativeRows>; cell: CohortCell }>();
  for (const { month, rows: list } of aggs) {
    const rep = representativeRows(list);
    const cell = monthCell(month, rep.rows, event, horizon, meta.cutoff);
    byMonth.set(month, { rep, cell });
    if (!cell.mature) continue;
    all.push({ month, rate: cell, early: rep.early });
    entrants.push({ month, n: rep.rows.reduce((s, r) => s + r.n, 0) });
  }
  const keep = months === null ? all.length : Math.min(months, all.length);
  const points = all.slice(all.length - keep);
  const shownEntrants = entrants.slice(entrants.length - keep);

  const quarters: TrendQuarter[] = [];
  const first = points[0]?.month;
  const last = points[points.length - 1]?.month;
  if (first && last) {
    // Calendar quarters start in Jan, Apr, Jul, Oct.
    let q = quarterStart(first);
    for (; q <= last; q = addMonths(q, 3)) {
      const ms = [q, addMonths(q, 1), addMonths(q, 2)];
      const parts = ms.map((m) => byMonth.get(m));
      if (parts.some((p) => !p || !p.cell.mature || p.rep.early || p.rep.earlyLeftOut > 0)) continue;
      if (ms.some((m) => m < first)) continue;
      let k = 0;
      let n = 0;
      for (const p of parts) {
        for (const row of p!.rep.rows) {
          n += row.m[horizon];
          k += hits(row, event, horizon);
        }
      }
      quarters.push({ from: q, to: ms[2], label: `Q${Math.floor((Number(q.slice(5, 7)) - 1) / 3) + 1} ${q.slice(0, 4)}`, rate: rateView({ k, n }) });
    }
  }
  return { horizon, points, quarters, entrants: shownEntrants };
}

function quarterStart(monthIso: string): string {
  const m = Number(monthIso.slice(5, 7));
  return `${monthIso.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// Entry products
// ---------------------------------------------------------------------------

export interface EntryLine {
  /** "all" for the total row, else the class. */
  entry: string;
  label: string;
  customers: number;
  /** Share of all non-early entrants. */
  share: number | null;
  repeat90: RateView;
  repeat365: RateView;
  full365: RateView;
  third180: RateView;
}

/** One row per class with entrants (non-early), customer-level pooling, plus an All row. */
export function entryTable(rows: readonly CohortRow[], meta: RetentionMeta): EntryLine[] {
  if (!meta.classes) return [];
  const present = new Set<string>();
  for (const row of rows) if (!row.early && row.entry) present.add(row.entry);
  const order = [...ENTRY_CLASSES.filter((c) => present.has(c)), ...[...present].filter((c) => !(ENTRY_CLASSES as readonly string[]).includes(c))];
  const total = rows.reduce((s, r) => (r.early ? s : s + r.n), 0);

  const line = (entry: string, label: string): EntryLine => {
    const base = { entry, monthLevel: false, cutoff: meta.cutoff };
    let customers = 0;
    let k23 = 0;
    let n23 = 0;
    for (const row of rows) {
      if (row.early || !entryMatches(row, entry)) continue;
      customers += row.n;
      k23 += row.r23;
      n23 += row.m23;
    }
    return {
      entry,
      label,
      customers,
      share: total > 0 ? customers / total : null,
      repeat90: rateView(poolRows(rows, { ...base, event: "repeat", horizon: 90 })),
      repeat365: rateView(poolRows(rows, { ...base, event: "repeat", horizon: 365 })),
      full365: rateView(poolRows(rows, { ...base, event: "full", horizon: 365 })),
      third180: rateView({ k: k23, n: n23 }),
    };
  };

  return [
    ...order.map((c) => line(c, (ENTRY_LABELS as Record<string, string>)[c] ?? "Other")),
    line("all", "All customers"),
  ];
}

// ---------------------------------------------------------------------------
// Curve input
// ---------------------------------------------------------------------------

export interface CurveGroups {
  recent: KmCurve;
  older: KmCurve;
}

/** Kaplan-Meier curves of the two first-order groups for an entry class and event. */
export function curves(km: readonly KmRow[], entry: string, event: EventKind): CurveGroups {
  const pick = (group: "recent" | "older") =>
    kaplanMeier(
      km
        .filter((r) => r.group === group && r.event === event && (entry === "all" || r.entry === entry))
        .map((r) => ({ t: r.t, events: r.events, censored: r.censored }))
    );
  return { recent: pick("recent"), older: pick("older") };
}
