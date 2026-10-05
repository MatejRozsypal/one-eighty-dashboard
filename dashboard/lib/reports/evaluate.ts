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
 *   guard (revenue) is > 0 is not measured, and so is one with any NULL row on
 *   a day with revenue (partial costing). Applied per client and per row
 *   group; a period total is not measured when any of its buckets is, so a
 *   total never silently covers uncosted days.
 * - Gaps (F1): a component whose registry `nullMeans` is "gap" (ad spend and
 *   the other ad-platform columns) and that has NULL rows inside a bucket, a
 *   total or a rollup makes every term that reads it as nullAs "gap" a gap, so
 *   the cell is no_data ("Missing days"), never a SUM over the valued days
 *   only. "zero" components (shop columns, which are NULL on a day without
 *   orders) and terms with nullAs "zero" (fulfilment and paid spend inside
 *   CM3, the mart definition) are not affected. Ad outcomes (purchase value,
 *   purchases, clicks, impressions) count only the days whose platform spend
 *   is NULL (registry `missingWhenNull`): a gap is only ever missing spend.
 * - Stated per-order costs (registry `perClientRate`, CM3 and CM1 parity with
 *   Snapshot): the component's summed orders, native or converted per month,
 *   are multiplied by that client's `costRates` entry (Settings, merged in by
 *   the query route). Each client uses its own rate, also inside rollups. An
 *   unstated rate counts as 0, exactly like Snapshot.
 * - Several marts in one widget (the daily KPI view and the Meta campaign and
 *   ad marts): FX and foreign-currency guards are kept per mart, so a missing
 *   rate or an ad account in another currency only affects that mart's money.
 *   Marts flagged `accountCurrency` (Meta, money in the ad account currency)
 *   are converted per row like any other but never raise the foreign
 *   currency caveat.
 * - Per-client series read native sums for non-money units and display sums
 *   for money units. Rollups read display sums for every client, so all
 *   clients are in one currency before summing.
 * - Rollups (combined, vertical) leave a client out instead of failing:
 *   a client that is not connected for the metric, or whose own cell for that
 *   row group (total or bucket) is a gap, fx_missing or not_measured, is not
 *   summed at all (none of its components), and the rollup is computed from
 *   the rest. The cell carries coverage "n of m", the excluded clients with
 *   their reasons and, per bucket, the number summed. Only when no client is
 *   left is the rollup cell not ok (the shared status of the excluded
 *   clients, or no_data).
 * - Rollup comparisons are like for like: the comparison total (and each
 *   comparison point) is computed over exactly the clients summed in the
 *   current total (point). When one of them is left out in the comparison,
 *   the comparison value and the delta are null.
 * - Deltas: percentage points for percent units, relative otherwise.
 * - Status precedence: not_connected > fx_missing > not_measured > no_data > ok.
 * - Entity marts (launch cohorts, HR3): each row is one ad. Before any
 *   summing, `classifyEntityRows` maps the row's lifetime inputs through the
 *   mart's classifier with the client's own `creativeThresholds` (merged in
 *   by the query route, never in SQL or the key) into 0/1 counts: launched,
 *   winners, open. The classifier is launchStatus() from
 *   lib/creative/hitRate.ts, the Creative tile's function, so both agree by
 *   construction. From then on the counts are ordinary components: hit rate
 *   = sum of winners / sum of launched for every bucket, total and rollup.
 *   A client without thresholds is not_measured "No thresholds" for every
 *   metric that needs them, so rollups leave it out with a coverage note.
 *   Ads launched needs no thresholds. A current period with open launches
 *   (under 60 days old, not yet a winner) carries the cohort_maturing
 *   caveat, and for metrics that are a lower bound while ads are open
 *   (winners, hit rate) the delta is suppressed when the current period is
 *   maturing and the comparison is not: older cohorts had more time.
 * - Cohort retention (customer entry mart, WR5): rates over acquisition
 *   cohorts, sum of 0/1 verdicts over the customers mature for the horizon.
 *   Metrics with `cohort` rules (registry types, MetricCohort) are checked
 *   on the summed counts of each cell: a client without product classes is
 *   not_measured "Products not classified" (rollups leave it out with a
 *   coverage note); a zero denominator with customers in the population is
 *   "Not mature yet"; a denominator under minN is "Too few customers". These
 *   two run on the pooled counts only, never on one member of a rollup, so
 *   small clients are pooled rather than dropped. A current total resting on
 *   fewer than lowN customers carries `low_n`, and one whose population is
 *   above its denominator (customers who have not had the horizon yet)
 *   carries `cohort_partial`.
 *
 * Pure: no BigQuery, no session.
 *
 * Design: 11_reporting_suite_design.md sections 2.9 and 2.12. Owner: WP1 (RS1).
 */

