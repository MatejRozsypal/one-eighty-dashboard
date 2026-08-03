/**
 * Demo actuals and demo targets.
 *
 * Actuals roll up the same daily spine as everything else, so the Goals page
 * agrees with the snapshot for any month.
 *
 * The targets are generated rather than stored, for the same reason the demo's
 * cost assumptions are: an admin editing a fictional brand's plan would be
 * saving rows that nothing reads. They are set a little above what the brand
 * actually did — some months made, some missed — because a demo where every
 * target is comfortably beaten shows nothing about how the page behaves when a
 * number is in trouble, which is the case anyone evaluating it cares about.
 */

import type { MonthActuals } from "@/lib/queries/goals";
import type { Goal, GoalMetric } from "@/lib/goals/store";
import { DEMO_CLIENT_ID } from "./business";
import { demoMonths } from "./trend";
import { jitter } from "./random";

export function demoGoalActuals(year: number): MonthActuals[] {
  return demoMonths()
    .filter((m) => m.year === year)
    .map((m) => ({
      month: m.monthStart,
      revenue: m.revenue,
      // The daily spine carries total orders; demoMonths keeps the two
      // acquisition figures, so orders are recomposed the same way.
      orders: m.orders,
      new_customers: m.newCustomerOrders,
      cm3: m.cm3,
    }));
}

/** Targets for the fictional brand: mostly ambitious, occasionally missed. */
export function demoGoals(year: number): Goal[] {
  const out: Goal[] = [];

  for (const m of demoMonths()) {
    if (m.year !== year) continue;

    const push = (metric: GoalMetric, actual: number) => {
      // Aim 4% above what happened, ±9% — so roughly a third of months land
      // short and the page has something to say.
      const target = actual * 1.04 * jitter(`goal:${metric}:${m.monthStart}`, 0.09);
      out.push({
        clientId: DEMO_CLIENT_ID,
        metric,
        month: m.monthStart,
        target: Math.round(target),
        updatedAt: null,
        updatedBy: "demo",
      });
    };

    push("revenue", m.revenue);
    push("orders", m.orders);
    push("new_customers", m.newCustomerOrders);
    push("cm3", m.cm3);
  }

  return out;
}
