/**
 * Widget evaluation: component sums in, WidgetResult out.
 *
 * Every metric formula is evaluated here, in one place, from summed
 * components: per bucket, per period total, per client and per rollup.
 * Totals sum components across buckets first and then evaluate; they are
 * never a sum or average of bucket values.
 *
 * Rules (design 2.9, owner decisions in the reporting brief):
 * - Buckets are built in TypeScript from the range, so a missing bucket is a
 *   gap (null), never a skipped point. Partial first and last weeks or
 *   months are flagged. Comparison buckets align with current ones by position.
 * - FX: a display-currency sum of a bucket with fx_missing_rows > 0 is nulled
 *   (never a quiet partial SUM); its months are reported. When the client
 *   already trades in the display currency and the bucket has no rows in
 *   another currency, the native sum is used instead: it is exactly the same
 *   number and needs no rate.
 * - COGS guard: a guarded component (COGS) that sums to 0 or NULL while its
 *   guard (revenue) is > 0 is not measured. Applied per client and per row
 *   group; a period total is not measured when any of its buckets is, so a
 *   total never silently covers uncosted days.
 * - Per-client series read native sums for non-money units and display sums
 *   for money units. Rollups read display sums for every client, so all
 *   clients are in one currency before summing; not_connected clients are
 *   left out (coverage "n of m"); a rollup bucket is null when any included
 *   client is fx_missing or not_measured there, never a partial total.
 * - Deltas: percentage points for percent units, relative otherwise.
 * - Status precedence: not_connected > fx_missing > not_measured > no_data > ok.
 *
 * Pure: no BigQuery, no session.
 *
 * Design: 11_reporting_suite_design.md sections 2.9 and 2.12. Owner: WP1 (RS1).
 */

import { delta as relativeDelta } from "@/lib/period";
import { TOTAL_BUCKET, type ComponentRow, type ComponentSum, type EvaluateModule, type EvaluateWidget, type ResolvedWidget } from "./contracts";
import { SERIES_SLOTS } from "./limits";
import { notConnectedReason } from "./registry/capabilities";
import { clientCaveats, orderCaveats } from "./registry/caveats";
import { getComponent } from "./registry/components";
import type { MetricId } from "./registry/ids";
import { METRICS } from "./registry/metrics";
import type { Capability, CaveatId, ComponentId, RegisteredMetric, ReportClient, Term } from "./registry/types";
import { buildBuckets, partialBucketIndexes, verticalKey } from "./resolve";
import {
  CELL_STATUS_LABEL,
  COMBINED_SERIES_ID,
  UNASSIGNED_VERTICAL,
  verticalSeriesId,
  type CellStatus,
  type MetricCell,
  type ResultSeries,
  type ResultWarning,
  type WidgetResult,
} from "./types";

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/** Summed rows of one client for one row group (a bucket or a whole period). */
interface Agg {
  values: Map<ComponentId, ComponentSum>;
  fxMissing: boolean;
  fxMonths: Set<string>;
  foreignRows: number;
  nRows: number;
}

function emptyAgg(): Agg {
  return { values: new Map(), fxMissing: false, fxMonths: new Set(), foreignRows: 0, nRows: 0 };
}

