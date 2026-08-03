/**
 * The fictional business behind the demo client.
 *
 * ── Why a model and not a pile of numbers ───────────────────────────────────
 * A demo is read by people who add things up. If revenue does not equal orders
 * times AOV, or CM2 is somehow larger than CM1, the conversation stops being
 * about the product. So nothing here is written down twice: every figure is
 * derived from a day's order count and the brand's economics, and the identities
 * the dashboard relies on hold by construction rather than by careful typing.
 *
 *     revenue        = new revenue + returning revenue
 *     revenue        = net sales + shipping
 *     cm1            = revenue − cogs
 *     cm2            = cm1 − paid spend
 *     cm3            = cm2 − fulfilment
 *
 * ── Why a day is a pure function of its date ────────────────────────────────
 * Every page renders on its own server request. A generator holding state, or
 * one seeded once at module load, would give the headline card and the table
 * under it different numbers for the same day. Here `day("2026-07-14")` returns
 * the same record no matter who asks or in what order, so the pages agree
 * without sharing anything.
 *
 * ── None of this is anyone's data ───────────────────────────────────────────
 * The brand, its products, its customers and its ads are invented. No figure is
 * copied, scaled or derived from a real client. The shape is meant to be
 * plausible for a mid-size DTC brand and nothing more.
 */

import { jitter, unit } from "./random";

// ── The brand ──────────────────────────────────────────────────────────────

export const DEMO_CLIENT_ID = "demo";
export const DEMO_BRAND = "Lumen Botanicals";
/** Shown in the switcher. The suffix is deliberate — nobody should mistake this for a real account. */
export const DEMO_NAME = "Lumen Botanicals (DEMO)";
export const DEMO_CURRENCY = "USD";

/** Months of history. Deep enough for a 12-month YoY and a cohort grid with real age. */
const HISTORY_MONTHS = 30;

/** Orders per day at the start of the history, before growth and seasonality. */
const BASE_ORDERS_PER_DAY = 34;
/** Compounding monthly growth — ~34% a year, a brand that is working but not a rocket. */
const MONTHLY_GROWTH = 0.0246;

const AOV_NEW = 61.5;
const AOV_RETURNING = 88.0;

/** Share of orders placed by first-time customers, early in the history. */
const NEW_SHARE_START = 0.78;
/** …and today. A maturing brand earns a returning base, so this falls. */
const NEW_SHARE_NOW = 0.57;

const MERCHANDISE_MARGIN = 0.681;
const SHIPPING_SHARE = 0.058;
const TAX_RATE = 0.031;

/** Blended MER the media buying holds to, with day-to-day slippage. */
const TARGET_MER = 5.9;
/** Google's share of paid spend; the rest is Meta. */
const GOOGLE_SHARE = 0.29;

/** Cost assumptions — the inputs a warehouse structurally cannot measure. */
export const DEMO_FULFILMENT_PER_ORDER = 4.2;
export const DEMO_OTHER_CM1_PER_ORDER = 0.85;
export const DEMO_OPEX_RATE = 0.28;

/** Fixed rate for the currency toggle. Invented, like everything else here. */
export const DEMO_FX_USD_TO_CZK = 23.4;

// ── Calendar ───────────────────────────────────────────────────────────────

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export function today(): string {
  return iso(new Date());
}

/**
 * Last day the demo warehouse "has". One day behind, like a real overnight
 * pipeline — so the freshness stamp and the Data Health page have something
 * truthful to show rather than claiming data through the current hour.
 */
export function dataThrough(): string {
  return addDays(today(), -1);
}

export function firstDay(): string {
  const d = parse(today());
  d.setUTCMonth(d.getUTCMonth() - HISTORY_MONTHS);
  d.setUTCDate(1);
  return iso(d);
}

/** Every date from `from` to `to`, clamped to the window the demo covers. */
export function datesBetween(from: string, to: string): string[] {
  const start = from < firstDay() ? firstDay() : from;
  const end = to > dataThrough() ? dataThrough() : to;
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function monthsSinceStart(date: string): number {
  const a = parse(firstDay());
  const b = parse(date);
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) +
    b.getUTCDate() / 30
  );
}

/**
 * Seasonality. Q4 carries the year, January pays for it, summer is soft —
 * the shape most consumer brands actually have, and the reason the dashboard
 * offers a previous-year comparison at all.
 */
const MONTH_FACTOR = [
  0.84, // Jan
  0.88, // Feb
  0.96, // Mar
  0.98, // Apr
  1.02, // May
  0.93, // Jun
  0.89, // Jul
  0.94, // Aug
  1.04, // Sep
  1.12, // Oct
  1.58, // Nov — Black Friday
  1.34, // Dec
];

