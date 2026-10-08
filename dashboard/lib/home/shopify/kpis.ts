/**
 * The KPI strip: cross-client totals for the last 30 days, against the 30
 * days before. Pure, so a fixture can render it without a warehouse.
 *
 * ── One window for every client ────────────────────────────────────────────
 * Clients load on different days. A total over "the last 30 days" that ends on
 * a different day per client is not one period, so the window ends on the
 * latest day every current client has reached. A client whose data stopped
 * more than a week before the freshest one would hold that day back for
 * everybody; it is left out instead and named in the note.
 *
 * ── Currency ───────────────────────────────────────────────────────────────
 * Each daily row is converted to CZK at its own month's rate from
 * `ref.fx_rates` before anything is summed, the same rule as `lib/currency`.
 * A client with a day lacking a rate is left out of the total and named; a sum
 * of converted and unconverted figures would be a wrong number, not a partial
 * one.
 *
 * ── Completeness ───────────────────────────────────────────────────────────
 * A client counts toward a metric only with a value on every day of the
 * window (CM3 needs cost data each day, aMER paid spend each day). The delta
 * is shown only when every counted client also has every day of the previous
 * window; otherwise it is n/a.
 */

import type { Kpi, KpiKey } from "./types";

/** One client-day from `mart.plan_actuals_daily`, with its month's CZK rate. */
export interface DailyRow {
  clientId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  revenue: number | null;
  cm3: number | null;
  /** New customer revenue. */
  ncr: number | null;
  /** All-channel paid spend (the aMER denominator). */
  paid: number | null;
  /** Meta spend in the trading currency. */
  meta: number | null;
  /** CZK per unit of the client's currency for the row's month; 1 for CZK; null without a rate. */
  czk: number | null;
}

/** First-delivery dates of one client's eligible launches (relaunches and pre-existing ads removed). */
export interface LaunchDates {
  clientId: string;
  /** Latest day the launch table holds for the client. */
  through: string;
  dates: string[];
}

export const WINDOW_DAYS = 30;
/** A client this many days behind the freshest one is left out rather than holding the window back. */
export const STALE_DAYS = 7;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type Pick = (r: DailyRow) => number | null;

interface Window {
  cur: string[];
  prev: string[];
  through: string;
}

/** Converted value of one row, or null when the value or the rate is missing. */
function czkOf(r: DailyRow | undefined, pick: Pick): number | null {
  if (!r) return null;
  const v = pick(r);
  return v === null || r.czk === null ? null : v * r.czk;
}

interface Built {
  value: number | null;
  previous: number | null;
  series: Array<number | null>;
  included: string[];
  excluded: Array<{ id: string; why: string }>;
  prevMissing: string[];
}

/** Sum of a money column over the window, per the completeness rules above. */
function sumMetric(byClient: Map<string, Map<string, DailyRow>>, ids: string[], w: Window, pick: Pick, need: string): Built {
  const included: string[] = [];
  const excluded: Array<{ id: string; why: string }> = [];
  const prevMissing: string[] = [];
  for (const id of ids) {
    const days = byClient.get(id)!;
    const curOk = w.cur.every((d) => czkOf(days.get(d), pick) !== null);
    if (!curOk) {
      const noRate = w.cur.some((d) => days.get(d) && days.get(d)!.czk === null && pick(days.get(d)!) !== null);
      excluded.push({ id, why: noRate ? "no CZK rate in ref.fx_rates" : need });
      continue;
    }
    included.push(id);
    if (!w.prev.every((d) => czkOf(days.get(d), pick) !== null)) prevMissing.push(id);
  }
  const total = (dates: string[]) =>
    included.reduce((s, id) => s + dates.reduce((t, d) => t + (czkOf(byClient.get(id)!.get(d), pick) ?? 0), 0), 0);
  return {
    value: included.length ? total(w.cur) : null,
    previous: included.length && prevMissing.length === 0 ? total(w.prev) : null,
    series: w.cur.map((d) => (included.length ? total([d]) : null)),
    included,
    excluded,
    prevMissing,
  };
}

function amerMetric(byClient: Map<string, Map<string, DailyRow>>, ids: string[], w: Window): Built {
  const ncr: Pick = (r) => (r.paid === null ? null : r.ncr ?? 0);
  const paid: Pick = (r) => r.paid;
  const num = sumMetric(byClient, ids, w, ncr, "paid spend missing on a day");
  const ratio = (dates: string[]) => {
    let n = 0;
    let p = 0;
    for (const id of num.included) {
      for (const d of dates) {
        const row = byClient.get(id)!.get(d);
        const a = czkOf(row, ncr);
        const b = czkOf(row, paid);
        if (a === null || b === null) return null;
        n += a;
        p += b;
      }
    }
    return p > 0 ? n / p : null;
  };
  // A daily aMER swings with one order; the line is the trailing 7 days.
  return {
    ...num,
    value: num.included.length ? ratio(w.cur) : null,
    previous: num.included.length && num.prevMissing.length === 0 ? ratio(w.prev) : null,
    series: w.cur.map((d) => (num.included.length ? ratio(daysBetween(addDays(d, -6), d)) : null)),
  };
}

function noteFor(b: Built, names: Map<string, string>, stale: string[], label: string): string | null {
  const parts: string[] = [];
  if (!b.included.length) parts.push(`No client has ${label} on every day of the last 30.`);
  const left = [...b.excluded.map((e) => `${names.get(e.id) ?? e.id} (${e.why})`), ...stale.map((s) => `${names.get(s) ?? s} (data stopped)`)];
  if (left.length && b.included.length) parts.push(`Leaves out ${list(left)}.`);
  if (b.included.length && b.prevMissing.length)
    parts.push(`No change shown: ${list(b.prevMissing.map((id) => names.get(id) ?? id))} lack the 30 days before.`);
  return parts.length ? parts.join(" ") : null;
}

