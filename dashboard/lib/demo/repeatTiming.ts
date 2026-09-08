/**
 * Demo repeat timing.
 *
 * Shaped as a right-skewed distribution — a fast cluster in the first fortnight,
 * a broad replenishment hump around the product's consumption cycle, then a
 * thinning tail. That is what a consumable brand actually looks like, and a
 * flat or single-spike demo would show nothing about how the chart reads.
 *
 * Fed through `buildTiming`, the same function the warehouse path uses, so the
 * peak window, medians and window table cannot be computed differently here.
 */

import { buildTiming, type RepeatTiming } from "@/lib/queries/repeatTiming";
import { jitter } from "./random";

/** Roughly where the demo brand's consumption cycle lands. */
const CYCLE_DAY = 34;

export function demoRepeatTiming(horizon: number): RepeatTiming {
  const counts = new Map<number, number>();

  for (let d = 0; d <= horizon; d++) {
    // Two overlapping populations: people who liked it and came straight back,
    // and people who ran out. The sum is the familiar right-skewed shape.
    const impulse = Math.exp(-Math.pow((d - 5) / 5.5, 2)) * 42;
    const replenish = Math.exp(-Math.pow((d - CYCLE_DAY) / 20, 2)) * 66;
    const tail = 14 * Math.exp(-d / 90);
    const raw = (impulse + replenish + tail) * jitter(`timing:${d}`, 0.16);

    // Same-day pairs are mostly a split order rather than a genuine return, so
    // they sit slightly above the curve here just as they do in real data.
    const value = d === 0 ? raw * 1.7 : raw;
    counts.set(d, Math.max(0, Math.round(value)));
  }

  const repeaters = [...counts.values()].reduce((a, b) => a + b, 0);
  // A believable acquisition base: about a third of first-time buyers return
  // within the window, and a further slice comes back after it.
  const cohort = Math.round(repeaters / 0.32);
  const beyond = Math.round(repeaters * 0.48);

  return buildTiming(counts, horizon, cohort, beyond);
}
