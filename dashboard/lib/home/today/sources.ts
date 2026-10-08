import "server-only";

/**
 * Home, Today variant: the reads that only this page needs.
 *
 * Every read is fail soft: a missing object, a refused permission or any other
 * error comes back as `status: "na"` with the reason, is logged, and produces
 * no items. A source that could not be read is never read as "nothing to do".
 *
 *   packs       mart.mart_creative_adset_perf   ad sets first delivered in the
 *                                               last 60 days and still spending
 *   unmapped    mart.mart_creative_unmapped     ads with spend and no brief, since
 *                                               the client's ClickUp pipeline started
 *   sync        ops.clickup_sync_issues         the latest sync run only
 *   feeds       ops.v_pipeline_alerts           stale or never-loaded feeds, FX, Google Ads
 *   tasks       ClickUp list Founder Responsibilities, open tasks due by today
 *
 * ClickUp is read with the same server-side token as `lib/home/clickup.ts`
 * (`CLICKUP_API_TOKEN`), with one plain GET. Nothing here writes anywhere.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { isMissingObject } from "@/lib/queries/errors";

type Raw = Record<string, unknown>;

export type Read<T> = { status: "ok"; rows: T[] } | { status: "na"; rows: T[]; note: string };

const T = (dataset: string, table: string) => `\`${PROJECT_ID}.${dataset}.${table}\``;

function reason(source: string, error: unknown): string {
  if (isMissingObject(error)) return `${source} does not exist yet.`;
  const message = String((error as { message?: string } | null)?.message ?? error);
  if (/permission|access denied/i.test(message)) return `No read access to ${source}.`;
  return `${source} could not be read.`;
}

async function read<T>(source: string, run: () => Promise<T[]>): Promise<Read<T>> {
  try {
    return { status: "ok", rows: await run() };
  } catch (error) {
    const note = reason(source, error);
    console.error(`[home/today] ${source}: ${String((error as Error)?.message ?? error)}`);
    return { status: "na", rows: [], note };
  }
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const day = (v: unknown): string | null => isoDate(v as never);

/* ------------------------------------------------------------------------ */
/* Packs                                                                    */
/* ------------------------------------------------------------------------ */

export interface PackRow {
  clientId: string;
  adsetId: string;
  name: string | null;
  campaign: string | null;
  /** First day with spend. */
  firstDay: string;
  /** Last day with spend. */
  lastDay: string;
  /** The client's latest loaded day in the mart. */
  through: string;
  spend: number;
  purchases: number;
  /** Spend over the 7 days ending `through`. */
  spend7d: number;
}

/** Packs launched in the last 60 days that spent on the latest day or the day before. */
export const PACKS_SQL = `
  WITH a AS (
    SELECT * FROM ${T("mart", "mart_creative_adset_perf")}
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 400 DAY) AND adset_id IS NOT NULL
  ),
  t AS (SELECT client_id, MAX(date) AS through FROM a GROUP BY client_id),
  p AS (
    SELECT a.client_id, a.adset_id,
      ARRAY_AGG(a.adset_name IGNORE NULLS ORDER BY a.date DESC LIMIT 1)[SAFE_OFFSET(0)] AS adset_name,
      ARRAY_AGG(a.campaign_name IGNORE NULLS ORDER BY a.date DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name,
      MIN(IF(a.spend > 0, a.date, NULL)) AS first_day,
      MAX(IF(a.spend > 0, a.date, NULL)) AS last_day,
      ANY_VALUE(t.through) AS through,
      SUM(a.spend) AS spend,
      SUM(a.purchases) AS purchases,
      SUM(IF(a.date > DATE_SUB(t.through, INTERVAL 7 DAY), a.spend, 0)) AS spend_7d
    FROM a JOIN t USING (client_id)
    GROUP BY a.client_id, a.adset_id
  )
  SELECT * FROM p
  WHERE first_day >= DATE_SUB(through, INTERVAL 60 DAY)
    AND last_day >= DATE_SUB(through, INTERVAL 1 DAY)`;

