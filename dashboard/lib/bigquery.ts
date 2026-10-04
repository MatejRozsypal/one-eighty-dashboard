/**
 * BigQuery client. Server-only, never import this in a client component.
 *
 * Reads the sa-frontend-reader service account JSON from a base64-encoded env var
 * to avoid committing JSON files. The SA has bigquery.dataViewer ONLY on the mart
 * dataset: by design, the frontend cannot read raw PII.
 */

import { BigQuery } from "@google-cloud/bigquery";
import "server-only";
import { DEMO_CLIENT_ID } from "@/lib/demo/business";

let _client: BigQuery | null = null;

function getClient(): BigQuery {
  if (_client) return _client;

  const projectId = process.env.GCP_PROJECT_ID;
  const keyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;

  if (!projectId) throw new Error("GCP_PROJECT_ID env var not set");

  if (keyBase64) {
    const credentials = JSON.parse(
      Buffer.from(keyBase64, "base64").toString("utf-8")
    );
    _client = new BigQuery({ projectId, credentials, location: "EU" });
    return _client;
  }

  // No key: fall back to Application Default Credentials. This is for local
  // development only: run `gcloud auth application-default login` and the app
  // reads BigQuery as you, with no key file on disk to leak. In production the
  // env var is always set, and it maps to sa-frontend-reader, which is scoped
  // to the mart dataset. ADC would run with your own (much wider) permissions,
  // so it must never be the production path.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GCP_SERVICE_ACCOUNT_KEY_BASE64 is not set. Production must use the " +
        "sa-frontend-reader key: Application Default Credentials would run " +
        "with far broader permissions than this app should have."
    );
  }

  _client = new BigQuery({ projectId, location: "EU" });
  return _client;
}

/**
 * Run a parameterized query. ALWAYS use this, never string-interpolate user input.
 *
 * @example
 *   const rows = await query<{ revenue: number }>(
 *     `SELECT SUM(revenue) AS revenue FROM \`${projectId}.mart.mart_daily_kpis\`
 *      WHERE client_id = @clientId AND date BETWEEN @from AND @to`,
 *     { clientId: 'manami', from: '2026-04-01', to: '2026-05-01' }
 *   );
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, string | number | boolean | Date> = {}
): Promise<T[]> {
  // The demo client is served entirely from `lib/demo`. If a query ever reaches
  // here carrying its id, some code path was missed, and the failure mode that
  // matters is not an error, it is a screen of *real* figures appearing under a
  // fictional brand's name in front of a prospect. BigQuery would happily return
  // zero rows for client_id = 'demo' and the page would render a plausible empty
  // state, so nothing would look wrong. Fail loudly instead.
  if (params.clientId === DEMO_CLIENT_ID) {
    throw new Error(
      `The demo client must never reach BigQuery. A query was issued with ` +
        `clientId = "${DEMO_CLIENT_ID}"; it needs a branch in lib/demo. Query: ` +
        sql.slice(0, 160).replace(/\s+/g, " ")
    );
  }

  const bq = getClient();
  const [rows] = await bq.query({ query: sql, params, location: "EU" });
  return rows as T[];
}

// ---------------------------------------------------------------------------
// queryJob(): the guarded variant used by the Reports suite
// ---------------------------------------------------------------------------

/** A named parameter value. Arrays need an entry in `types` (an empty array has no inferable type). */
export type QueryJobParam = string | number | boolean | Date | string[] | number[];

/** BigQuery parameter type per name: "STRING", "DATE", "INT64", ..., or ["STRING"] for ARRAY<STRING>. */
export type QueryJobParamType = string | [string];

export interface QueryJobOptions {
  params?: Record<string, QueryJobParam>;
  types?: Record<string, QueryJobParamType>;
  /** The job fails (reason bytesBilledLimitExceeded) when it would bill more than this. */
  maximumBytesBilled?: number;
  /** Keys and values: lowercase letters, digits, `_` and `-`, at most 63 characters. */
  labels?: Record<string, string>;
  /** Server-side job timeout. The client waits this long plus a small margin for results. */
  jobTimeoutMs?: number;
  /** Validate and estimate only: no rows, no cost. */
  dryRun?: boolean;
}

export interface QueryJobResult<T> {
  rows: T[];
  jobId: string | null;
  /** From the job statistics when BigQuery reports them (always for a dry run). */
  totalBytesProcessed: number | null;
  totalBytesBilled: number | null;
  cacheHit: boolean | null;
}

