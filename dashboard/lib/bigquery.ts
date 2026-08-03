/**
 * BigQuery client. Server-only — never import this in a client component.
 *
 * Reads the sa-frontend-reader service account JSON from a base64-encoded env var
 * to avoid committing JSON files. The SA has bigquery.dataViewer ONLY on the mart
 * dataset — by design, the frontend cannot read raw PII.
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
  // development only — run `gcloud auth application-default login` and the app
  // reads BigQuery as you, with no key file on disk to leak. In production the
  // env var is always set, and it maps to sa-frontend-reader, which is scoped
  // to the mart dataset. ADC would run with your own (much wider) permissions,
  // so it must never be the production path.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GCP_SERVICE_ACCOUNT_KEY_BASE64 is not set. Production must use the " +
        "sa-frontend-reader key — Application Default Credentials would run " +
        "with far broader permissions than this app should have."
    );
  }

  _client = new BigQuery({ projectId, location: "EU" });
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
  // The demo client is served entirely from `lib/demo`. If a query ever reaches
  // here carrying its id, some code path was missed — and the failure mode that
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

/**
 * Convenience: get the canonical project ID prefix for fully-qualified table names.
 */
export const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "oneeighty-warehouse";