export function readPacks(): Promise<Read<PackRow>> {
  return read("mart_creative_adset_perf", async () => {
    const rows = await query<Raw>(PACKS_SQL);
    return rows
      .filter((r) => !isDemo(String(r.client_id)))
      .flatMap((r) => {
        const firstDay = day(r.first_day);
        const lastDay = day(r.last_day);
        const through = day(r.through);
        if (!firstDay || !lastDay || !through) return [];
        return [
          {
            clientId: String(r.client_id),
            adsetId: String(r.adset_id),
            name: str(r.adset_name),
            campaign: str(r.campaign_name),
            firstDay,
            lastDay,
            through,
            spend: num(r.spend) ?? 0,
            purchases: num(r.purchases) ?? 0,
            spend7d: num(r.spend_7d) ?? 0,
          },
        ];
      });
  });
}

/* ------------------------------------------------------------------------ */
/* Unmapped ads                                                             */
/* ------------------------------------------------------------------------ */

export interface UnmappedRow {
  clientId: string;
  adId: string;
  adName: string;
  spend: number;
  firstSeen: string | null;
}

export function readUnmapped(): Promise<Read<UnmappedRow>> {
  return read("mart_creative_unmapped", async () => {
    const rows = await query<Raw>(
      `SELECT client_id, ad_id, ad_name, spend, first_seen
       FROM ${T("mart", "mart_creative_unmapped")}
       WHERE NOT before_pipeline
       ORDER BY spend DESC`
    );
    return rows
      .filter((r) => !isDemo(String(r.client_id)))
      .map((r) => ({
        clientId: String(r.client_id),
        adId: String(r.ad_id),
        adName: String(r.ad_name ?? r.ad_id),
        spend: num(r.spend) ?? 0,
        firstSeen: day(r.first_seen),
      }));
  });
}

/* ------------------------------------------------------------------------ */
/* ClickUp sync issues                                                      */
/* ------------------------------------------------------------------------ */

export interface SyncIssueRow {
  clientId: string | null;
  severity: string;
  kind: string;
  entityId: string | null;
  detail: string | null;
  syncedAt: string;
}

/**
 * The latest run. One run writes its rows within a few minutes of each other
 * (one INSERT per rule), so "latest run" is every row within ten minutes of
 * the newest one. Seven days back at most: older than that, there is no
 * current run to speak of and the feed alert says so.
 */
export function readSyncIssues(): Promise<Read<SyncIssueRow>> {
  return read("ops.clickup_sync_issues", async () => {
    const rows = await query<Raw>(
      `WITH s AS (
         SELECT * FROM ${T("ops", "clickup_sync_issues")}
         WHERE DATE(synced_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
       ),
       m AS (SELECT MAX(synced_at) AS last_run FROM s)
       SELECT s.client_id, LOWER(s.severity) AS severity, s.kind, s.entity_id, s.detail,
              FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', m.last_run) AS last_run
       FROM s CROSS JOIN m
       WHERE s.synced_at >= TIMESTAMP_SUB(m.last_run, INTERVAL 10 MINUTE)`
    );
    return rows
      .filter((r) => !isDemo(String(r.client_id)))
      .map((r) => ({
        clientId: str(r.client_id),
        severity: String(r.severity ?? ""),
        kind: String(r.kind ?? ""),
        entityId: str(r.entity_id),
        detail: str(r.detail),
        syncedAt: String(r.last_run ?? ""),
      }));
  });
}

/* ------------------------------------------------------------------------ */
/* Pipeline alerts                                                          */
/* ------------------------------------------------------------------------ */

export interface AlertRow {
  /** `*` for warehouse-wide alerts (monitor, FX). */
  clientId: string;
  feedKey: string;
  severity: string;
  status: string;
  message: string;
  stalenessHours: number | null;
}

