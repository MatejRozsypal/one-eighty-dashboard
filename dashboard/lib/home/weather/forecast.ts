import "server-only";

/**
 * Home, Forecast variant: everything the page reads, in one call.
 *
 * ── Where each reading comes from ─────────────────────────────────────────
 * Hero, list     `getHomeData()` (lib/home/queries.ts), unchanged: the month's
 *                Goals pacing rows per client, with the warehouse's own status,
 *                pace, projection and 80% cone; ClickUp for the retainers.
 * Daily strip    The `day` rows of mart.plan_pacing for the same month: the
 *                daily plan curve and the day's actual, per client. Summed here
 *                over the clients with a plan, in one currency.
 * Meta spend     The `ad_spend` month rows of mart.plan_pacing (pace and status).
 * Creative queue mart.mart_velocity_queue (ClickUp ad tasks by bucket).
 * Unmapped ads   mart.mart_creative_unmapped, the queue on the Creative page.
 * Freshness      ops.v_feed_health, the hourly feed check.
 *
 * ── Never a guessed number ─────────────────────────────────────────────────
 * The page adds and divides warehouse figures, nothing more. A day's sum is
 * shown only when every client in it has the figure; otherwise it is n/a with
 * the reason. A source that cannot be read leaves its tile n/a and logs why;
 * it never takes Home down.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import { isMissingObject } from "@/lib/queries/errors";
import { PACING_COLUMNS, toPacingRow, withFallback } from "@/lib/queries/plan";
import { getVelocityQueues } from "@/lib/queries/velocity";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { planStatusLabel, planStatusTone } from "@/lib/plan/health";
import type { PacingRow } from "@/lib/plan/types";
import { getHomeData } from "@/lib/home/queries";
import type { ClientHealth, HomeData, SourceState } from "@/lib/home/types";
import type {
  FeedLine,
  FeedTile,
  ForecastData,
  QueueTile,
  SpendTile,
  StripData,
  StripDay,
  StripMetric,
  StripSeries,
  UnmappedTile,
} from "./model";

type Raw = Record<string, unknown>;

const T = (dataset: string, table: string) => `\`${PROJECT_ID}.${dataset}.${table}\``;

/* ------------------------------------------------------------------------ */
/* Tolerant reads                                                           */
/* ------------------------------------------------------------------------ */

interface Read<T> {
  state: SourceState;
  rows: T[];
}

/** A read whose failure leaves its tile n/a: logged, never thrown. */
async function readState<T>(label: string, run: () => Promise<T[]>): Promise<Read<T>> {
  try {
    const rows = await run();
    return { state: rows.length === 0 ? "empty" : "ok", rows };
  } catch (error) {
    if (isMissingObject(error)) return { state: "missing", rows: [] };
    const message = String((error as { message?: string } | null)?.message ?? error);
    console.error(`[home/forecast] ${label} unreadable: ${message}`);
    return { state: /permission|access denied/i.test(message) ? "denied" : "error", rows: [] };
  }
}

function unreadable(source: string, state: SourceState): string | null {
  if (state === "denied") return `No read access to ${source}.`;
  if (state === "missing") return `${source} does not exist.`;
  if (state === "error") return `${source} could not be read.`;
  return null;
}

/* ------------------------------------------------------------------------ */
/* Reads                                                                    */
/* ------------------------------------------------------------------------ */

interface DayRow {
  clientId: string;
  date: string;
  metric: StripMetric;
  target: number | null;
  actual: number | null;
  started: boolean;
  measured: boolean;
}

/** The day rows of each client's current month (the month of its as of). */
async function fetchDayRows(): Promise<DayRow[]> {
  const read = (measured: boolean) =>
    query<Raw>(
      `SELECT client_id, period_id, metric, target_total, actual_to_date, status,
              ${measured ? "is_measured" : "TRUE AS is_measured"}
       FROM ${PLAN_TABLES.pacing}
       WHERE period_type = 'day' AND metric IN ('revenue', 'cm3')
         AND SAFE.PARSE_DATE('%F', period_id) BETWEEN DATE_TRUNC(as_of, MONTH) AND LAST_DAY(as_of)`
    );
  const rows = await withFallback(
    () => read(true),
    () => read(false)
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    date: String(r.period_id),
    metric: String(r.metric) as StripMetric,
    target: num(r.target_total),
    actual: num(r.actual_to_date),
    started: String(r.status) !== "not_started",
    measured: r.is_measured !== false,
  }));
}