/** SQL SUM semantics: null + null = null, null + x = x. */
function addN(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function addRow(agg: Agg, row: ComponentRow): void {
  for (const g of Object.values(row.guards)) {
    if (!g) continue;
    agg.nRows += g.nRows;
    agg.foreignRows += g.foreignCcyRows;
    if (g.fxMissingRows > 0) {
      agg.fxMissing = true;
      for (const m of g.fxMissingMonths) agg.fxMonths.add(m);
    }
  }
  for (const [id, v] of Object.entries(row.values) as Array<[ComponentId, ComponentSum | undefined]>) {
    if (!v) continue;
    const prev = agg.values.get(id) ?? { nat: null, disp: null };
    agg.values.set(id, { nat: addN(prev.nat, num(v.nat)), disp: addN(prev.disp, num(v.disp)) });
  }
}

function mergeAggs(aggs: Iterable<Agg>): Agg {
  const out = emptyAgg();
  for (const a of aggs) {
    out.nRows += a.nRows;
    out.foreignRows += a.foreignRows;
    if (a.fxMissing) out.fxMissing = true;
    for (const m of a.fxMonths) out.fxMonths.add(m);
    for (const [id, v] of a.values) {
      const prev = out.values.get(id) ?? { nat: null, disp: null };
      out.values.set(id, { nat: addN(prev.nat, v.nat), disp: addN(prev.disp, v.disp) });
    }
  }
  return out;
}

/** Rows of one client and period: per bucket (by bucket string) and the period total. */
interface ClientPeriod {
  buckets: Map<string, Agg>;
  total: Agg;
}

// ---------------------------------------------------------------------------
// Reading components
// ---------------------------------------------------------------------------

type ReadMode = "native" | "display";

interface Read {
  value: number | null;
  /** The value needed an FX rate that is missing. */
  fx: boolean;
}

/** One client's value of one component in one row group. */
function readComponent(agg: Agg, id: ComponentId, mode: ReadMode, client: ReportClient, displayCurrency: string): Read {
  const v = agg.values.get(id);
  const def = getComponent(id);
  if (!def.money) return { value: v ? (v.nat ?? v.disp) : null, fx: false };
  if (mode === "native") return { value: v ? v.nat : null, fx: false };
  // Same currency and no foreign rows: the native sum is the display sum, no rate needed.
  if (client.currency === displayCurrency && agg.foreignRows === 0) return { value: v ? v.nat : null, fx: false };
  if (agg.fxMissing) return { value: null, fx: true };
  return { value: v ? v.disp : null, fx: false };
}

/** COGS guard for one client's row group: true when a guarded component of the metric is not measured. */
function guardFails(agg: Agg, metric: RegisteredMetric): boolean {
  for (const id of metric.meta.components) {
    const guard = getComponent(id).zeroIsMissingWhen;
    if (!guard) continue;
    const v = agg.values.get(id);
    const g = agg.values.get(guard);
    const raw = v ? (v.nat ?? v.disp) : null;
    const gRaw = g ? (g.nat ?? g.disp) : null;
    if (gRaw !== null && gRaw > 0 && (raw === null || raw === 0)) return true;
  }
  return false;
}

function evalTerms(terms: readonly Term[], get: (c: ComponentId) => Read): { value: number | null; fx: boolean } {
  let acc = 0;
  let gap = false;
  let fx = false;
  for (const term of terms) {
    const r = get(term.c);
    if (r.fx) fx = true;
    if (r.value === null) {
      if (term.nullAs === "gap") gap = true;
      continue;
    }
    acc += term.sign * r.value;
  }
  return { value: gap || fx ? null : acc, fx };
}

/** Evaluate a metric formula over a component getter. */
export function evaluateFormula(metric: RegisteredMetric, get: (c: ComponentId) => Read): { value: number | null; fx: boolean } {
  if (metric.kind === "sum") return evalTerms(metric.terms, get);
  const n = evalTerms(metric.numerator, get);
  const d = evalTerms(metric.denominator, get);
  const fx = n.fx || d.fx;
  if (fx || n.value === null || d.value === null || d.value === 0) return { value: null, fx };
  return { value: (n.value / d.value) * (metric.scale ?? 1), fx: false };
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

type Status = Exclude<CellStatus, "not_connected">;

interface Outcome {
  value: number | null;
  status: Status;
  fxMonths: string[];
}

const NO_ROWS: Outcome = { value: null, status: "no_data", fxMonths: [] };

/** One group of clients (one client for a client series) evaluated on one row group. */
interface Member {
  client: ReportClient;
  agg: Agg | undefined;
  /** Guard failures in finer row groups that this aggregate covers (strict totals). */
  innerGuardFail: boolean;
}

function outcome(metric: RegisteredMetric, members: readonly Member[], mode: ReadMode, displayCurrency: string): Outcome {
  const present = members.filter((m) => m.agg !== undefined) as Array<Member & { agg: Agg }>;
  if (present.length === 0) return NO_ROWS;
  const fxMonths = new Set<string>();
  let fx = false;
  const summed = new Map<ComponentId, Read>();
  for (const id of metric.meta.components) {
    let value: number | null = null;
    let compFx = false;
    for (const m of present) {
      const r = readComponent(m.agg, id, mode, m.client, displayCurrency);
      if (r.fx) {
        compFx = true;
        for (const mo of m.agg.fxMonths) fxMonths.add(mo);
      }
      value = addN(value, r.value);
    }
    if (compFx) fx = true;
    summed.set(id, { value: compFx ? null : value, fx: compFx });
  }
  if (fx) return { value: null, status: "fx_missing", fxMonths: [...fxMonths].sort() };
  if (present.some((m) => m.innerGuardFail || guardFails(m.agg, metric))) return { value: null, status: "not_measured", fxMonths: [] };
  const r = evaluateFormula(metric, (c) => summed.get(c) ?? { value: null, fx: false });
  if (r.value === null) return { value: null, status: "no_data", fxMonths: [] };
  return { value: r.value, status: "ok", fxMonths: [] };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "No FX Oct 2026", or "No FX 2 months". */
export function fxReason(months: readonly string[]): string {
  if (months.length === 1) {
    const [y, m] = months[0].split("-").map(Number);
    return `No FX ${MONTHS[m - 1]} ${y}`;
  }
  return months.length > 1 ? `No FX ${months.length} months` : CELL_STATUS_LABEL.fx_missing;
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

interface Group {
  id: string;
  label: string;
  slot: number;
  kind: ResultSeries["kind"];
  clients: ReportClient[];
}

function groupsFor(widget: ResolvedWidget): Group[] {
  const split = widget.query.split;
  if (split === "client") {
    return widget.clients.map((c) => ({ id: c.id, label: c.name, slot: c.slot, kind: "client" as const, clients: [c] }));
  }
  if (split === "combined") {
    return [{ id: COMBINED_SERIES_ID, label: "All clients", slot: 0, kind: "combined", clients: [...widget.clients] }];
  }
  const byVertical = new Map<string, ReportClient[]>();
  for (const c of widget.clients) {
    const k = verticalKey(c);
    byVertical.set(k, [...(byVertical.get(k) ?? []), c]);
  }
  const keys = [...byVertical.keys()].sort((a, b) => {
    if (a === UNASSIGNED_VERTICAL) return 1;
    if (b === UNASSIGNED_VERTICAL) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map((k, i) => ({ id: verticalSeriesId(k), label: k, slot: i % SERIES_SLOTS, kind: "vertical" as const, clients: byVertical.get(k)! }));
}

export const evaluateWidget: EvaluateWidget = (input) => {
  const { widget, rows } = input;
  const grain = widget.grain;
  const display = widget.displayCurrency;
  const curRange = widget.period.current;
  const cmpRange = widget.period.comparison;
  const buckets = buildBuckets(curRange, grain);
  const cmpBuckets = cmpRange ? buildBuckets(cmpRange, grain) : [];
  const rowKeys = grain === "total" ? [TOTAL_BUCKET] : buckets;
  const cmpRowKeys = grain === "total" ? [TOTAL_BUCKET] : cmpBuckets;

  // Index rows: client -> period -> bucket -> Agg.
  const known = new Map(widget.clients.map((c) => [c.id, c] as const));
  const data = new Map<string, { cur: ClientPeriod; cmp: ClientPeriod }>();
  for (const row of rows) {
    if (!known.has(row.clientId)) continue;
    if (row.period === "cmp" && !cmpRange) continue;
    let d = data.get(row.clientId);
    if (!d) {
      d = { cur: { buckets: new Map(), total: emptyAgg() }, cmp: { buckets: new Map(), total: emptyAgg() } };
      data.set(row.clientId, d);
    }
    const p = row.period === "cur" ? d.cur : d.cmp;
    let agg = p.buckets.get(row.bucket);
    if (!agg) {
      agg = emptyAgg();
      p.buckets.set(row.bucket, agg);
    }
    addRow(agg, row);
  }
  for (const d of data.values()) {
    d.cur.total = mergeAggs(d.cur.buckets.values());
    d.cmp.total = mergeAggs(d.cmp.buckets.values());
  }
  const periodOf = (clientId: string, period: "cur" | "cmp"): ClientPeriod | undefined => data.get(clientId)?.[period];

  const fxWarningMonths = new Set<string>();
  const metrics = widget.query.metrics;

  const series: ResultSeries[] = groupsFor(widget).map((group) => {
    const isClient = group.kind === "client";
    const caveats = new Set<CaveatId>();
    for (const c of group.clients) {
      for (const cv of clientCaveats(c)) caveats.add(cv);
      const d = data.get(c.id);
      if (d && (d.cur.total.foreignRows > 0 || d.cmp.total.foreignRows > 0)) caveats.add("foreign_currency_rows");
    }

    const cells: Partial<Record<MetricId, MetricCell>> = {};
    for (const id of metrics) {
      const metric = METRICS[id] as RegisteredMetric;
      const deltaKind = metric.unit === "percent" ? ("pp" as const) : ("relative" as const);
      const included = group.clients.filter((c) => widget.availability[c.id]?.[id]?.ok === true);
      const coverage = isClient ? undefined : { included: included.length, of: group.clients.length };

      if (included.length === 0) {
        const missing = new Set<Capability>();
        for (const c of group.clients) for (const m of widget.availability[c.id]?.[id]?.missing ?? []) missing.add(m);
        const missingList = [...missing];
        cells[id] = {
          status: "not_connected",
          reason: notConnectedReason(missingList),
          missing: missingList,
          total: null,
          compareTotal: null,
          delta: null,
          deltaKind,
          ...(coverage ? { coverage } : {}),
        };
        continue;
      }

      const mode: ReadMode = isClient && metric.meta.fxMode === "native-per-client" ? "native" : "display";
      const members = (period: "cur" | "cmp", bucket: string | null): Member[] =>
        included.map((client) => {
          const p = periodOf(client.id, period);
          if (!p) return { client, agg: undefined, innerGuardFail: false };
          if (bucket !== null) return { client, agg: p.buckets.get(bucket), innerGuardFail: false };
          let inner = false;
          for (const a of p.buckets.values()) if (guardFails(a, metric)) inner = true;
          return { client, agg: p.total.nRows > 0 || p.total.values.size > 0 ? p.total : undefined, innerGuardFail: inner };
        });

      const cur = outcome(metric, members("cur", null), mode, display);
      const cmp = cmpRange ? outcome(metric, members("cmp", null), mode, display) : null;
      const curPoints = grain === "total" ? null : rowKeys.map((b) => outcome(metric, members("cur", b), mode, display));
      const cmpPoints = grain === "total" || !cmpRange ? null : buckets.map((_, i) => (i < cmpRowKeys.length ? outcome(metric, members("cmp", cmpRowKeys[i]), mode, display) : NO_ROWS));

      for (const o of [cur, cmp, ...(curPoints ?? []), ...(cmpPoints ?? [])]) {
        if (o && o.status === "fx_missing") for (const m of o.fxMonths) fxWarningMonths.add(m);
      }

      const ok = cur.status === "ok";
      const compareTotal = ok && cmp && cmp.status === "ok" ? cmp.value : null;
      let delta: number | null = null;
      if (ok && cur.value !== null && compareTotal !== null) {
        delta = deltaKind === "pp" ? cur.value - compareTotal : relativeDelta(cur.value, compareTotal);
      }
      const cell: MetricCell = {
        status: cur.status,
        ...(cur.status !== "ok" ? { reason: cur.status === "fx_missing" ? fxReason(cur.fxMonths) : CELL_STATUS_LABEL[cur.status] } : {}),
        ...(cur.status === "fx_missing" ? { fxMonths: cur.fxMonths } : {}),
        total: ok ? cur.value : null,
        compareTotal,
        delta,
        deltaKind,
        ...(curPoints ? { points: curPoints.map((o) => o.value) } : {}),
        ...(cmpPoints ? { comparePoints: cmpPoints.map((o) => o.value) } : {}),
        ...(coverage ? { coverage } : {}),
      };
      cells[id] = cell;
    }

    return {
      id: group.id,
      label: group.label,
      slot: group.slot,
      kind: group.kind,
      caveats: orderCaveats(caveats),
      ...(isClient ? {} : { clientIds: group.clients.map((c) => c.id) }),
      cells,
    };
  });

  // Low volume: a series whose volume component is below shareOfMax of the largest series.
  const groups = groupsFor(widget);
  if (series.length > 1) {
    for (const id of metrics) {
      const metric = METRICS[id] as RegisteredMetric;
      if (!metric.minVolume) continue;
      const comp = metric.minVolume.c;
      const volumes = groups.map((g) => {
        let v: number | null = null;
        for (const c of g.clients) {
          if (widget.availability[c.id]?.[id]?.ok !== true) continue;
          const p = periodOf(c.id, "cur");
          if (!p) continue;
          const r = readComponent(p.total, comp, "display", c, display);
          if (r.fx) return null;
          v = addN(v, r.value);
        }
        return v;
      });
      const max = Math.max(0, ...volumes.map((v) => v ?? 0));
      if (max <= 0) continue;
      series.forEach((s, i) => {
        const cell = s.cells[id];
        const v = volumes[i];
        if (cell && cell.status === "ok" && v !== null && v < metric.minVolume!.shareOfMax * max) cell.lowVolume = true;
      });
    }
  }

  const warnings: ResultWarning[] = [...widget.warnings];
  if (fxWarningMonths.size > 0) warnings.push({ code: "fx_missing", months: [...fxWarningMonths].sort() });

  const result: WidgetResult = {
    key: input.run.key,
    generatedAt: input.run.generatedAt,
    cached: input.run.cached,
    currency: display,
    grain,
    current: curRange,
    comparison: cmpRange,
    buckets,
    partialBuckets: partialBucketIndexes(curRange, grain),
    series,
    benchmarks: [...input.benchmarks],
    warnings,
  };
  return result;
};

const _conforms: EvaluateModule = { evaluateWidget };
void _conforms;
