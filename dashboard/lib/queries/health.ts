/**
 * Data Health — is the warehouse actually current, and does it agree with itself?
 *
 * ── Why freshness is derived from mart, not from the pipeline log ────────────
 * `sa-frontend-reader` holds Data Viewer on the `mart` dataset only, by design:
 * the frontend must not be able to read raw PII. `ops.pipeline_log` sits outside
 * that grant, so "did the workflow run" isn't readable here.
 *
 * That turns out to be the better signal anyway. A workflow can run, succeed,
 * and land nothing. What matters is whether *data arrived*, and that is exactly
 * what MAX(date) per source in the marts measures. The pipeline log is fetched
 * as a bonus and degrades to empty if the grant isn't there.
 *
 * ── Freshness expectations differ per source ────────────────────────────────
 * Shops report same-day. Ad platforms are structurally D-1 — Google Ads cannot
 * be queried for today at all, which is why the warehouse rule is
 * `WHERE date < CURRENT_DATE()`. Showing one uniform "last updated" would make
 * every ad platform look permanently late, so each source carries its own
 * expectation and is judged against that.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate } from "@/lib/coerce";
import type { Client } from "@/lib/clients";
import { DEMO_CLIENT_ID, isDemo } from "@/lib/demo/client";
import { addDays, dataThrough as demoDataThrough } from "@/lib/demo/business";

/** Last demo campaign send — a few days back, so Klaviyo reads healthy. */
function demoLastEmailSend(): string {
  return addDays(demoDataThrough(), -3);
}


export type FreshnessStatus = "ok" | "late" | "stale" | "blocked" | "paused";

export interface SourceFreshness {
  clientId: string;
  clientName: string;
  source: string;
  platform: string;
  lastDate: string | null;
  /** Human description of what "current" means for this source. */
  expected: string;
  /** How many days behind today the source may be before it's late. */
  toleranceDays: number;
  status: FreshnessStatus;
  note?: string;
  /**
   * Registry status of the client this row belongs to. Anything other than
   * "active" means no workflow is fetching for them, so a stale date here is
   * expected rather than a fault — and the page has to say which it is.
   */
  clientStatus: string;
}

interface FreshnessRow {
  client_id: string;
  shop_last: { value: string } | null;
  meta_last: { value: string } | null;
  google_last: { value: string } | null;
}

function daysBehind(lastDate: string | null, today: string): number | null {
  if (!lastDate) return null;
  const ms = Date.parse(today) - Date.parse(lastDate);
  return Math.round(ms / 86_400_000);
}

function classify(
  lastDate: string | null,
  toleranceDays: number,
  today: string,
  /**
   * Non-active clients are skipped by every ingest workflow, so their data is
   * frozen on purpose. Reporting that as "stale" would put a red row on the
   * board for something nobody needs to fix, and real faults would learn to be
   * ignored beside it.
   */
  clientActive = true
): FreshnessStatus {
  if (!clientActive) return "paused";
  if (!lastDate) return "blocked";
  const behind = daysBehind(lastDate, today);
  if (behind === null) return "blocked";
  if (behind <= toleranceDays) return "ok";
  if (behind <= toleranceDays + 2) return "late";
  return "stale";
}

