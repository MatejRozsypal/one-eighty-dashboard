/**
 * Markets Scouting: the opportunity index (owner-approved design, 2026-10-15).
 *
 * A signal for picking what to test next, never a verdict. Pure, so the page,
 * the demo and scripts/check-markets.ts run the same arithmetic.
 *
 * ── Definition ──────────────────────────────────────────────────────────────
 * Candidates: every unsold country in `mart.market_scouting_signals` for the
 * client plus the research candidates (lib/markets/scouting.ts), kept even
 * with no data. Four signals, higher is better, each scored 0..1 against the
 * best candidate of the same client:
 *
 *   proven pull      new customers, 365 d             weight 0.35  log scale
 *   unpaid interest  unpaid engaged GA4 sessions, 90 d weight 0.25  log scale
 *   search demand    core monthly search volume       weight 0.25  log scale
 *   cost to reach    home Meta CPM / country Meta CPM weight 0.15  ratio / max ratio
 *
 *   log scale: log1p(x) / log1p(max over candidates); 0 when the max is 0.
 *
 * Index = round(100 x sum(w x s) / sum(w over the available signals)), only
 * with at least two available signals; otherwise n/a with the missing ones
 * named. A signal is n/a, not zero, when it is not measured (GA4 not
 * connected, search terms not confirmed, CPM benchmark missing). A measured
 * zero (no orders, no sessions) stays zero. No shrinkage, no smoothing (owner
 * rule: pure numbers).
 */

import type { CpmBenchmark, ScoutingSignalsRaw, ScoutSignalRow } from "./types";

export type SignalKey = "pull" | "unpaid" | "search" | "cost";

export const SIGNALS: ReadonlyArray<{ key: SignalKey; label: string; short: string; weight: number; what: string }> = [
  { key: "pull", label: "Proven pull", short: "Pull", weight: 0.35, what: "New customers with no campaign behind them, last 365 days" },
  { key: "unpaid", label: "Unpaid interest", short: "Unpaid", weight: 0.25, what: "Engaged GA4 sessions from unpaid channels, last 90 days" },
  { key: "search", label: "Search demand", short: "Search", weight: 0.25, what: "Monthly searches for the confirmed core terms" },
  { key: "cost", label: "Cost to reach", short: "Cost", weight: 0.15, what: "Home-market Meta CPM benchmark divided by the country's" },
];

/** Fewest available signals an index is computed on. */
export const MIN_SIGNALS = 2;

/** Vertical fallback after the client's own (migration 250 and the 295 seed). */
export const FALLBACK_VERTICALS = ["all_ecommerce"] as const;

export type RawSignal = { v: number } | { na: string };

export interface CandidateSignals {
  iso: string;
  pull: RawSignal;
  unpaid: RawSignal;
  search: RawSignal;
  /** The CPM ratio home / country, not the CPM itself. */
  cost: RawSignal;
}

export interface SignalScore {
  raw: RawSignal;
  /** 0..1, null when the signal is n/a. */
  score: number | null;
}

export interface Opportunity {
  iso: string;
  /** 0..100, null when fewer than MIN_SIGNALS signals are available. */
  index: number | null;
  /** Why the index is n/a. */
  na: string | null;
  /** Shared rank among the indexed candidates (1, 1, 3 on a tie); null when n/a. */
  rank: number | null;
  /** Available signals, out of 4. */
  coverage: number;
  signals: Record<SignalKey, SignalScore>;
}

const has = (x: RawSignal): x is { v: number } => "v" in x;

/** log1p(x) / log1p(max); 0 when nothing has any (max 0). */
export function logScale(x: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, Math.log1p(Math.max(0, x)) / Math.log1p(max)));
}

/** ratio / max ratio, capped to 0..1. */
export function ratioScale(x: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, x / max));
}

function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Scores and ranks candidates. Order: index desc, coverage desc, ISO; n/a last by ISO. */
export function opportunityIndex(cands: CandidateSignals[]): Opportunity[] {
  const max: Record<SignalKey, number> = { pull: 0, unpaid: 0, search: 0, cost: 0 };
  for (const c of cands) {
    for (const s of SIGNALS) {
      const r = c[s.key];
      if (has(r) && Number.isFinite(r.v)) max[s.key] = Math.max(max[s.key], r.v);
    }
  }

  const out: Opportunity[] = cands.map((c) => {
    const signals = {} as Record<SignalKey, SignalScore>;
    let num = 0;
    let den = 0;
    let coverage = 0;
    const missing: string[] = [];
    for (const s of SIGNALS) {
      const r = c[s.key];
      if (has(r) && Number.isFinite(r.v)) {
        const score = s.key === "cost" ? ratioScale(r.v, max.cost) : logScale(r.v, max[s.key]);
        signals[s.key] = { raw: r, score };
        num += s.weight * score;
        den += s.weight;
        coverage += 1;
      } else {
        signals[s.key] = { raw: has(r) ? { na: "Not a number" } : r, score: null };
        missing.push(`${lower(s.label)} (${has(r) ? "not a number" : r.na})`);
      }
    }
    const ok = coverage >= MIN_SIGNALS && den > 0;
    return {
      iso: c.iso,
      index: ok ? Math.round((100 * num) / den) : null,
      na: ok ? null : `Needs at least ${MIN_SIGNALS} of 4 signals, has ${coverage}. Missing: ${missing.join("; ")}`,
      rank: null,
      coverage,
      signals,
    };
  });

  out.sort((a, b) => {
    if (a.index === null || b.index === null) {
      if (a.index !== b.index) return a.index === null ? 1 : -1;
      return a.iso.localeCompare(b.iso);
    }
    return b.index - a.index || b.coverage - a.coverage || a.iso.localeCompare(b.iso);
  });
  let prev: number | null = null;
  let prevRank = 0;
  out.forEach((o, i) => {
    if (o.index === null) return;
    o.rank = o.index === prev ? prevRank : i + 1;
    prev = o.index;
    prevRank = o.rank;
  });
  return out;
}