import { launchStatus } from "@/lib/creative/hitRate";
import { delta as relativeDelta } from "@/lib/period";
import { TOTAL_BUCKET, type ComponentRow, type ComponentSum, type EvaluateModule, type EvaluateWidget, type MartGuards, type ResolvedWidget } from "./contracts";
import { SERIES_SLOTS } from "./limits";
import { notConnectedReason } from "./registry/capabilities";
import { clientCaveats, orderCaveats } from "./registry/caveats";
import { CLASSES_COMPONENT, MARTS, getComponent } from "./registry/components";
import type { MetricId } from "./registry/ids";
import { METRICS } from "./registry/metrics";
import type { Capability, CaveatId, ComponentDef, ComponentId, MartDef, MartId, RegisteredMetric, ReportClient, Term } from "./registry/types";
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

/** Row guards of one mart inside a row group. Each mart CTE has its own currency column and FX joins. */
interface MartAgg {
  fxMissing: boolean;
  fxMonths: Set<string>;
  foreignRows: number;
}

/** Summed rows of one client for one row group (a bucket or a whole period). */
interface Agg {
  values: Map<ComponentId, ComponentSum>;
  /** Guards per mart: a component reads only its own mart's FX and currency guards. */
  marts: Map<MartId, MartAgg>;
  nRows: number;
}

function emptyAgg(): Agg {
  return { values: new Map(), marts: new Map(), nRows: 0 };
}

function martAgg(agg: Agg, mart: MartId): MartAgg {
  let g = agg.marts.get(mart);
  if (!g) {
    g = { fxMissing: false, fxMonths: new Set(), foreignRows: 0 };
    agg.marts.set(mart, g);
  }
  return g;
}

