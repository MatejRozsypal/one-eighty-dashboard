/**
 * Home: the two strip tiles the Shopify variant does not have. Pure, so a
 * fixture can render them without a warehouse.
 *
 * ── New concepts launched ──────────────────────────────────────────────────
 * A concept is launched on the first day any ad tagged with it spent money:
 * per client and concept, MIN(date) with spend > 0 in mart.mart_creative_perf
 * over all history. The tile counts the concepts whose first day falls in the
 * last 30 days, against the 30 days before. Only ads mapped to a ClickUp
 * concept carry a concept_id, so an unmapped ad never counts. The window ends
 * on the latest day every current client has reached, as the new ads tile
 * does; a client whose data stopped a week or more before the freshest one is
 * left out and named.
 *
 * ── Incremental CM3 ────────────────────────────────────────────────────────
 * The pool of extra CM3 the clients made against last year. Per client, CM3
 * over the strip's 30 days minus CM3 over the same calendar dates a year
 * earlier, each day converted to CZK at its own month's rate in ref.fx_rates,
 * then summed over clients. A client counts only with CM3 on every one of
 * those 60 days and some revenue on last year's dates (a year with no sales
 * has a CM3 of zero, which is not a base, the same rule as the Home cards).
 * The change is against the same pool for the 30 days before; it is shown
 * only when every counted client also has that comparison complete.
 *
 * Later step: each client's profit share of this pool, once ref.contracts
 * holds the terms (profit share %, baseline). Nothing here estimates it.
 */

import { MINUS, formatMoney } from "@/lib/format";
import { yearEarlier } from "@/lib/home/health/series";
import { STALE_DAYS, WINDOW_DAYS, addDays, type DailyRow } from "@/lib/home/shopify/kpis";
import type { Kpi } from "@/lib/home/shopify/types";

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ------------------------------------------------------------------------ */
/* New concepts launched                                                    */
/* ------------------------------------------------------------------------ */

/** One client of mart.mart_creative_perf: its last day and its concepts' first spend days. */
export interface ConceptLaunches {
  clientId: string;
  /** Latest day the view holds for the client. */
  through: string;
  /** First day with spend > 0 of each concept, one entry per concept. */
  firstDays: string[];
}

const CONCEPTS_TIP =
  "Concepts whose first tagged ad first spent in the last 30 days, against the 30 days before. Only counts ads mapped to a ClickUp concept. Source: mart.mart_creative_perf.";

export function newConceptsKpi(
  launches: ConceptLaunches[] | null,
  names: Map<string, string>,
  sourceNote: string | null
): Kpi {
  const base = {
    key: "new_concepts" as const,
    label: "New concepts launched",
    kind: "count" as const,
    goodWhen: "neutral" as const,
    tip: CONCEPTS_TIP,
  };
  if (!launches || launches.length === 0) {
    return {
      ...base, value: null, previous: null, series: [],
      note: sourceNote ?? "mart.mart_creative_perf holds no client yet.",
      clients: { included: 0, total: 0 }, through: null,
    };
  }
  const name = (id: string) => names.get(id) ?? id;
  const freshest = launches.map((l) => l.through).sort().at(-1)!;
  const fresh = launches.filter((l) => l.through >= addDays(freshest, -STALE_DAYS));
  const stale = launches.filter((l) => !fresh.includes(l));
  const through = fresh.map((l) => l.through).sort()[0];
  const cur = daysBetween(addDays(through, -(WINDOW_DAYS - 1)), through);
  const prevFrom = addDays(through, -(2 * WINDOW_DAYS - 1));
  const prevTo = addDays(through, -WINDOW_DAYS);
  const all = fresh.flatMap((l) => l.firstDays);
  const count = (from: string, to: string) => all.filter((d) => d >= from && d <= to).length;

  const parts: string[] = [];
  const unmapped = fresh.filter((l) => l.firstDays.length === 0);
  if (unmapped.length) parts.push(`No ad mapped to a concept yet: ${list(unmapped.map((l) => name(l.clientId)))}.`);
  if (stale.length) parts.push(`Leaves out ${list(stale.map((l) => `${name(l.clientId)} (data stopped ${l.through})`))}.`);

  return {
    ...base,
    value: count(cur[0], through),
    previous: count(prevFrom, prevTo),
    series: cur.map((d) => count(d, d)),
    note: parts.length ? parts.join(" ") : null,
    clients: { included: fresh.length, total: launches.length },
    through,
  };
}

/* ------------------------------------------------------------------------ */
/* Incremental CM3                                                          */
/* ------------------------------------------------------------------------ */