/** Weekends convert worse than weekdays for this kind of brand. */
const WEEKDAY_FACTOR = [0.88, 1.06, 1.07, 1.05, 1.02, 0.97, 0.83];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── A day ──────────────────────────────────────────────────────────────────

export interface DemoDay {
  date: string;
  orders: number;
  newCustomerOrders: number;
  returningCustomerOrders: number;
  uniqueCustomers: number;
  revenue: number;
  netSales: number;
  shippingRevenue: number;
  taxCollected: number;
  grossRevenueInclTax: number;
  newCustomerRevenue: number;
  returningCustomerRevenue: number;
  cogs: number;
  cm1: number;
  metaSpend: number;
  googleSpend: number;
  paidSpend: number;
  cm2: number;
  fulfilment: number;
  cm3: number;
}

/** Share of orders from first-time buyers, drifting down as the base builds. */
export function newShareOn(date: string): number {
  const progress = Math.min(1, monthsSinceStart(date) / HISTORY_MONTHS);
  return NEW_SHARE_START + (NEW_SHARE_NOW - NEW_SHARE_START) * progress;
}

export function day(date: string): DemoDay {
  const d = parse(date);
  const growth = Math.pow(1 + MONTHLY_GROWTH, monthsSinceStart(date));
  const season = MONTH_FACTOR[d.getUTCMonth()];
  const weekday = WEEKDAY_FACTOR[d.getUTCDay()];

  const orders = Math.max(
    1,
    Math.round(
      BASE_ORDERS_PER_DAY * growth * season * weekday * jitter(`orders:${date}`, 0.17)
    )
  );

  const newCustomerOrders = Math.max(
    0,
    Math.min(orders, Math.round(orders * newShareOn(date) * jitter(`newshare:${date}`, 0.06)))
  );
  const returningCustomerOrders = orders - newCustomerOrders;

  // A handful of people order twice in a day; customers are never more than orders.
  const uniqueCustomers = Math.max(1, orders - Math.round(orders * 0.021));

  const newCustomerRevenue = round2(
    newCustomerOrders * AOV_NEW * jitter(`aovnew:${date}`, 0.05)
  );
  const returningCustomerRevenue = round2(
    returningCustomerOrders * AOV_RETURNING * jitter(`aovret:${date}`, 0.05)
  );
  const revenue = round2(newCustomerRevenue + returningCustomerRevenue);

  const shippingRevenue = round2(revenue * SHIPPING_SHARE);
  const netSales = round2(revenue - shippingRevenue);
  const taxCollected = round2(netSales * TAX_RATE);
  const grossRevenueInclTax = round2(revenue + taxCollected);

  const cogs = round2(revenue * (1 - MERCHANDISE_MARGIN));
  const cm1 = round2(revenue - cogs);

  // Spend follows revenue through a target MER, so the ratio stays sane while
  // individual days still have good and bad ones.
  const paidSpend = round2((revenue / TARGET_MER) * jitter(`mer:${date}`, 0.22));
  const googleSpend = round2(paidSpend * GOOGLE_SHARE * jitter(`gshare:${date}`, 0.12));
  const metaSpend = round2(paidSpend - googleSpend);
  const cm2 = round2(cm1 - paidSpend);

  const fulfilment = round2(
    orders * (DEMO_FULFILMENT_PER_ORDER + DEMO_OTHER_CM1_PER_ORDER)
  );
  const cm3 = round2(cm2 - fulfilment);

  return {
    date,
    orders,
    newCustomerOrders,
    returningCustomerOrders,
    uniqueCustomers,
    revenue,
    netSales,
    shippingRevenue,
    taxCollected,
    grossRevenueInclTax,
    newCustomerRevenue,
    returningCustomerRevenue,
    cogs,
    cm1,
    metaSpend,
    googleSpend,
    paidSpend,
    cm2,
    fulfilment,
    cm3,
  };
}

/** Days across a range, already clamped to the demo's own window. */
export function days(from: string, to: string): DemoDay[] {
  return datesBetween(from, to).map(day);
}

/**
 * Convert a money figure into the display currency.
 *
 * Demo mode never reaches `ref.fx_rates`, so the toggle needs its own rate.
 * Counts must never pass through here — an order is an order in any currency.
 */
export function convertMoney(value: number | null, display: string): number | null {
  if (value === null) return null;
  if (display === "native" || display === DEMO_CURRENCY) return value;
  if (display === "CZK") return round2(value * DEMO_FX_USD_TO_CZK);
  return value;
}

/** Deterministic per-day share, for splitting a day across markets or channels. */
export function shareOf(key: string, lo: number, hi: number): number {
  return lo + unit(key) * (hi - lo);
}