const EMPTY_NOTE = "No rows in mart.plan_actuals_daily for the last 60 days.";

export function buildKpis(
  rows: DailyRow[] | null,
  launches: LaunchDates[] | null,
  names: Map<string, string>,
  sourceNotes: { actuals: string | null; launches: string | null } = { actuals: null, launches: null }
): { kpis: Kpi[]; through: string | null } {
  const byClient = new Map<string, Map<string, DailyRow>>();
  for (const r of rows ?? []) {
    if (!byClient.has(r.clientId)) byClient.set(r.clientId, new Map());
    byClient.get(r.clientId)!.set(r.date, r);
  }
  const last = new Map([...byClient].map(([id, days]) => [id, [...days.keys()].sort().at(-1)!]));
  const freshest = [...last.values()].sort().at(-1) ?? null;
  const fresh = [...last].filter(([, d]) => freshest && d >= addDays(freshest, -STALE_DAYS)).map(([id]) => id);
  const stale = [...last.keys()].filter((id) => !fresh.includes(id));
  const through = fresh.length ? fresh.map((id) => last.get(id)!).sort()[0] : null;
  const w: Window | null = through
    ? {
        through,
        cur: daysBetween(addDays(through, -(WINDOW_DAYS - 1)), through),
        prev: daysBetween(addDays(through, -(2 * WINDOW_DAYS - 1)), addDays(through, -WINDOW_DAYS)),
      }
    : null;
  const total = byClient.size;

  const fromActuals = (
    key: KpiKey,
    label: string,
    kind: Kpi["kind"],
    goodWhen: Kpi["goodWhen"],
    tip: string,
    build: (w: Window) => Built,
    need: string
  ): Kpi => {
    if (!w) {
      return {
        key, label, kind, goodWhen, tip,
        value: null, previous: null, series: [],
        note: sourceNotes.actuals ?? EMPTY_NOTE,
        clients: { included: 0, total }, through: null,
      };
    }
    const b = build(w);
    return {
      key, label, kind, goodWhen, tip,
      value: b.value,
      previous: b.previous,
      series: b.series,
      note: noteFor(b, names, stale, need),
      clients: { included: b.included.length, total },
      through: w.through,
    };
  };

  const kpis: Kpi[] = [
    fromActuals(
      "revenue", "Client revenue", "money", "up",
      "Net shop revenue of every client, last 30 days, converted to CZK at each month's rate in ref.fx_rates. Source: mart.plan_actuals_daily.",
      (w) => sumMetric(byClient, fresh, w, (r) => r.revenue, "revenue missing on a day"),
      "revenue"
    ),
    fromActuals(
      "meta_spend", "Meta spend", "money", "neutral",
      "Meta ad spend of every client, last 30 days, in CZK. Source: mart.plan_actuals_daily.",
      (w) => sumMetric(byClient, fresh, w, (r) => r.meta, "spend missing on a day"),
      "Meta spend"
    ),
    fromActuals(
      "cm3", "CM3", "money", "up",
      "Contribution margin after marketing, last 30 days, in CZK. A client counts only with cost data on every day. Source: mart.plan_actuals_daily.",
      (w) => sumMetric(byClient, fresh, w, (r) => r.cm3, "no cost data on every day"),
      "cost data"
    ),
    fromActuals(
      "amer", "aMER", "ratio", "up",
      "New customer revenue over paid spend, last 30 days, ratio of sums in CZK. The line is the trailing 7 days. Source: mart.plan_actuals_daily.",
      (w) => amerMetric(byClient, fresh, w),
      "paid spend"
    ),
  ];

  kpis.push(newAdsKpi(launches, names, sourceNotes.launches));
  return { kpis, through };
}

function newAdsKpi(launches: LaunchDates[] | null, names: Map<string, string>, sourceNote: string | null): Kpi {
  const base = {
    key: "new_ads" as const,
    label: "New ads launched",
    kind: "count" as const,
    goodWhen: "neutral" as const,
    tip: "Ads first delivered in the last 30 days, relaunches excluded, every client with Meta. Source: mart.rpt_ad_launch.",
  };
  if (!launches || launches.length === 0) {
    return {
      ...base, value: null, previous: null, series: [],
      note: sourceNote ?? "mart.rpt_ad_launch holds no client yet.",
      clients: { included: 0, total: 0 }, through: null,
    };
  }
  const freshest = launches.map((l) => l.through).sort().at(-1)!;
  const fresh = launches.filter((l) => l.through >= addDays(freshest, -STALE_DAYS));
  const stale = launches.filter((l) => !fresh.includes(l));
  const through = fresh.map((l) => l.through).sort()[0];
  const cur = daysBetween(addDays(through, -(WINDOW_DAYS - 1)), through);
  const prevFrom = addDays(through, -(2 * WINDOW_DAYS - 1));
  const prevTo = addDays(through, -WINDOW_DAYS);
  const all = fresh.flatMap((l) => l.dates);
  const count = (from: string, to: string) => all.filter((d) => d >= from && d <= to).length;
  return {
    ...base,
    value: count(cur[0], through),
    previous: count(prevFrom, prevTo),
    series: cur.map((d) => count(d, d)),
    note: stale.length ? `Leaves out ${list(stale.map((l) => names.get(l.clientId) ?? l.clientId))} (launch data stopped).` : null,
    clients: { included: fresh.length, total: launches.length },
    through,
  };
}
