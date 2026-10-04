/**
 * Widget runner: executes a CompiledQuery with cost guardrails, caches the
 * normalised rows, and maps BigQuery failures to ReportsError (design 3.4, 3.5).
 *
 * Layers, in order:
 *   1. Gate: assertReportsAccess() before any cache read (fails closed).
 *   2. In-flight dedupe per lambda: Map<key, Promise>, until settled.
 *   3. Server data cache: unstable_cache(["rpt", SEMANTIC_VERSION, key]),
 *      tags "reports" and "bq", TTL by how recent the range is. Wrapped in
 *      cacheThrough() so it can be swapped (in-memory LRU, Next 15 "use cache")
 *      without touching callers. Outside a Next request (scripts) it falls back
 *      to the in-memory LRU automatically; REPORTS_CACHE=memory forces it.
 *   4. BigQuery: queryJob() with maximumBytesBilled (REPORTS_MAX_BYTES_BILLED,
 *      default 2 GiB), jobTimeoutMs 20 s and labels app, feature, widget_type, user.
 *
 * Results are role-independent (internal only) and are never cached by the CDN
 * or the browser HTTP cache: the route answers with `private, no-store`.
 *
 * Owner: WP2 (RS2).
 */

import "server-only";

import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import * as authz from "@/lib/authz";
import { queryJob } from "@/lib/bigquery";
import { todayUtc, addDays } from "@/lib/period";
import {
  ReportsError,
  TOTAL_BUCKET,
  type AssertReportsAccess,
  type CompiledQuery,
  type ComponentRow,
  type ComponentSum,
  type MartGuards,
  type RunCached,
  type RunContext,
  type RunResult,
} from "./contracts";
import { CACHE_TAGS, CACHE_TTL_S, DEFAULT_MAX_BYTES_BILLED, JOB_TIMEOUT_MS } from "./limits";
import { SEMANTIC_VERSION, type ComponentId, type MartId } from "./registry/types";
import { componentAlias, guardAlias } from "./compile";

// ---------------------------------------------------------------------------
// Policy helpers (pure, exported for check:reports)
// ---------------------------------------------------------------------------

/** Cache TTL in seconds: 15 min within 2 days of yesterday, 1 h within 7 days, 6 h older. */
export function cacheTtlSeconds(rangeTo: string, today: string = todayUtc()): number {
  const yesterday = addDays(today, -1);
  if (rangeTo >= addDays(yesterday, -2)) return CACHE_TTL_S.recent;
  if (rangeTo >= addDays(yesterday, -7)) return CACHE_TTL_S.lastWeek;
  return CACHE_TTL_S.older;
}

/** REPORTS_MAX_BYTES_BILLED, a positive integer of bytes; anything else gives the 2 GiB default. */
export function maxBytesBilled(env: Record<string, string | undefined> = process.env): number {
  const raw = env.REPORTS_MAX_BYTES_BILLED?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MAX_BYTES_BILLED;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_MAX_BYTES_BILLED;
}

/** Job labels for INFORMATION_SCHEMA.JOBS cost breakdowns. The user is a short hash, never the email. */
export function jobLabels(ctx: Pick<RunContext, "userEmail" | "widgetType">): Record<string, string> {
  const user = createHash("sha1").update(ctx.userEmail.trim().toLowerCase()).digest("hex").slice(0, 8);
  return {
    app: "dashboard",
    feature: "reports",
    widget_type: ctx.widgetType ?? "none",
    user,
  };
}

/** Collects every reason and message an error from @google-cloud/bigquery carries. */
function errorText(error: unknown): { reasons: string[]; text: string } {
  const reasons: string[] = [];
  const texts: string[] = [];
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || depth > 3) {
      if (typeof e === "string") texts.push(e);
      return;
    }
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") texts.push(o.message);
    if (typeof o.reason === "string") reasons.push(o.reason);
    if (Array.isArray(o.errors)) for (const inner of o.errors) visit(inner, depth + 1);
    if (o.response && typeof o.response === "object") visit(o.response, depth + 1);
    if (o.cause) visit(o.cause, depth + 1);
  };
  visit(error, 0);
  return { reasons, text: texts.join(" | ") };
}

/**
 * BigQuery error -> ReportsError. over_budget (422) for the bytes-billed
 * limit, timeout (504) for job or client timeouts, warehouse_error (500) for
 * everything else (permissions included), never an empty state.
 */
export function mapWarehouseError(error: unknown): ReportsError {
  if (error instanceof ReportsError) return error;
  const { reasons, text } = errorText(error);
  if (reasons.includes("bytesBilledLimitExceeded") || /bytes billed/i.test(text)) {
    return new ReportsError("over_budget", "Query too large", { suggestion: "Shorter period or week grain", cause: error });
  }
  if (
    reasons.includes("timeout") ||
    reasons.includes("jobTimeout") ||
    /timed out|timeout|deadline exceeded|job execution was cancelled/i.test(text)
  ) {
    return new ReportsError("timeout", "Query timed out", { cause: error });
  }
  return new ReportsError("warehouse_error", "Warehouse error", { cause: error });
}

// ---------------------------------------------------------------------------
// Row normalisation
// ---------------------------------------------------------------------------