export async function getSourceFreshness(
  clients: Array<Client & { status?: string }>
): Promise<SourceFreshness[]> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await query<FreshnessRow>(
    `SELECT
       client_id,
       MAX(IF(revenue      IS NOT NULL, date, NULL)) AS shop_last,
       MAX(IF(meta_spend   IS NOT NULL, date, NULL)) AS meta_last,
       MAX(IF(google_spend IS NOT NULL, date, NULL)) AS google_last
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
     GROUP BY client_id`
  );

  // Klaviyo lands on send, not daily — a gap here means "no campaign sent",
  // which is not the same as a broken pipeline. Judged on a looser tolerance.
  const email = await query<{ client_id: string; last_send: { value: string } }>(
    `SELECT client_id, MAX(send_date) AS last_send
     FROM \`${PROJECT_ID}.mart.mart_email_campaign_message_perf\`
     WHERE send_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
     GROUP BY client_id`
  ).catch((): Array<{ client_id: string; last_send: { value: string } }> => []);

  // The demo client has no mart rows, so it gets a synthesised one here rather
  // than a branch inside the loop below — that way its sources are classified
  // late, stale or healthy by exactly the same rules as everyone else's.
  if (clients.some((c) => isDemo(c.clientId))) {
    const through = { value: demoDataThrough() };
    rows.push({
      client_id: DEMO_CLIENT_ID,
      shop_last: through,
      meta_last: through,
      google_last: through,
    });
    email.push({
      client_id: DEMO_CLIENT_ID,
      last_send: { value: demoLastEmailSend() },
    });
  }

  const out: SourceFreshness[] = [];

  for (const client of clients) {
    const row = rows.find((r) => r.client_id === client.clientId);
    const active = (client.status ?? "active") === "active";
    const base = {
      clientId: client.clientId,
      clientName: client.name,
      clientStatus: client.status ?? "active",
    };

    if (client.capabilities.shopify || client.capabilities.shoptet) {
      const platform = client.capabilities.shopify ? "Shopify" : "Shoptet";
      const last = isoDate(row?.shop_last ?? null);
      out.push({
        ...base,
        source: platform,
        platform: platform.toLowerCase(),
        lastDate: last,
        expected: "Same day",
        toleranceDays: 1,
        status: classify(last, 1, today, active),
      });
    }

    if (client.capabilities.meta) {
      const last = isoDate(row?.meta_last ?? null);
      out.push({
        ...base,
        source: "Meta",
        platform: "meta",
        lastDate: last,
        expected: "D-1",
        toleranceDays: 2,
        status: classify(last, 2, today, active),
      });
    }

    // Google is listed whenever spend is actually present, even if the registry
    // flag says otherwise — the registry is known to be wrong about this and the
    // drift check below reports it separately.
    const googleLast = isoDate(row?.google_last ?? null);
    if (client.capabilities.googleAds || googleLast) {
      out.push({
        ...base,
        source: "Google Ads",
        platform: "google",
        lastDate: googleLast,
        expected: "D-1",
        toleranceDays: 2,
        status: classify(googleLast, 2, today, active),
      });
    }

    if (client.capabilities.klaviyo) {
      const last = isoDate(
        email.find((e) => e.client_id === client.clientId)?.last_send ?? null
      );
      out.push({
        ...base,
        source: "Klaviyo campaigns",
        platform: "klaviyo",
        lastDate: last,
        expected: "On send",
        toleranceDays: 21,
        status: classify(last, 21, today, active),
      });

      // Subscriber series has never landed — the backfill is blocked on a
      // Klaviyo segment that hasn't been created. Unknown, not zero.
      out.push({
        ...base,
        source: "Klaviyo subscribers",
        platform: "klaviyo",
        lastDate: null,
        expected: "Daily",
        toleranceDays: 2,
        status: "blocked",
        note: "Backfill blocked — needs a Klaviyo segment mirroring the master list.",
      });
    }

    if (client.capabilities.ecomail) {
      out.push({
        ...base,
        source: "Ecomail",
        platform: "ecomail",
        lastDate: null,
        expected: "On send",
        toleranceDays: 21,
        status: "blocked",
        note: "No daily mart view yet.",
      });
    }
  }

  return out;
}

export interface PipelineRun {
  startedAt: string;
  workflow: string;
  rows: number | null;
  durationSeconds: number | null;
  status: string;
}

/**
 * Recent pipeline runs. Returns empty if `ops` isn't readable by this SA —
 * the page renders a note rather than an error, because a missing grant is a
 * configuration gap, not a failure worth interrupting the whole screen for.
 */
export async function getPipelineRuns(limit = 12): Promise<PipelineRun[] | null> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT started_at, workflow_name, rows_written, status,
              TIMESTAMP_DIFF(finished_at, started_at, SECOND) AS duration_s
       FROM \`${PROJECT_ID}.ops.pipeline_log\`
       WHERE started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
       ORDER BY started_at DESC
       LIMIT @limit`,
      { limit }
    );

    return rows.map((r) => ({
      startedAt: String((r.started_at as { value?: string })?.value ?? r.started_at),
      workflow: String(r.workflow_name ?? "—"),
      rows: r.rows_written === null ? null : Number(r.rows_written),
      durationSeconds: r.duration_s === null ? null : Number(r.duration_s),
      status: String(r.status ?? "unknown"),
    }));
  } catch {
    return null;
  }
}