/** Ad spend against this month's plan, per client. */
async function fetchSpendRows(): Promise<Array<PacingRow & { clientId: string }>> {
  const rows = await query<Raw>(
    `SELECT client_id, ${PACING_COLUMNS}
     FROM ${PLAN_TABLES.pacing}
     WHERE period_type = 'month' AND period_id = FORMAT_DATE('%Y-%m', as_of) AND metric = 'ad_spend'`
  );
  return rows.map((r) => ({ ...toPacingRow(r), clientId: String(r.client_id) }));
}

async function fetchUnmapped(): Promise<Array<{ clientId: string; ads: number }>> {
  // Ads that ran before the client had a ClickUp ad pipeline never had a
  // brief to match, so they are left out, as on the Creative page.
  const rows = await query<Raw>(
    `SELECT client_id, COUNT(*) AS ads
     FROM ${T("mart", "mart_creative_unmapped")}
     WHERE NOT before_pipeline
     GROUP BY client_id`
  );
  return rows.map((r) => ({ clientId: String(r.client_id), ads: num(r.ads) ?? 0 }));
}

interface FeedRow {
  clientId: string;
  feed: string;
  status: string;
  stalenessHours: number | null;
  maxHours: number | null;
  checkedAt: string | null;
}

async function fetchFeeds(): Promise<FeedRow[]> {
  const rows = await query<Raw>(
    `SELECT client_id, feed_key, status, staleness_hours, max_staleness_hours,
            FORMAT_TIMESTAMP('%FT%TZ', checked_at) AS checked_at
     FROM ${T("ops", "v_feed_health")}`
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    feed: String(r.feed_key),
    status: String(r.status ?? "unknown"),
    stalenessHours: num(r.staleness_hours),
    maxHours: num(r.max_staleness_hours),
    checkedAt: r.checked_at ? String(r.checked_at) : null,
  }));
}

/* ------------------------------------------------------------------------ */
/* Assembly                                                                 */
/* ------------------------------------------------------------------------ */

