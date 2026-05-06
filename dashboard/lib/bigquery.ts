/**
 * BigQuery client. Server-only — never import this in a client component.
 *
 * Reads the sa-frontend-reader service account JSON from a base64-encoded env var
 * to avoid committing JSON files. The SA has bigquery.dataViewer ONLY on the mart
 * dataset — by design, the frontend cannot read raw PII.
 */

import { BigQuery } from "@google-cloud/bigquery";
import "server-only";

let _client: BigQuery | null = null;

function getClient(): BigQuery {
  if (_client) return _client;

  const projectId = process.env.GCP_PROJECT_ID;
  const keyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;

  if (!projectId) throw new Error("GCP_PROJECT_ID env var not set");
  if (!keyBase64) throw new Error("GCP_SERVICE_ACCOUNT_KEY_BASE64 env var not set");

  const credentials = JSON.parse(
    Buffer.from(keyBase64, "base64").toString("utf-8")
  );

  _client = new BigQuery({ projectId, credentials, location: "EU" });
  return _client;
}

/**
 * Run a parameterized query. ALWAYS use this — never string-interpolate user input.
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
  const bq = getClient();
  const [rows] = await bq.query({ query: sql, params, location: "EU" });
  return rows as T[];
}

/**
 * Convenience: get the canonical project ID prefix for fully-qualified table names.
 */
export const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "oneeighty-warehouse";