export function readAlerts(): Promise<Read<AlertRow>> {
  return read("ops.v_pipeline_alerts", async () => {
    const rows = await query<Raw>(
      `SELECT client_id, feed_key, severity, status, message, staleness_hours
       FROM ${T("ops", "v_pipeline_alerts")}`
    );
    return rows
      .filter((r) => !isDemo(String(r.client_id)))
      .map((r) => ({
        clientId: String(r.client_id ?? "*"),
        feedKey: String(r.feed_key ?? ""),
        severity: String(r.severity ?? "").toLowerCase(),
        status: String(r.status ?? ""),
        message: String(r.message ?? ""),
        stalenessHours: num(r.staleness_hours),
      }));
  });
}

/* ------------------------------------------------------------------------ */
/* Founder Responsibilities (ClickUp)                                       */
/* ------------------------------------------------------------------------ */

/** Company > Founder Responsibilities. */
export const FOUNDER_LIST_ID = "901522165864";

export interface FounderTask {
  id: string;
  name: string;
  url: string;
  /** Due date in ms since epoch. */
  due: number;
  status: string | null;
  assignees: string[];
}

interface RawTask {
  id: string;
  name: string;
  url?: string;
  due_date?: string | null;
  status?: { status?: string } | string;
  assignees?: Array<{ username?: string | null; email?: string | null }>;
}

function token(): string | null {
  const t = process.env.CLICKUP_API_TOKEN;
  // Same cleaning as lib/home/clickup.ts: a pasted value often carries a newline or quotes.
  return t ? t.trim().replace(/^["']|["']$/g, "") : null;
}

/**
 * Open tasks due before `dueBefore` (ms), subtasks included. Read only. A
 * missing token, a refused list or a timeout reads n/a, never "nothing due".
 */
export async function readFounderTasks(dueBefore: number): Promise<Read<FounderTask>> {
  const auth = token();
  if (!auth) return { status: "na", rows: [], note: "ClickUp not connected (CLICKUP_API_TOKEN is not set)." };
  const tasks: FounderTask[] = [];
  for (let page = 0; page < 3; page++) {
    try {
      const res = await fetch(
        `https://api.clickup.com/api/v2/list/${FOUNDER_LIST_ID}/task?include_closed=false&subtasks=true` +
          `&due_date_lt=${dueBefore}&order_by=due_date&page=${page}`,
        { headers: { Authorization: auth }, cache: "no-store", signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[home/today] ClickUp list ${FOUNDER_LIST_ID} failed: ${res.status} ${body.slice(0, 300)}`);
        const note =
          res.status === 401 || res.status === 403
            ? "No read access to the ClickUp list Founder Responsibilities."
            : res.status === 404
              ? "The ClickUp list Founder Responsibilities was not found."
              : "The ClickUp list Founder Responsibilities could not be read.";
        return { status: "na", rows: [], note };
      }
      const json = (await res.json()) as { tasks?: RawTask[]; last_page?: boolean };
      for (const t of json.tasks ?? []) {
        const due = Number(t.due_date);
        if (!Number.isFinite(due) || due <= 0) continue;
        const status = typeof t.status === "string" ? t.status : t.status?.status;
        tasks.push({
          id: t.id,
          name: t.name,
          url: t.url ?? `https://app.clickup.com/t/${t.id}`,
          due,
          status: status ? status.toLowerCase() : null,
          assignees: (t.assignees ?? []).flatMap((a) => {
            const name = a.username?.trim() || a.email?.split("@")[0] || "";
            return name ? [name] : [];
          }),
        });
      }
      if (json.last_page !== false || (json.tasks ?? []).length === 0) break;
    } catch (error) {
      console.error(`[home/today] ClickUp list ${FOUNDER_LIST_ID} unreachable: ${(error as Error)?.message ?? error}`);
      return { status: "na", rows: [], note: "ClickUp did not answer in time." };
    }
  }
  return { status: "ok", rows: tasks };
}