/** Sum of every value, or null when any is missing. */
function sumAll(values: Array<number | null | undefined>): number | null {
  if (!values.length || values.some((v) => v === null || v === undefined || !Number.isFinite(v))) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/**
 * The currency most of these clients trade in; ties go to CZK, then A to Z.
 * Only one currency is ever summed.
 */
function mainCurrency(currencies: string[]): string | null {
  const counts = new Map<string, number>();
  for (const c of currencies) counts.set(c, (counts.get(c) ?? 0) + 1);
  return (
    [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || Number(b[0] === "CZK") - Number(a[0] === "CZK") || a[0].localeCompare(b[0])
    )[0]?.[0] ?? null
  );
}

/** Every date from `start` to `end`, inclusive. */
function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime())) return out;
  while (d <= last && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function planRow(c: ClientHealth, metric: StripMetric): PacingRow | null {
  return metric === "revenue" ? c.revenue.row : c.cm3.row;
}

function buildSeries(metric: StripMetric, dates: string[], dayRows: DayRow[], home: HomeData): StripSeries | null {
  const planned = home.clients.filter((c) => c.clientId && c.currency && planRow(c, metric));
  if (!planned.length || !dates.length) return null;
  const currency = mainCurrency(planned.map((c) => c.currency as string));
  if (!currency) return null;
  const inSeries = planned.filter((c) => c.currency === currency);
  const ids = new Set(inSeries.map((c) => c.clientId as string));

  const byDate = new Map<string, DayRow[]>();
  for (const r of dayRows) {
    if (r.metric !== metric || !ids.has(r.clientId)) continue;
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  const days: StripDay[] = dates.map((date) => {
    const rows = byDate.get(date) ?? [];
    const complete = rows.length === ids.size;
    const started = rows.filter((r) => r.started).length;
    const state: StripDay["state"] = complete && started === ids.size ? "past" : started === 0 ? "future" : "partial";
    const target = complete ? sumAll(rows.map((r) => r.target)) : null;
    let actual: number | null = null;
    let note: string | null = null;
    if (state === "past") {
      const unmeasured = rows.filter((r) => !r.measured || r.actual === null);
      if (unmeasured.length) {
        const names = unmeasured.map((r) => inSeries.find((c) => c.clientId === r.clientId)?.name ?? r.clientId);
        note = metric === "cm3" ? `No cost data for ${names.join(", ")} on this day.` : `No actual for ${names.join(", ")} on this day.`;
      } else {
        actual = sumAll(rows.map((r) => r.actual));
      }
    } else if (state === "partial") {
      note = "Not every client has data for this day yet.";
    }
    return { date, state, target, actual, note };
  });

  const rows = inSeries.map((c) => planRow(c, metric) as PacingRow);
  return {
    metric,
    currency,
    clients: inSeries.map((c) => c.name),
    excluded: planned.filter((c) => c.currency !== currency).map((c) => c.name),
    days,
    monthActual: sumAll(rows.map((r) => (r.isMeasured ? r.actual : null))),
    monthTargetToDate: sumAll(rows.map((r) => r.targetToDate)),
    monthTarget: sumAll(rows.map((r) => r.target)),
  };
}

function buildStrip(read: Read<DayRow>, home: HomeData): StripData {
  const dayRows = read.rows;
  const month = home.clients.map((c) => c.focus ?? c.revenue.row ?? c.cm3.row).find((r) => r && r.start && r.end) ?? null;
  const fromRows = [...new Set(dayRows.map((r) => r.date))].sort();
  const dates = month ? datesBetween(month.start, month.end) : fromRows;
  const gap = unreadable("the day rows of mart.plan_pacing", read.state);
  return {
    monthLabel: month?.label ?? home.clients.find((c) => c.monthLabel)?.monthLabel ?? null,
    dates,
    revenue: gap ? null : buildSeries("revenue", dates, dayRows, home),
    cm3: gap ? null : buildSeries("cm3", dates, dayRows, home),
    note: gap,
  };
}

function buildSpend(rows: Array<PacingRow & { clientId: string }>, home: HomeData): SpendTile {
  const targeted = rows.filter((r) => r.target !== null && r.status !== "no_target");
  const known = new Map(home.clients.filter((c) => c.clientId).map((c) => [c.clientId as string, c]));
  const lines = targeted
    .map((r) => ({
      clientId: r.clientId,
      name: known.get(r.clientId)?.name ?? r.clientId,
      pacePct: r.pacePct,
      tone: planStatusTone(r.status, "ad_spend", r.result),
      statusLabel: planStatusLabel(r),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!targeted.length) {
    return { lines, combinedPct: null, currency: null, note: "No client has an ad spend target in this month's Goals plan." };
  }
  const currency = mainCurrency(targeted.map((r) => known.get(r.clientId)?.currency ?? "").filter(Boolean));
  const same = targeted.filter((r) => known.get(r.clientId)?.currency === currency);
  const actual = sumAll(same.map((r) => r.actual));
  const toDate = sumAll(same.map((r) => r.targetToDate));
  const combinedPct = actual !== null && toDate !== null && toDate > 0 ? (100 * actual) / toDate : null;
  return {
    lines,
    combinedPct,
    currency,
    note: combinedPct === null ? "Ad spend or its plan to date is missing for a client with a target." : null,
  };
}

async function readQueues(): Promise<Read<{ clientId: string; ready: number; inWorks: number; briefing: number }>> {
  return readState("mart_velocity_queue", async () => {
    const map = await getVelocityQueues();
    return [...map.entries()].map(([clientId, q]) => ({ clientId, ...q }));
  });
}

function nameOf(home: HomeData, clientId: string): string {
  return home.clients.find((c) => c.clientId === clientId)?.name ?? clientId;
}

function buildQueue(read: Awaited<ReturnType<typeof readQueues>>, home: HomeData): QueueTile {
  const gap = unreadable("mart_velocity_queue", read.state);
  if (gap) return { state: read.state, lines: [], queued: null, briefing: null, note: gap };
  if (read.state === "empty") {
    return { state: read.state, lines: [], queued: null, briefing: null, note: "No client has ClickUp ad tasks in mart_velocity_queue." };
  }
  const lines = read.rows
    .map((r) => ({ ...r, name: nameOf(home, r.clientId) }))
    .sort((a, b) => b.ready + b.inWorks - (a.ready + a.inWorks) || a.name.localeCompare(b.name));
  return {
    state: read.state,
    lines,
    queued: lines.reduce((s, l) => s + l.ready + l.inWorks, 0),
    briefing: lines.reduce((s, l) => s + l.briefing, 0),
    note: null,
  };
}

function buildUnmapped(read: Read<{ clientId: string; ads: number }>, home: HomeData): UnmappedTile {
  const gap = unreadable("mart_creative_unmapped", read.state);
  if (gap) return { state: read.state, lines: [], total: null, note: gap };
  const lines = read.rows
    .map((r) => ({ ...r, name: nameOf(home, r.clientId) }))
    .sort((a, b) => b.ads - a.ads || a.name.localeCompare(b.name));
  // An empty result is a real zero: the view lists every unmapped ad there is.
  return { state: read.state, lines, total: lines.reduce((s, l) => s + l.ads, 0), note: null };
}

/** Never first, then stale by how far past its limit, then the rest. */
function feedRank(f: FeedLine): number {
  if (f.status === "never") return 1e9;
  if (f.stalenessHours !== null && f.maxHours) return f.stalenessHours / f.maxHours;
  return 0;
}

function buildFeeds(read: Read<FeedRow>, home: HomeData): FeedTile {
  const gap = unreadable("ops.v_feed_health", read.state);
  if (gap) return { state: read.state, total: null, ok: null, issues: [], checkedAt: null, note: gap };
  if (read.state === "empty") {
    return { state: read.state, total: null, ok: null, issues: [], checkedAt: null, note: "ops.v_feed_health has no check in the last 3 days." };
  }
  const issues: FeedLine[] = read.rows
    .filter((r) => r.status !== "ok")
    .map((r) => ({
      clientId: r.clientId,
      name: nameOf(home, r.clientId),
      feed: r.feed,
      status: r.status,
      stalenessHours: r.stalenessHours,
      maxHours: r.maxHours,
    }))
    .sort((a, b) => feedRank(b) - feedRank(a) || a.name.localeCompare(b.name));
  const checkedAt = read.rows.map((r) => r.checkedAt).filter((v): v is string => !!v).sort().pop() ?? null;
  return {
    state: read.state,
    total: read.rows.length,
    ok: read.rows.filter((r) => r.status === "ok").length,
    issues,
    checkedAt,
    note: null,
  };
}

export async function getForecastData(): Promise<ForecastData> {
  const [home, dayRows, spendRows, queues, unmapped, feeds] = await Promise.all([
    getHomeData(),
    readState("plan_pacing day rows", fetchDayRows),
    readState("plan_pacing ad spend rows", fetchSpendRows),
    readQueues(),
    readState("mart_creative_unmapped", fetchUnmapped),
    readState("ops.v_feed_health", fetchFeeds),
  ]);

  const spend = buildSpend(spendRows.rows, home);
  const spendGap = unreadable("mart.plan_pacing", spendRows.state);

  return {
    home,
    strip: buildStrip(dayRows, home),
    spend: spendGap ? { lines: [], combinedPct: null, currency: null, note: spendGap } : spend,
    queue: buildQueue(queues, home),
    unmapped: buildUnmapped(unmapped, home),
    feeds: buildFeeds(feeds, home),
  };
}