/**
 * The CPM ratio home / country. Both CPMs come from one vertical (the
 * client's, then all_ecommerce) and one source, so the ratio compares like
 * with like: sources differ by up to 1.5x on the same country. Within a
 * vertical the source covering the most countries goes first (then by name),
 * and the first that has both countries in one currency is used.
 */
export function cpmRatio(
  iso: string,
  home: string | null,
  cpm: CpmBenchmark[] | null,
  vertical: string | null
): RawSignal {
  if (cpm === null) return { na: "Benchmarks not loaded" };
  if (!home) return { na: "Home market unknown" };
  const rows = cpm.filter((r) => r.value > 0);
  const verticals = [...new Set([vertical, ...FALLBACK_VERTICALS].filter((v): v is string => !!v))];
  let sawCurrencyGap = false;
  for (const v of verticals) {
    const inV = rows.filter((r) => r.vertical === v);
    const reach = new Map<string, number>();
    for (const r of inV) reach.set(r.source, (reach.get(r.source) ?? 0) + 1);
    const sources = [...reach.keys()].sort((a, b) => (reach.get(b) ?? 0) - (reach.get(a) ?? 0) || a.localeCompare(b));
    for (const src of sources) {
      const h = inV.find((r) => r.iso === home && r.source === src);
      const c = inV.find((r) => r.iso === iso && r.source === src);
      if (!h || !c) continue;
      if ((h.currency ?? "") !== (c.currency ?? "")) {
        sawCurrencyGap = true;
        continue;
      }
      return { v: h.value / c.value };
    }
  }
  if (sawCurrencyGap) return { na: `Meta CPM benchmarks for ${home} and ${iso} are in different currencies` };
  const inVerticals = (country: string) => rows.some((r) => r.iso === country && verticals.includes(r.vertical));
  if (!inVerticals(iso)) return { na: `No Meta CPM benchmark for ${iso}` };
  if (!inVerticals(home)) return { na: `No Meta CPM benchmark for the home market (${home})` };
  return { na: `No single source has Meta CPM benchmarks for both ${home} and ${iso}` };
}

/**
 * The four raw signals per candidate from the signals view and the CPM rows.
 * A candidate with no row in the view has no orders (and, with GA4, no
 * sessions) in the window: a measured zero, not n/a.
 */
export function candidateSignals(input: {
  candidates: string[];
  home: string | null;
  signals: ScoutingSignalsRaw | null;
}): CandidateSignals[] {
  const { signals } = input;
  if (!signals) {
    const na = { na: "Scouting signals are not built for this client" };
    return input.candidates.map((iso) => ({ iso, pull: na, unpaid: na, search: na, cost: na }));
  }
  const byIso = new Map<string, ScoutSignalRow>(signals.rows.map((r) => [r.iso, r]));
  return input.candidates.map((iso) => {
    const r = byIso.get(iso);
    return {
      iso,
      pull: { v: r?.newCustomers365 ?? 0 },
      unpaid:
        signals.ga4Days90 === null
          ? { na: "GA4 is not connected for this client" }
          : { v: r?.unpaidEngagedSessions90 ?? 0 },
      search:
        r?.searchVolumeCore !== null && r?.searchVolumeCore !== undefined
          ? { v: r.searchVolumeCore }
          : { na: `No confirmed core search terms for ${iso} yet` },
      cost: cpmRatio(iso, input.home, signals.cpm, signals.vertical),
    };
  });
}

/** Candidates: the signals view's countries plus the research list, minus the sold set. */
export function scoutCandidates(input: {
  sold: string[];
  withOrders: string[];
  research: string[];
  signals: ScoutingSignalsRaw | null;
}): string[] {
  const all = [...input.withOrders, ...input.research, ...(input.signals?.rows.map((r) => r.iso) ?? [])];
  return [...new Set(all)].filter((iso) => !input.sold.includes(iso) && /^[A-Z]{2}$/.test(iso));
}
