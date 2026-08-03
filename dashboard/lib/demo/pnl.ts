/**
 * Demo P&L rows.
 *
 * Deliberately shaped as *daily rows*, not as finished totals. `getPnlSnapshot`
 * already does its bucketing, summation and every derived rate in TypeScript,
 * so handing it days means the demo's CM1/CM2/CM3, MER, aMER, CAC, AOV and all
 * the period-over-period deltas are produced by the same production code that
 * serves real clients. Writing totals here instead would mean maintaining a
 * second implementation of the arithmetic — and the demo would quietly stop
 * matching the product the day either one changed.
 */

import type { PnlDay } from "@/lib/queries/pnl";
import type { DateRange } from "@/lib/period";
import { convertMoney, days, DEMO_CURRENCY } from "./business";

export function demoPnlDays(bounds: DateRange, display: string): PnlDay[] {
  const currency = display === "native" ? DEMO_CURRENCY : display;
  const money = (v: number) => convertMoney(v, display);

  return days(bounds.from, bounds.to).map((d) => ({
    date: d.date,
    currency,
    revenue: money(d.revenue),
    netSales: money(d.netSales),
    grossRevenueInclTax: money(d.grossRevenueInclTax),
    shippingRevenue: money(d.shippingRevenue),
    taxCollected: money(d.taxCollected),
    newCustomerRevenue: money(d.newCustomerRevenue),
    returningCustomerRevenue: money(d.returningCustomerRevenue),
    cogs: money(d.cogs),
    cm1: money(d.cm1),
    cm2: money(d.cm2),
    cm3: money(d.cm3),
    metaSpend: money(d.metaSpend),
    googleSpend: money(d.googleSpend),
    paidSpend: money(d.paidSpend),
    // Counts never convert — an order is an order in any currency.
    orders: d.orders,
    uniqueCustomers: d.uniqueCustomers,
    newCustomerOrders: d.newCustomerOrders,
    returningCustomerOrders: d.returningCustomerOrders,
  }));
}
