import "server-only";

/**
 * Promotions running: one read of the plan layer, memoised per request so the
 * Promotions section and the For you fallback share it.
 *
 *   mart.plan_input        level 'Promo' rows (ClickUp promo calendars, synced
 *                          hourly): name, dates, status, Mechanic, Coupon
 *                          codes, Target revenue / orders / units
 *   mart.plan_promo_perf   grain 'total': attributed orders, revenue and units
 *                          over the attribution window up to as of
 *   ref.clients            name and trading currency
 *
 * "Today" is the Europe/Prague date, read from BigQuery so the section and the
 * daily alert job (282) agree on it.
 */

import * as React from "react";
import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { guarded } from "@/lib/home/shopify/data";
import { promoItems, UPCOMING_DAYS, type PromoItem, type PromoRow } from "@/lib/home/alerts/promos";

type Raw = Record<string, unknown>;

const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn);

const day = (v: unknown): string | null => isoDate(v as Parameters<typeof isoDate>[0]);
const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

async function fetchPromos(): Promise<{ today: string; rows: PromoRow[] }> {
  const rows = await query<Raw>(
    `WITH d AS (SELECT CURRENT_DATE('Europe/Prague') AS today)
     SELECT
       d.today, p.client_id, c.name AS client_name, c.currency,
       p.task_id, p.name, p.start_date, p.end_date, p.status, p.mechanic, p.coupon_codes,
       p.target_revenue, p.target_orders, p.target_units,
       f.window_start, f.window_end, f.as_of, f.attr_orders, f.attr_revenue, f.attr_units, f.is_storewide
     FROM ${PLAN_TABLES.planInput} p
     CROSS JOIN d
     JOIN \`${PROJECT_ID}.ref.clients\` c ON c.client_id = p.client_id
     LEFT JOIN ${PLAN_TABLES.promoPerf} f
       ON f.client_id = p.client_id AND f.task_id = p.task_id AND f.grain = 'total'
     WHERE p.level = 'Promo'
       AND IFNULL(p.status, '') NOT IN ('rejected', 'on hold')
       AND p.start_date IS NOT NULL AND p.end_date IS NOT NULL
       AND p.end_date >= d.today
       AND p.start_date <= DATE_ADD(d.today, INTERVAL ${UPCOMING_DAYS} DAY)`
  );
  let today = "";
  const out: PromoRow[] = [];
  for (const r of rows) {
    today = day(r.today) ?? today;
    const clientId = String(r.client_id);
    if (isDemo(clientId)) continue;
    const windowStart = day(r.window_start);
    const windowEnd = day(r.window_end);
    out.push({
      clientId,
      clientName: String(r.client_name ?? clientId),
      currency: String(r.currency ?? "CZK"),
      taskId: String(r.task_id),
      name: String(r.name ?? r.task_id),
      start: day(r.start_date) ?? "",
      end: day(r.end_date) ?? "",
      status: text(r.status),
      mechanic: text(r.mechanic),
      couponCodes: text(r.coupon_codes),
      targetRevenue: num(r.target_revenue),
      targetOrders: num(r.target_orders),
      targetUnits: num(r.target_units),
      perf:
        windowStart && windowEnd
          ? {
              windowStart,
              windowEnd,
              asOf: day(r.as_of),
              orders: num(r.attr_orders),
              revenue: num(r.attr_revenue),
              units: num(r.attr_units),
              isStorewide: r.is_storewide === true,
            }
          : null,
    });
  }
  if (!today) {
    const [d] = await query<Raw>(`SELECT CURRENT_DATE('Europe/Prague') AS today`);
    today = day(d?.today) ?? new Date().toISOString().slice(0, 10);
  }
  return { today, rows: out };
}

export interface PromotionsData {
  today: string | null;
  items: PromoItem[] | null;
  /** Why the promos are n/a. Null when read. */
  note: string | null;
}

export const loadPromotions = perRequest(async (): Promise<PromotionsData> => {
  const r = await guarded("mart.plan_input", fetchPromos);
  if (!r.value) return { today: null, items: null, note: r.note };
  return { today: r.value.today, items: promoItems(r.value.rows, r.value.today), note: null };
});
