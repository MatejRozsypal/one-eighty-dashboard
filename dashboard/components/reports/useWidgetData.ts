"use client";

/**
 * Widget data for the report page (design 3.2, 3.4, 3.6).
 *
 * One POST /api/reports/query per widget. Server actions run one at a time per
 * client, which is why this is a route; the browser side of that bargain is
 * here:
 *
 *   - Concurrency: at most MAX_CONCURRENT_WIDGET_REQUESTS (6) requests in
 *     flight per tab, FIFO, so the widgets at the top of the page load first.
 *   - Abort: a widget whose request changed, was removed, or whose page
 *     unmounted aborts its request (and leaves the queue if still waiting).
 *   - Cache: module-level LRU of BROWSER_RESULT_CACHE_SIZE (100) results for the
 *     tab's lifetime, keyed by the request (effective filters + query + day), so
 *     going back to a view already seen is instant. The server's `result.key`
 *     is stored on the result but cannot be the lookup key: it is only known
 *     after the response.
 *   - Stale while revalidate: when a widget's request changes (or Refresh is
 *     pressed) the previous result stays on screen with `loading: true` until
 *     the new one lands, so the figures pulse instead of blanking. `loading`
 *     is derived at render from the request the stored result answers (`forKey`),
 *     not set by an effect, so the very render that carries new filters or a
 *     Refresh already reports loading: there is no frame where an old figure
 *     looks fresh.
 *   - Display-only edits (title, sort, limit, stacked, type changes that keep
 *     the query) do not change the request key, so they never refetch.
 *
 * Transient failures (a network error, a platform 5xx) are retried quietly
 * with backoff before the widget shows an error: see `post`.
 *
 * A KPI is fetched at week grain when the range fits (see `fetchGrain`), so the
 * tile gets its sparkline from the same call; a 413 retries once at the
 * configured grain.
 *
 * Owner: RS9.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BROWSER_RESULT_CACHE_SIZE, MAX_CONCURRENT_WIDGET_REQUESTS } from "@/lib/reports/limits";
import type { ReportErrorBody, ReportErrorCode, ReportFilters, ReportQueryRequest, WidgetConfig, WidgetResult } from "@/lib/reports/types";
import { fetchGrain } from "@/lib/reports/widgetHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetError {
  code: ReportErrorCode | "network";
  /** One short line. */
  message: string;
  suggestion?: string;
  /** False for failures a retry cannot fix (invalid, too_large, not available). */
  retryable: boolean;
}

export interface WidgetState {
  /** The latest good result. Kept while a refetch is running (stale while revalidate). */
  result: WidgetResult | null;
  loading: boolean;
  error: WidgetError | null;
  /** The request (plan key and refresh count) `result` or `error` answers. Internal. */
  forKey?: string;
}

export interface WidgetDataInput {
  id: string;
  /** Null for a stored config that no longer validates: nothing to fetch. */
  config: WidgetConfig | null;
}

const EMPTY: WidgetState = { result: null, loading: true, error: null };

// ---------------------------------------------------------------------------
// LRU (module level: lives as long as the tab)
// ---------------------------------------------------------------------------

const lru = new Map<string, WidgetResult>();

function lruGet(key: string): WidgetResult | undefined {
  const hit = lru.get(key);
  if (hit) {
    lru.delete(key);
    lru.set(key, hit);
  }
  return hit;
}

