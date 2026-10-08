/**
 * Promotions running: the ClickUp promo calendars (list_kind 'promo', synced
 * hourly into mart.plan_input as level 'Promo') with the attribution of the
 * plan layer (mart.plan_promo_perf, grain 'total'). Pure, safe in client
 * components.
 *
 * Shown: every promo running today (Europe/Prague) and every promo starting
 * within 7 days, rejected and on hold left out (as the attribution layer does).
 * Sorted by end date, soonest first.
 *
 * Every figure is a stored one. The offer is the ClickUp Mechanic and Coupon
 * codes fields exactly as entered; n/a when empty. Performance is the plan
 * layer's attributed orders and revenue over its own window up to the
 * client's last day of data, against the task's Target revenue, Target orders
 * and Target units where ClickUp has them.
 */

import { formatMoney, formatNumber } from "@/lib/format";
import type { AlertCard } from "./model";
import { alertKey } from "./model";

/** How many days ahead an upcoming promo is listed. */
export const UPCOMING_DAYS = 7;
/** Promo ending rule: last day today, tomorrow or in 2 days. */
export const ENDING_DAYS = 2;

export interface PromoRow {
  clientId: string;
  clientName: string;
  currency: string;
  taskId: string;
  name: string;
  start: string;
  end: string;
  status: string | null;
  mechanic: string | null;
  couponCodes: string | null;
  targetRevenue: number | null;
  targetOrders: number | null;
  targetUnits: number | null;
  /** The attribution row, when the plan layer has one. */
  perf: {
    windowStart: string;
    windowEnd: string;
    asOf: string | null;
    orders: number | null;
    revenue: number | null;
    units: number | null;
    isStorewide: boolean;
  } | null;
}

export interface PromoItem extends PromoRow {
  state: "running" | "upcoming";
  /** Days from today to the start (upcoming) or to the last day (running). */
  startsIn: number;
  endsIn: number;
  /** Today's day number in the window, 1 on the first day. */
  day: number;
  totalDays: number;
  /** Attribution up to as of, only when it covers at least one day of the window. */
  hasPerf: boolean;
  goalsUrl: string;
  clickupUrl: string;
}

function days(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function promoItems(rows: PromoRow[], today: string): PromoItem[] {
  const out: PromoItem[] = [];
  for (const r of rows) {
    if (!r.start || !r.end || r.end < r.start) continue;
    if (r.status === "rejected" || r.status === "on hold") continue;
    const running = r.start <= today && today <= r.end;
    const startsIn = days(today, r.start);
    if (!running && !(startsIn > 0 && startsIn <= UPCOMING_DAYS)) continue;
    const hasPerf = running && r.perf !== null && r.perf.asOf !== null && r.perf.asOf >= r.perf.windowStart;
    out.push({
      ...r,
      state: running ? "running" : "upcoming",
      startsIn,
      endsIn: days(today, r.end),
      day: running ? days(r.start, today) + 1 : 0,
      totalDays: days(r.start, r.end) + 1,
      hasPerf,
      goalsUrl: `/goals?client=${encodeURIComponent(r.clientId)}&view=promo&period=${encodeURIComponent(r.taskId)}`,
      clickupUrl: `https://app.clickup.com/t/${encodeURIComponent(r.taskId)}`,
    });
  }
  return out.sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

export function endsLabel(n: number): string {
  return n === 0 ? "Ends today" : n === 1 ? "Ends tomorrow" : `Ends in ${n} days`;
}

export function startsLabel(n: number): string {
  return n === 1 ? "Starts tomorrow" : `Starts in ${n} days`;
}

/** "7 Oct" from `2026-10-07`. */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * "Promo ending in 2 days or less", computed in the app when the daily
 * snapshot cannot be used. Same key, text and money as 282.
 */
export function promoEndingCards(items: PromoItem[], czkRates: Map<string, number>): AlertCard[] {
  const out: AlertCard[] = [];
  for (const p of items) {
    if (p.state !== "running" || p.endsIn > ENDING_DAYS) continue;
    const perf = p.perf;
    const left =
      p.targetRevenue !== null && perf?.revenue !== null && perf?.revenue !== undefined && p.targetRevenue > perf.revenue
        ? p.targetRevenue - perf.revenue
        : null;
    const rate = p.currency === "CZK" ? 1 : czkRates.get(p.currency) ?? null;
    const when = p.endsIn === 0 ? "today" : p.endsIn === 1 ? "tomorrow" : `in ${p.endsIn} days`;
    const detail =
      perf && perf.orders !== null && perf.asOf
        ? `${formatNumber(perf.orders)} ${perf.orders === 1 ? "order" : "orders"} · ${formatMoney(perf.revenue, p.currency)}` +
          (p.targetRevenue !== null ? ` of ${formatMoney(p.targetRevenue, p.currency)}` : "") +
          ` through ${shortDay(perf.asOf)}`
        : null;
    const key = alertKey("promo_end", p.clientId, p.taskId);
    out.push({
      id: key,
      alertKey: key,
      ruleId: "promo_end",
      rule: "Promo ending",
      client: p.clientName,
      clientId: p.clientId,
      fact: `${p.name} ends ${when}.`,
      detail,
      stake: left !== null ? { value: left, currency: p.currency, label: "Left to goal" } : null,
      stakeCzk: left !== null && rate !== null ? left * rate : null,
      href: p.goalsUrl,
      action: "Open promo",
      tone: "warning",
      firstSeen: null,
      daysOpen: null,
      source: "live",
    });
  }
  return out;
}