/** NUMERIC/BIGNUMERIC (Big), INT64, FLOAT64 or numeric strings -> number; NULL -> null. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  const s = typeof value === "object" && "value" in (value as object) ? String((value as { value: unknown }).value) : String(value);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** DATE (BigQueryDate {value}) or string -> `YYYY-MM-DD`. */
function toDate(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as object)) return String((value as { value: unknown }).value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Raw SQL rows -> ComponentRow[]. Only the aliases compile.ts emits are read,
 * so the evaluator never sees a column name. A money component is detected by
 * its `__nat` column; for every other component nat === disp.
 */
export function normaliseRows(raw: ReadonlyArray<Record<string, unknown>>, query: Pick<CompiledQuery, "components" | "marts">): ComponentRow[] {
  return raw.map((r) => {
    const guards: Partial<Record<MartId, MartGuards>> = {};
    for (const mart of query.marts) {
      const months = r[guardAlias(mart, "fx_missing_months")];
      guards[mart] = {
        nRows: toNumber(r[guardAlias(mart, "n_rows")]) ?? 0,
        foreignCcyRows: toNumber(r[guardAlias(mart, "foreign_ccy_rows")]) ?? 0,
        fxMissingRows: toNumber(r[guardAlias(mart, "fx_missing_rows")]) ?? 0,
        fxMissingMonths: Array.isArray(months) ? months.map(toDate).sort() : [],
      };
    }
    const values: Partial<Record<ComponentId, ComponentSum>> = {};
    for (const id of query.components) {
      const alias = componentAlias(id);
      if (`${alias}__nat` in r) {
        values[id] = { nat: toNumber(r[`${alias}__nat`]), disp: toNumber(r[`${alias}__disp`]) };
      } else {
        const v = toNumber(r[alias]);
        values[id] = { nat: v, disp: v };
      }
    }
    const period = r.period === "cmp" ? "cmp" : "cur";
    const bucket = r.bucket === null || r.bucket === undefined ? TOTAL_BUCKET : toDate(r.bucket);
    return { clientId: String(r.client_id), period, bucket, guards, values };
  });
}

// ---------------------------------------------------------------------------
// Cache layer (the one swappable function)
// ---------------------------------------------------------------------------

interface Payload {
  rows: ComponentRow[];
  generatedAt: string;
}

const MEMORY_MAX = 200;
const memory = new Map<string, { expires: number; payload: Payload }>();

function memoryGet(key: string): Payload | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    memory.delete(key);
    return null;
  }
  memory.delete(key); // refresh LRU order
  memory.set(key, hit);
  return hit.payload;
}

function memorySet(key: string, payload: Payload, ttlS: number): void {
  memory.set(key, { expires: Date.now() + ttlS * 1000, payload });
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

async function memoryThrough(key: string, ttlS: number, load: () => Promise<Payload>): Promise<{ payload: Payload; cached: boolean }> {
  const hit = memoryGet(key);
  if (hit) return { payload: hit, cached: true };
  const payload = await load();
  memorySet(key, payload, ttlS);
  return { payload, cached: false };
}

/** Next's cache needs a request context; outside one (scripts) it throws this invariant. */
function isMissingNextCache(error: unknown): boolean {
  return /incrementalCache|static generation store|requestAsyncStorage/i.test(errorText(error).text);
}

/**
 * Read-through cache. `cached` is true when `load` did not run for this call.
 * Swap the implementation here and nowhere else.
 */
async function cacheThrough(key: string, ttlS: number, load: () => Promise<Payload>): Promise<{ payload: Payload; cached: boolean }> {
  if (process.env.REPORTS_CACHE === "memory") return memoryThrough(key, ttlS, load);
  let ran = false;
  const cachedLoad = unstable_cache(
    async () => {
      ran = true;
      return load();
    },
    ["rpt", String(SEMANTIC_VERSION), key],
    { revalidate: ttlS, tags: [CACHE_TAGS.data, CACHE_TAGS.bigquery] }
  );
  try {
    const payload = await cachedLoad();
    return { payload, cached: !ran };
  } catch (error) {
    if (!ran && isMissingNextCache(error)) return memoryThrough(key, ttlS, load);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * assertReportsAccess() lives in lib/authz.ts (WP3, written in parallel). It is
 * looked up on the module namespace so this file compiles before WP3 lands;
 * when it is absent the runner fails closed. After merging WP3 this can become
 * a plain named import.
 */
async function assertAccess(): Promise<void> {
  const gate = (authz as unknown as { assertReportsAccess?: AssertReportsAccess }).assertReportsAccess;
  if (typeof gate !== "function") throw new Error("Not authorised.");
  await gate();
}

// ---------------------------------------------------------------------------
// runCached
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<{ payload: Payload; cached: boolean }>>();

async function execute(query: CompiledQuery, ctx: RunContext): Promise<Payload> {
  try {
    const result = await queryJob<Record<string, unknown>>(query.sql, {
      params: query.params,
      types: query.types,
      maximumBytesBilled: maxBytesBilled(),
      jobTimeoutMs: JOB_TIMEOUT_MS,
      labels: jobLabels(ctx),
    });
    return { rows: normaliseRows(result.rows, query), generatedAt: new Date().toISOString() };
  } catch (error) {
    const mapped = mapWarehouseError(error);
    console.error(`[reports] run failed (${mapped.code}) key=${query.key.slice(0, 12)}:`, errorText(error).text.slice(0, 500));
    throw mapped;
  }
}

export const runCached: RunCached = async (query: CompiledQuery, ctx: RunContext): Promise<RunResult> => {
  await assertAccess();

  let pending = inflight.get(query.key);
  const joined = pending !== undefined;
  if (!pending) {
    pending = cacheThrough(query.key, cacheTtlSeconds(ctx.rangeTo), () => execute(query, ctx));
    inflight.set(query.key, pending);
    const settle = () => {
      if (inflight.get(query.key) === pending) inflight.delete(query.key);
    };
    pending.then(settle, settle);
  }

  try {
    const { payload, cached } = await pending;
    return { rows: payload.rows, generatedAt: payload.generatedAt, cached: cached || joined };
  } catch (error) {
    throw mapWarehouseError(error);
  }
};