/** Rows in another currency that deserve the caveat: marts whose money is in the ad account currency are converted by design and not flagged. */
function flaggedForeignRows(agg: Agg): number {
  let n = 0;
  for (const [mart, g] of agg.marts) if (!(MARTS[mart] as MartDef).accountCurrency) n += g.foreignRows;
  return n;
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

/** Missing-day label for a gap cell (two words, design copy policy). */
export const GAP_REASON = "Missing days";

function addSums(prev: ComponentSum | undefined, v: ComponentSum): ComponentSum {
  const p = prev ?? { nat: null, disp: null, natNulls: 0, dispNulls: 0 };
  return {
    nat: addN(p.nat, num(v.nat)),
    disp: addN(p.disp, num(v.disp)),
    natNulls: (p.natNulls ?? 0) + (v.natNulls ?? 0),
    dispNulls: (p.dispNulls ?? 0) + (v.dispNulls ?? 0),
  };
}

function addRow(agg: Agg, row: ComponentRow): void {
  for (const [mart, g] of Object.entries(row.guards) as Array<[MartId, MartGuards | undefined]>) {
    if (!g) continue;
    agg.nRows += g.nRows;
    const ma = martAgg(agg, mart);
    ma.foreignRows += g.foreignCcyRows;
    if (g.fxMissingRows > 0) {
      ma.fxMissing = true;
      for (const m of g.fxMissingMonths) ma.fxMonths.add(m);
    }
  }
  for (const [id, v] of Object.entries(row.values) as Array<[ComponentId, ComponentSum | undefined]>) {
    if (!v) continue;
    agg.values.set(id, addSums(agg.values.get(id), v));
  }
}

function mergeAggs(aggs: Iterable<Agg>): Agg {
  const out = emptyAgg();
  for (const a of aggs) {
    out.nRows += a.nRows;
    for (const [mart, g] of a.marts) {
      const o = martAgg(out, mart);
      o.foreignRows += g.foreignRows;
      if (g.fxMissing) o.fxMissing = true;
      for (const m of g.fxMonths) o.fxMonths.add(m);
    }
    for (const [id, v] of a.values) {
      out.values.set(id, addSums(out.values.get(id), v));
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
  /** The component has NULL rows (`nullMeans: "gap"`) in this row group, so its sum is partial. Absent means false. */
  gap?: boolean;
}

/** One client's value of one component in one row group. */
function readComponent(agg: Agg, id: ComponentId, mode: ReadMode, client: ReportClient, displayCurrency: string): Read {
  const def = getComponent(id);
  const r = readRaw(agg, id, def, mode, client, displayCurrency);
  if (def.perClientRate === undefined || r.value === null) return r;
  // Stated per-order cost: the summed orders (native or converted per month) times this client's rate. Unstated = 0, as on Snapshot.
  return { ...r, value: r.value * (client.costRates?.[def.perClientRate] ?? 0) };
}

function readRaw(agg: Agg, id: ComponentId, def: ComponentDef, mode: ReadMode, client: ReportClient, displayCurrency: string): Read {
  const v = agg.values.get(id);
  const isGap = (nulls: number | undefined) => def.nullMeans === "gap" && (nulls ?? 0) > 0;
  if (!def.money) return { value: v ? (v.nat ?? v.disp) : null, fx: false, gap: v ? isGap(v.natNulls) : false };
  if (mode === "native") return { value: v ? v.nat : null, fx: false, gap: v ? isGap(v.natNulls) : false };
  // Guards of this component's own mart (an EUR shop can have a CZK Meta account).
  const g = agg.marts.get(def.mart);
  // Same currency and no foreign rows: the native sum is the display sum, no rate needed.
  if (client.currency === displayCurrency && (g?.foreignRows ?? 0) === 0) return { value: v ? v.nat : null, fx: false, gap: v ? isGap(v.natNulls) : false };
  if (g?.fxMissing) return { value: null, fx: true };
  return { value: v ? v.disp : null, fx: false, gap: v ? isGap(v.dispNulls) : false };
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
    // Partly costed: a day with revenue and no cost value inside the sum (counted in SQL only where the guard is > 0).
    if (v && ((v.natNulls ?? 0) > 0 || (v.dispNulls ?? 0) > 0)) return true;
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
    // NULL rows inside the sum make it partial: a gap term nulls the metric, a zero term keeps the valued rows.
    if (r.gap === true && term.nullAs === "gap") gap = true;
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
// Entity marts: classify each entity row before anything is summed
// ---------------------------------------------------------------------------

/** Status words of a cell whose client has no creative thresholds in Settings. */
export const NO_THRESHOLDS = "No thresholds";

/** The creative_hit classifier's inputs and outputs (registry/components.ts, mart ad_launch). */
const HIT = {
  purchases: "ad_launch.purchases",
  spend: "ad_launch.spend",
  revenue: "ad_launch.revenue",
  ageDays: "ad_launch.age_days",
  priorRoas: "ad_launch.prior_roas",
  launched: "ad_launch.launched",
  winners: "ad_launch.winners",
  open: "ad_launch.open",
} as const satisfies Record<string, ComponentId>;

/** The classified component that counts entities still open (the current period is maturing while it is > 0). */
const MATURING_COMPONENT: ComponentId = HIT.open;

const ENTITY_MARTS: readonly MartDef[] = (Object.values(MARTS) as MartDef[]).filter((m) => m.entity !== undefined);

const count = (n: number): ComponentSum => ({ nat: n, disp: n, natNulls: 0, dispNulls: 0 });

/** One ad of the launch cohort mart -> launched, winners and open, against the client's own thresholds. */
function classifyCreativeHit(values: ComponentRow["values"], client: ReportClient | undefined): Partial<Record<ComponentId, ComponentSum>> {
  const read = (id: ComponentId): number | null => {
    const v = values[id];
    return v ? num(v.nat) ?? num(v.disp) : null;
  };
  const out: Partial<Record<ComponentId, ComponentSum>> = { [HIT.launched]: count(1) };
  const t = client?.creativeThresholds ?? null;
  // Without thresholds there is no winner and no open count: a 0 would be a claim, and a false one.
  if (t === null) return out;
  const status = launchStatus(
    {
      adId: "",
      adName: "",
      firstDate: "",
      ageDays: read(HIT.ageDays) ?? 0,
      spend: read(HIT.spend) ?? 0,
      revenue: read(HIT.revenue) ?? 0,
      purchases: read(HIT.purchases) ?? 0,
      isVideo: false,
      // Relaunches and pre-existing ads were left out in SQL (MartDef.entity.exclude).
      isRelaunch: false,
      isPreexisting: false,
      conceptId: null,
      conceptName: null,
      priorRoas: read(HIT.priorRoas),
    },
    t
  );
  out[HIT.winners] = count(status === "winner" ? 1 : 0);
  out[HIT.open] = count(status === "open" ? 1 : 0);
  return out;
}

/**
 * Rows in, rows out: on a row of an entity mart (its n_rows guard > 0) the
 * mart's inputs are replaced by the classifier's outputs; on every other row
 * the (NULL) inputs are dropped. Never mutates the input rows: they are the
 * cached run result. Rows without an entity mart pass through untouched.
 */
export function classifyEntityRows(rows: readonly ComponentRow[], clients: ReadonlyMap<string, ReportClient>): ComponentRow[] {
  if (ENTITY_MARTS.length === 0) return [...rows];
  return rows.map((row) => {
    let values: ComponentRow["values"] | null = null;
    for (const mart of ENTITY_MARTS) {
      const inputs = (Object.keys(row.values) as ComponentId[]).filter((id) => getComponent(id).mart === mart.id);
      const isEntityRow = (row.guards[mart.id]?.nRows ?? 0) > 0;
      if (inputs.length === 0 && !isEntityRow) continue;
      values ??= { ...row.values };
      for (const id of inputs) delete values[id];
      if (!isEntityRow) continue;
      switch (mart.entity!.classifier) {
        case "creative_hit":
          Object.assign(values, classifyCreativeHit(row.values, clients.get(row.clientId)));
          break;
      }
    }
    return values === null ? row : { ...row, values };
  });
}

/** True when the metric reads a classified component that only the client's thresholds can decide. */
function needsThresholds(metric: RegisteredMetric): boolean {
  return metric.meta.components.some((c) => getComponent(c).classified?.needsThresholds === true);
}

/** True when the metric is a lower bound while entities are still open (winners, hit rate). */
function isLowerBound(metric: RegisteredMetric): boolean {
  return metric.meta.components.some((c) => getComponent(c).classified?.lowerBound === true);
}

/** Open entities summed over the members' row groups (0 without any). */
function openOf(members: readonly Member[]): number {
  let n = 0;
  for (const m of members) n += num(m.agg?.values.get(MATURING_COMPONENT)?.nat) ?? 0;
  return n;
}

/** One component summed over the members' row groups (null when none has a value). */
function sumOf(members: readonly Member[], id: ComponentId): number | null {
  let n: number | null = null;
  for (const m of members) {
    const v = m.agg?.values.get(id);
    const x = v ? (num(v.nat) ?? num(v.disp)) : null;
    if (x !== null) n = (n ?? 0) + x;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Cohort retention rules (MetricBase.cohort)
// ---------------------------------------------------------------------------

/** Status words: the client has no rows in ref.product_classes, so discovery entrants cannot be told apart. */
export const NOT_CLASSIFIED = "Products not classified";
/** Status words: customers in the period, none of them observed for the horizon yet. */
export const NOT_MATURE = "Not mature yet";
/** Status words: fewer than minN customers observed for the horizon. */
export const TOO_FEW = "Too few customers";

/** Population and denominator of a cohort metric, summed over the members (0 when absent). */
function cohortCounts(metric: RegisteredMetric, members: readonly Member[]): { population: number; denominator: number } | null {
  if (!metric.cohort || metric.kind !== "ratio") return null;
  return { population: sumOf(members, metric.cohort.population) ?? 0, denominator: sumOf(members, metric.denominator[0].c) ?? 0 };
}

/** A member whose client has no product classes in this row group. */
function notClassified(metric: RegisteredMetric, m: Member): boolean {
  return metric.cohort?.needsClasses === true && (sumOf([m], CLASSES_COMPONENT) ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

type Status = Exclude<CellStatus, "not_connected">;

interface Outcome {
  value: number | null;
  status: Status;
  fxMonths: string[];
  /** Overrides the default status label (gap cells: "Missing days"). */
  reason?: string;
}

const NO_ROWS: Outcome = { value: null, status: "no_data", fxMonths: [] };

/** One group of clients (one client for a client series) evaluated on one row group. */
interface Member {
  client: ReportClient;
  agg: Agg | undefined;
  /** Guard failures in finer row groups that this aggregate covers (strict totals). */
  innerGuardFail: boolean;
}

/**
 * `pooled` false: the members are one client checked for a rollup, so the
 * cohort count rules (not mature, too few) are left to the pooled cell.
 */
function outcome(metric: RegisteredMetric, members: readonly Member[], mode: ReadMode, displayCurrency: string, pooled = true): Outcome {
  const present = members.filter((m) => m.agg !== undefined) as Array<Member & { agg: Agg }>;
  if (present.length === 0) return NO_ROWS;
  const fxMonths = new Set<string>();
  let fx = false;
  const summed = new Map<ComponentId, Read>();
  for (const id of metric.meta.components) {
    let value: number | null = null;
    let compFx = false;
    let compGap = false;
    for (const m of present) {
      const r = readComponent(m.agg, id, mode, m.client, displayCurrency);
      if (r.fx) {
        compFx = true;
        for (const mo of m.agg.marts.get(getComponent(id).mart)?.fxMonths ?? []) fxMonths.add(mo);
      }
      if (r.gap === true) compGap = true;
      value = addN(value, r.value);
    }
    if (compFx) fx = true;
    summed.set(id, { value: compFx ? null : value, fx: compFx, gap: compGap });
  }
  if (fx) return { value: null, status: "fx_missing", fxMonths: [...fxMonths].sort() };
  // Hit rate without the client's own bar: not measured, never a zero.
  if (needsThresholds(metric) && present.some((m) => !m.client.creativeThresholds)) return { value: null, status: "not_measured", fxMonths: [], reason: NO_THRESHOLDS };
  if (present.some((m) => m.innerGuardFail || guardFails(m.agg, metric))) return { value: null, status: "not_measured", fxMonths: [] };
  // Cohort retention: discovery metrics need the client's product classes; small or immature cohorts are not a rate.
  if (present.some((m) => notClassified(metric, m))) return { value: null, status: "not_measured", fxMonths: [], reason: NOT_CLASSIFIED };
  const cc = pooled ? cohortCounts(metric, present) : null;
  if (cc && metric.cohort) {
    if (cc.denominator === 0 && cc.population > 0) return { value: null, status: "not_measured", fxMonths: [], reason: NOT_MATURE };
    if (cc.denominator > 0 && cc.denominator < metric.cohort.minN) return { value: null, status: "not_measured", fxMonths: [], reason: TOO_FEW };
  }
  const r = evaluateFormula(metric, (c) => summed.get(c) ?? { value: null, fx: false });
  if (r.value === null) {
    // A NULL-day gap in a component a gap term needs (any client of a rollup): no partial sum.
    const terms = metric.kind === "sum" ? metric.terms : [...metric.numerator, ...metric.denominator];
    const gapped = terms.some((term) => term.nullAs === "gap" && summed.get(term.c)?.gap === true);
    return gapped ? { value: null, status: "no_data", fxMonths: [], reason: GAP_REASON } : { value: null, status: "no_data", fxMonths: [] };
  }
  return { value: r.value, status: "ok", fxMonths: [] };
}

/** A client left out of a rollup cell, with its own status for that row group. */
interface Exclusion {
  client: ReportClient;
  status: Status;
  reason: string;
  fxMonths: string[];
}

interface RollupOutcome extends Outcome {
  /** Clients summed into the value. A member without rows counts as summed (it adds nothing). */
  kept: ReportClient[];
  excluded: Exclusion[];
}

/** A client cell that must not be summed into a rollup: a gap, fx_missing or not_measured. */
function isExcluded(o: Outcome): boolean {
  return o.status === "fx_missing" || o.status === "not_measured" || (o.status === "no_data" && o.reason === GAP_REASON);
}

/**
 * Rollup of several clients on one row group. Each member is evaluated on its
 * own first; members that are a gap, fx_missing or not_measured are left out
 * entirely and the rest are summed component by component.
 */
function rollupOutcome(metric: RegisteredMetric, members: readonly Member[], displayCurrency: string): RollupOutcome {
  const kept: Member[] = [];
  const excluded: Exclusion[] = [];
  for (const m of members) {
    const own = outcome(metric, [m], "display", displayCurrency, false);
    if (isExcluded(own)) {
      excluded.push({
        client: m.client,
        status: own.status,
        reason: own.status === "fx_missing" ? fxReason(own.fxMonths) : (own.reason ?? CELL_STATUS_LABEL[own.status as Exclude<Status, "ok">]),
        fxMonths: own.fxMonths,
      });
    } else kept.push(m);
  }
  if (kept.length === 0) {
    if (excluded.length === 0) return { ...NO_ROWS, kept: [], excluded };
    // Nothing left to sum: the shared status of the excluded clients, else no_data.
    const first = excluded[0];
    const sameStatus = excluded.every((e) => e.status === first.status);
    const sameReason = sameStatus && excluded.every((e) => e.reason === first.reason);
    const fxMonths = sameStatus && first.status === "fx_missing" ? [...new Set(excluded.flatMap((e) => e.fxMonths))].sort() : [];
    return {
      value: null,
      status: sameStatus ? first.status : "no_data",
      fxMonths,
      ...(sameReason && first.status !== "fx_missing" ? { reason: first.reason } : {}),
      kept: [],
      excluded,
    };
  }
  return { ...outcome(metric, kept, "display", displayCurrency), kept: kept.map((m) => m.client), excluded };
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
  for (const row of classifyEntityRows(rows, known)) {
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
      if (d && (flaggedForeignRows(d.cur.total) > 0 || flaggedForeignRows(d.cmp.total) > 0)) caveats.add("foreign_currency_rows");
      if (d && (num(d.cur.total.values.get(MATURING_COMPONENT)?.nat) ?? 0) > 0) caveats.add("cohort_maturing");
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
      const memberOf = (client: ReportClient, period: "cur" | "cmp", bucket: string | null): Member => {
        const p = periodOf(client.id, period);
        if (!p) return { client, agg: undefined, innerGuardFail: false };
        if (bucket !== null) return { client, agg: p.buckets.get(bucket), innerGuardFail: false };
        let inner = false;
        for (const a of p.buckets.values()) if (guardFails(a, metric)) inner = true;
        return { client, agg: p.total.nRows > 0 || p.total.values.size > 0 ? p.total : undefined, innerGuardFail: inner };
      };
      const members = (clients: readonly ReportClient[], period: "cur" | "cmp", bucket: string | null): Member[] =>
        clients.map((c) => memberOf(c, period, bucket));

      let cur: Outcome;
      let compareTotal: number | null = null;
      let curPoints: Outcome[] | null = null;
      let cmpPoints: Array<number | null> | null = null;
      let pointCoverage: number[] | undefined;
      let rollupCoverage: { included: number; of: number } | undefined;
      let excluded: Exclusion[] = [];
      /** Open launches in the current and comparison totals of the clients summed (maturity, HR3). */
      let maturing = { cur: 0, cmp: 0 };
      /** Members of the current total (the clients summed in it), for the "W of n" counts. */
      let curTotalMembers: Member[] = [];
      const collectFx = (o: Outcome) => {
        if (o.status === "fx_missing") for (const m of o.fxMonths) fxWarningMonths.add(m);
      };
      const collectExcludedFx = (r: RollupOutcome) => {
        for (const e of r.excluded) if (e.status === "fx_missing") for (const m of e.fxMonths) fxWarningMonths.add(m);
      };

      if (isClient) {
        curTotalMembers = members(included, "cur", null);
        cur = outcome(metric, curTotalMembers, mode, display);
        const cmp = cmpRange ? outcome(metric, members(included, "cmp", null), mode, display) : null;
        if (cur.status === "ok" && cmp && cmp.status === "ok") compareTotal = cmp.value;
        maturing = { cur: openOf(members(included, "cur", null)), cmp: cmpRange ? openOf(members(included, "cmp", null)) : 0 };
        if (grain !== "total") curPoints = rowKeys.map((b) => outcome(metric, members(included, "cur", b), mode, display));
        if (grain !== "total" && cmpRange) {
          const cmpOs = buckets.map((_, i) => (i < cmpRowKeys.length ? outcome(metric, members(included, "cmp", cmpRowKeys[i]), mode, display) : NO_ROWS));
          for (const o of cmpOs) collectFx(o);
          cmpPoints = cmpOs.map((o) => o.value);
        }
        for (const o of [cur, cmp, ...(curPoints ?? [])]) if (o) collectFx(o);
      } else {
        const curR = rollupOutcome(metric, members(included, "cur", null), display);
        cur = curR;
        excluded = curR.excluded;
        collectFx(curR);
        collectExcludedFx(curR);
        rollupCoverage = { included: curR.kept.length, of: group.clients.length };
        curTotalMembers = members(curR.kept, "cur", null);
        if (cmpRange) {
          // Like for like: the comparison sums exactly the clients of the current total.
          const cmpR = rollupOutcome(metric, members(curR.kept, "cmp", null), display);
          collectExcludedFx(cmpR);
          if (curR.status === "ok" && cmpR.status === "ok" && cmpR.excluded.length === 0) compareTotal = cmpR.value;
          maturing = { cur: openOf(members(curR.kept, "cur", null)), cmp: openOf(members(curR.kept, "cmp", null)) };
        }
        if (grain !== "total") {
          const curRs = rowKeys.map((b) => rollupOutcome(metric, members(included, "cur", b), display));
          for (const r of curRs) {
            collectFx(r);
            collectExcludedFx(r);
          }
          curPoints = curRs;
          pointCoverage = curRs.map((r) => r.kept.length);
          if (cmpRange) {
            cmpPoints = buckets.map((_, i) => {
              if (i >= cmpRowKeys.length || curRs[i].kept.length === 0) return null;
              const r = rollupOutcome(metric, members(curRs[i].kept, "cmp", cmpRowKeys[i]), display);
              collectExcludedFx(r);
              return r.excluded.length === 0 ? r.value : null;
            });
          }
        }
      }

      const ok = cur.status === "ok";
      let delta: number | null = null;
      let deltaSuppressed = false;
      if (ok && cur.value !== null && compareTotal !== null) {
        delta = deltaKind === "pp" ? cur.value - compareTotal : relativeDelta(cur.value, compareTotal);
        // A maturing current cohort against a settled one: the older cohorts had more time to win, so no delta.
        // Flagged on the cell: the "123" view rebuilds the change from the two totals and must not.
        if (isLowerBound(metric) && maturing.cur > 0 && maturing.cmp === 0) {
          delta = null;
          deltaSuppressed = true;
        }
      }
      // Cohort retention caveats, on the counts of the current total (the clients summed in it).
      if (ok && metric.cohort) {
        const cc = cohortCounts(metric, curTotalMembers);
        if (cc && cc.denominator < metric.cohort.lowN) caveats.add("low_n");
        if (cc && cc.population > cc.denominator) caveats.add("cohort_partial");
      }
      let counts: MetricCell["counts"];
      if (ok && metric.showCounts && metric.kind === "ratio") {
        const part = sumOf(curTotalMembers, metric.numerator[0].c);
        const whole = sumOf(curTotalMembers, metric.denominator[0].c);
        if (part !== null && whole !== null) counts = { part, whole, noun: metric.showCounts.noun };
      }
      const notConnected = group.clients
        .filter((c) => widget.availability[c.id]?.[id]?.ok !== true)
        .map((c) => ({ id: c.id, name: c.name, reason: notConnectedReason([...(widget.availability[c.id]?.[id]?.missing ?? [])]) }));
      const excludedList = isClient ? [] : [...notConnected, ...excluded.map((e) => ({ id: e.client.id, name: e.client.name, reason: e.reason }))];
      const cell: MetricCell = {
        status: cur.status,
        ...(cur.status !== "ok" ? { reason: cur.status === "fx_missing" ? fxReason(cur.fxMonths) : (cur.reason ?? CELL_STATUS_LABEL[cur.status]) } : {}),
        ...(cur.status === "fx_missing" ? { fxMonths: cur.fxMonths } : {}),
        total: ok ? cur.value : null,
        compareTotal: ok ? compareTotal : null,
        delta,
        deltaKind,
        ...(deltaSuppressed ? { deltaSuppressed } : {}),
        ...(counts ? { counts } : {}),
        ...(curPoints ? { points: curPoints.map((o) => o.value) } : {}),
        ...(cmpPoints ? { comparePoints: cmpPoints } : {}),
        ...(rollupCoverage ? { coverage: rollupCoverage } : {}),
        ...(excludedList.length > 0 ? { excluded: excludedList } : {}),
        ...(pointCoverage ? { pointCoverage } : {}),
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