const INCREMENTAL_TIP =
  "Extra CM3 against last year: per client, CM3 in the last 30 days minus CM3 on the same dates a year earlier, each day in CZK at its month's rate (ref.fx_rates), summed over clients. Change: the same pool for the 30 days before. Source: mart.plan_actuals_daily.";

function czk(r: DailyRow | undefined): number | null {
  if (!r || r.cm3 === null || r.czk === null) return null;
  return r.cm3 * r.czk;
}

/** Per-day differences of one client over `dates`, or the reason it cannot be measured. */
function differences(days: Map<string, DailyRow>, dates: string[]): { diffs: number[] } | { why: string } {
  const diffs: number[] = [];
  let lyRevenue = 0;
  for (const d of dates) {
    const now = days.get(d);
    const then = days.get(yearEarlier(d));
    const a = czk(now);
    if (a === null) return { why: now && now.cm3 !== null && now.czk === null ? "no CZK rate in ref.fx_rates" : "no CM3 on every day" };
    const b = czk(then);
    if (b === null)
      return { why: then && then.cm3 !== null && then.czk === null ? "no CZK rate a year earlier" : "no CM3 on the same days last year" };
    lyRevenue += then!.revenue ?? 0;
    diffs.push(a - b);
  }
  if (lyRevenue <= 0) return { why: "no sales on the same days last year" };
  return { diffs };
}

function signedMoney(v: number): string {
  const text = formatMoney(Math.abs(v), "CZK", { compact: true });
  return v < 0 ? `${MINUS}${text}` : `+${text}`;
}

/**
 * The window is the strip's: it ends on the latest day every current client
 * of mart.plan_actuals_daily has reached, by the same rule as `buildKpis`.
 * `rows` must hold the last 60 days and the same 60 dates a year earlier.
 */
export function incrementalCm3Kpi(
  rows: DailyRow[] | null,
  names: Map<string, string>,
  sourceNote: string | null
): Kpi {
  const base = {
    key: "cm3_vs_ly" as const,
    label: "Incremental CM3",
    kind: "money" as const,
    goodWhen: "up" as const,
    tip: INCREMENTAL_TIP,
    caption: "vs last year",
  };
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
  const total = byClient.size;
  if (!through) {
    return {
      ...base, value: null, previous: null, series: [],
      note: sourceNote ?? "No rows in mart.plan_actuals_daily for the last 60 days.",
      clients: { included: 0, total }, through: null,
    };
  }

  const cur = daysBetween(addDays(through, -(WINDOW_DAYS - 1)), through);
  const prev = daysBetween(addDays(through, -(2 * WINDOW_DAYS - 1)), addDays(through, -WINDOW_DAYS));
  const name = (id: string) => names.get(id) ?? id;

  const included: Array<{ id: string; diffs: number[]; prev: number | null }> = [];
  const excluded: string[] = [];
  for (const id of fresh) {
    const now = differences(byClient.get(id)!, cur);
    if ("why" in now) {
      excluded.push(`${name(id)} (${now.why})`);
      continue;
    }
    const before = differences(byClient.get(id)!, prev);
    included.push({ id, diffs: now.diffs, prev: "why" in before ? null : before.diffs.reduce((s, v) => s + v, 0) });
  }
  excluded.push(...stale.map((id) => `${name(id)} (data stopped)`));

  const perClient = included
    .map((c) => ({ id: c.id, value: c.diffs.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.value - a.value);
  const value = included.length ? perClient.reduce((s, c) => s + c.value, 0) : null;
  const prevMissing = included.filter((c) => c.prev === null);
  const previous = included.length && prevMissing.length === 0 ? included.reduce((s, c) => s + (c.prev ?? 0), 0) : null;

  const parts: string[] = [];
  if (perClient.length) parts.push(`${perClient.map((c) => `${name(c.id)} ${signedMoney(c.value)}`).join(", ")}.`);
  else parts.push("No client has CM3 on every day of the last 30 and on the same days last year.");
  if (excluded.length && included.length) parts.push(`Leaves out ${list(excluded)}.`);
  if (prevMissing.length)
    parts.push(`No change shown: ${list(prevMissing.map((c) => name(c.id)))} lack the comparison for the 30 days before.`);

  return {
    ...base,
    value,
    previous,
    series: cur.map((_, i) => (included.length ? included.reduce((s, c) => s + c.diffs[i], 0) : null)),
    note: parts.join(" "),
    clients: { included: included.length, total },
    through,
  };
}