function lruSet(key: string, value: WidgetResult): void {
  lru.delete(key);
  lru.set(key, value);
  while (lru.size > BROWSER_RESULT_CACHE_SIZE) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

/** For tests and a hard refresh. */
export function clearWidgetCache(): void {
  lru.clear();
}

// ---------------------------------------------------------------------------
// Concurrency gate (module level: the limit is per tab, not per hook)
// ---------------------------------------------------------------------------

let active = 0;
const waiting: Array<() => void> = [];

function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (active < MAX_CONCURRENT_WIDGET_REQUESTS) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const turn = () => {
      signal.removeEventListener("abort", onAbort);
      active += 1;
      resolve();
    };
    const onAbort = () => {
      const at = waiting.indexOf(turn);
      if (at >= 0) waiting.splice(at, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    waiting.push(turn);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function release(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

type FetchOutcome = { ok: true; result: WidgetResult } | { ok: false; error: WidgetError; status: number };

const ERROR_COPY: Record<string, { message: string; retryable: boolean }> = {
  invalid: { message: "Invalid widget", retryable: false },
  not_found: { message: "Not available", retryable: false },
  forbidden: { message: "Not available", retryable: false },
  too_large: { message: "Too much data", retryable: false },
  over_budget: { message: "Too much data", retryable: false },
  timeout: { message: "Timed out", retryable: true },
  warehouse_error: { message: "Could not load", retryable: true },
  conflict: { message: "Could not load", retryable: true },
};

/**
 * Automatic retries (QA N-02). The first open of a report fires up to six
 * queries at once, each landing on its own cold lambda; some come back as a
 * platform error (503/502/504 with no JSON body, or no response at all) that
 * the runtime logs never see, and the widget used to show "Could not load"
 * for a failure the next attempt would have survived. Transient failures are
 * retried here, quietly, with backoff and jitter, while the widget keeps
 * showing its skeleton (or its dimmed old figure):
 *
 *   - network error (no response), 408, 425, 429 and 5xx with no known code:
 *     up to 2 retries, after about 0.7 s and 2 s;
 *   - our own warehouse_error (500): one retry;
 *   - a 404 once (a session lookup that failed under load answers 404);
 *   - never for a timeout (the 20 s job limit or a 504: the same query would
 *     spend the same time again), invalid, too_large, over_budget.
 *
 * The backoff happens outside the concurrency gate, so a waiting widget does
 * not hold a slot a queued widget could use, and it is abortable.
 */
export const RETRY_DELAYS_MS: readonly number[] = [700, 2000];

export type RetryClass = "transient" | "once" | "never";

/** How a failed outcome may be retried. Pure, exported for check:reports-widgets. */
export function retryClass(outcome: { status: number; error: Pick<WidgetError, "code"> }): RetryClass {
  const { status, error } = outcome;
  if (error.code === "network" || status === 0) return "transient";
  if (error.code === "invalid" || error.code === "too_large" || error.code === "over_budget" || error.code === "timeout") return "never";
  if (error.code === "warehouse_error") return status === 500 ? "once" : status === 504 ? "never" : "transient";
  if (status === 404) return "once";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "transient";
  return "never";
}

/** Retries allowed for a class, given the delay schedule. */
export function retriesFor(kind: RetryClass, delays: readonly number[] = RETRY_DELAYS_MS): number {
  return kind === "transient" ? delays.length : kind === "once" ? 1 : 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The delay before retry number `attempt` (0 based): the schedule entry plus up to 30 percent jitter. */
export function retryDelay(attempt: number, random: () => number = Math.random, delays: readonly number[] = RETRY_DELAYS_MS): number {
  const base = delays[Math.min(attempt, delays.length - 1)] ?? 0;
  return Math.round(base * (1 + 0.3 * random()));
}

async function postOnce(body: ReportQueryRequest, signal: AbortSignal): Promise<FetchOutcome> {
  await acquire(signal);
  try {
    const response = await fetch("/api/reports/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) return { ok: true, result: (await response.json()) as WidgetResult };
    let parsed: Partial<ReportErrorBody> = {};
    try {
      parsed = (await response.json()) as Partial<ReportErrorBody>;
    } catch {
      /* A 404 has an empty body. */
    }
    const code: ReportErrorCode = parsed.code ?? (response.status === 404 ? "not_found" : "warehouse_error");
    const copy = ERROR_COPY[code] ?? ERROR_COPY.warehouse_error;
    return {
      ok: false,
      status: response.status,
      error: { code, message: copy.message, suggestion: parsed.suggestion, retryable: copy.retryable },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: { code: "network", message: "Could not load", retryable: true } };
  } finally {
    release();
  }
}

async function post(body: ReportQueryRequest, signal: AbortSignal): Promise<FetchOutcome> {
  let outcome = await postOnce(body, signal);
  let used = 0;
  while (!outcome.ok) {
    const allowed = retriesFor(retryClass(outcome));
    if (used >= allowed) break;
    await sleep(retryDelay(used), signal);
    used += 1;
    outcome = await postOnce(body, signal);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Request planning (pure, exported for tests)
// ---------------------------------------------------------------------------

export interface WidgetPlan {
  id: string;
  /** LRU key and change detector. */
  key: string;
  body: ReportQueryRequest;
  /** Same request at the configured grain, for a KPI whose week query was too large. */
  fallback: ReportQueryRequest | null;
}

/** What a stored result answers: the request plus how many Refreshes had happened. */
export function answerKey(planKey: string, refreshNonce: number): string {
  return `${planKey}#${refreshNonce}`;
}

const dayStamp = () => new Date().toISOString().slice(0, 10);

export function planWidget(input: WidgetDataInput, reportId: string, filters: ReportFilters): WidgetPlan | null {
  const { id, config } = input;
  if (!config) return null;
  const grain = fetchGrain(config, filters);
  const query = { ...config.query, grain };
  const body: ReportQueryRequest = { reportId, filters, query, widgetType: config.view.type };
  const fallback: ReportQueryRequest | null = grain === config.query.grain ? null : { ...body, query: config.query };
  // Everything that changes the numbers, nothing that is display only. The day
  // is part of the key because presets are relative to today.
  const key = JSON.stringify({ f: filters, q: query, d: dayStamp() });
  return { id, key, body, fallback };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseWidgetData {
  data: Readonly<Record<string, WidgetState>>;
  /** Refetch one widget after an error. */
  retry(id: string): void;
}

interface Running {
  key: string;
  abort: AbortController;
}

/**
 * `widgets` should be in reading order (y, then x): the first six requests go
 * out first. `refreshNonce` bumps to force every widget to refetch (Refresh),
 * keeping what is on screen until the new numbers arrive.
 */
export function useWidgetData(args: {
  reportId: string;
  filters: ReportFilters;
  widgets: readonly WidgetDataInput[];
  refreshNonce: number;
}): UseWidgetData {
  const { reportId, filters, widgets, refreshNonce } = args;
  const [data, setData] = useState<Record<string, WidgetState>>({});
  const [retryTick, setRetryTick] = useState(0);
  const running = useRef(new Map<string, Running>());
  const forced = useRef(new Set<string>());
  const lastRefresh = useRef(refreshNonce);

  const plans = useMemo(
    () => widgets.map((w) => planWidget(w, reportId, filters)).filter((p): p is WidgetPlan => p !== null),
    [widgets, reportId, filters],
  );
  const signature = plans.map((p) => `${p.id}|${p.key}`).join("\n");
  const plansRef = useRef(plans);
  plansRef.current = plans;

  const patch = useCallback((id: string, next: (prev: WidgetState) => WidgetState) => {
    setData((all) => ({ ...all, [id]: next(all[id] ?? EMPTY) }));
  }, []);

  useEffect(() => {
    const current = plansRef.current;
    const refreshed = lastRefresh.current !== refreshNonce;
    lastRefresh.current = refreshNonce;
    const live = new Set(current.map((p) => p.id));

    // Widgets that left the page.
    for (const [id, run] of running.current) {
      if (!live.has(id)) {
        run.abort.abort();
        running.current.delete(id);
      }
    }
    setData((all) => {
      const keep = Object.keys(all).filter((id) => live.has(id) || widgets.some((w) => w.id === id));
      return keep.length === Object.keys(all).length ? all : Object.fromEntries(keep.map((id) => [id, all[id]]));
    });

    for (const plan of current) {
      const run = running.current.get(plan.id);
      const force = refreshed || forced.current.delete(plan.id);
      if (run && run.key === plan.key && !force) continue;
      run?.abort.abort();

      const forKey = answerKey(plan.key, refreshNonce);
      const hit = force ? undefined : lruGet(plan.key);
      if (hit) {
        running.current.delete(plan.id);
        patch(plan.id, () => ({ result: hit, loading: false, error: null, forKey }));
        continue;
      }

      const abort = new AbortController();
      running.current.set(plan.id, { key: plan.key, abort });
      patch(plan.id, (prev) => ({ result: prev.result, loading: true, error: null, forKey }));

      void (async () => {
        try {
          let outcome = await post(plan.body, abort.signal);
          if (!outcome.ok && outcome.error.code === "too_large" && plan.fallback) {
            outcome = await post(plan.fallback, abort.signal);
          }
          if (abort.signal.aborted) return;
          running.current.delete(plan.id);
          if (outcome.ok) {
            lruSet(plan.key, outcome.result);
            patch(plan.id, () => ({ result: outcome.result, loading: false, error: null, forKey }));
          } else {
            patch(plan.id, (prev) => ({ result: prev.result, loading: false, error: outcome.error, forKey }));
          }
        } catch {
          /* Aborted: the widget changed or left; whoever aborted owns the state. */
        }
      })();
    }
    // `signature` captures every plan change; the plans themselves are read from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, refreshNonce, retryTick, patch]);

  useEffect(
    () => () => {
      for (const run of running.current.values()) run.abort.abort();
      running.current.clear();
    },
    [],
  );

  const retry = useCallback((id: string) => {
    forced.current.add(id);
    setRetryTick((t) => t + 1);
  }, []);

  // Loading is true whenever the stored state does not answer the current
  // request, whatever the effect has caught up with.
  const view = useMemo(() => {
    const out: Record<string, WidgetState> = { ...data };
    for (const plan of plans) {
      const state = data[plan.id];
      if (state && !state.loading && state.forKey !== answerKey(plan.key, refreshNonce)) {
        out[plan.id] = { ...state, loading: true };
      }
    }
    return out;
  }, [data, plans, refreshNonce]);

  return { data: view, retry };
}