const LABEL_RE = /^[a-z][a-z0-9_-]{0,62}$/;
const LABEL_VALUE_RE = /^[a-z0-9_-]{0,63}$/;

/** Provided types whose value @google-cloud/bigquery reads from `.value` (BigQuery._isCustomType). */
const WRAPPED_TYPES: Readonly<Record<string, (v: string) => unknown>> = {
  DATE: (v) => BigQuery.date(v),
  DATETIME: (v) => BigQuery.datetime(v),
  TIME: (v) => BigQuery.time(v),
  TIMESTAMP: (v) => BigQuery.timestamp(v),
};

/**
 * Params as @google-cloud/bigquery needs them. With a provided type of DATE,
 * DATETIME, TIME or TIMESTAMP the library sends `value.value`, which is
 * undefined for a plain `YYYY-MM-DD` string, so the parameter silently
 * arrives as NULL (every `BETWEEN @from AND @to` matches nothing, the job
 * still succeeds, and a dry run cannot tell). Such strings, alone or inside
 * an array, are wrapped in the library's own value class here.
 */
export function toJobParams(
  params: Record<string, QueryJobParam>,
  types: Record<string, QueryJobParamType> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params)) {
    const t = types[name];
    const wrap = WRAPPED_TYPES[(Array.isArray(t) ? t[0] : t ?? "").toUpperCase()];
    if (!wrap) out[name] = value;
    else if (Array.isArray(value)) out[name] = (value as unknown[]).map((v) => (typeof v === "string" ? wrap(v) : v));
    else out[name] = typeof value === "string" ? wrap(value) : value;
  }
  return out;
}

function statNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Run (or dry-run) a parameterized query as an explicit job, with the cost
 * guardrails `query()` does not have: typed array params, maximumBytesBilled,
 * labels, a job timeout and dry runs. `query()` stays as it is for every
 * existing page.
 *
 * Errors are BigQuery's own (ApiError with `errors[].reason`); callers map them.
 */
export async function queryJob<T = Record<string, unknown>>(
  sql: string,
  options: QueryJobOptions = {}
): Promise<QueryJobResult<T>> {
  const params = options.params ?? {};

  // Same rule as query(): the demo client never reaches the warehouse, also
  // not inside an array parameter.
  for (const value of Object.values(params)) {
    const hit = Array.isArray(value)
      ? (value as unknown[]).includes(DEMO_CLIENT_ID)
      : value === DEMO_CLIENT_ID;
    if (hit) {
      throw new Error(
        `The demo client must never reach BigQuery. Query: ` + sql.slice(0, 160).replace(/\s+/g, " ")
      );
    }
  }

  for (const [key, value] of Object.entries(options.labels ?? {})) {
    if (!LABEL_RE.test(key) || !LABEL_VALUE_RE.test(value)) {
      throw new Error(`Invalid BigQuery job label ${key}=${value}`);
    }
  }

  const bq = getClient();
  const [job] = await bq.createQueryJob({
    query: sql,
    params: toJobParams(params, options.types),
    types: options.types,
    location: "EU",
    dryRun: options.dryRun === true ? true : undefined,
    labels: options.labels,
    jobTimeoutMs: options.jobTimeoutMs,
    maximumBytesBilled:
      options.maximumBytesBilled !== undefined ? String(Math.floor(options.maximumBytesBilled)) : undefined,
  });

  const jobId = job.id ?? null;

  if (options.dryRun) {
    const stats = job.metadata?.statistics;
    return {
      rows: [],
      jobId,
      totalBytesProcessed: statNumber(stats?.totalBytesProcessed ?? stats?.query?.totalBytesProcessed),
      totalBytesBilled: null,
      cacheHit: null,
    };
  }

  const [rows] = await job.getQueryResults({
    timeoutMs: options.jobTimeoutMs !== undefined ? options.jobTimeoutMs + 5_000 : undefined,
  });
  const stats = job.metadata?.statistics;
  return {
    rows: rows as T[],
    jobId,
    totalBytesProcessed: statNumber(stats?.totalBytesProcessed ?? stats?.query?.totalBytesProcessed),
    totalBytesBilled: statNumber(stats?.query?.totalBytesBilled),
    cacheHit: typeof stats?.query?.cacheHit === "boolean" ? stats.query.cacheHit : null,
  };
}

/**
 * Convenience: get the canonical project ID prefix for fully-qualified table names.
 */
export const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "oneeighty-warehouse";
