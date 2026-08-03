/**
 * Demo product journey.
 *
 * Built from the same invented catalogue as the rest of the demo, and fed
 * through `buildJourney` — the identical ranking, bucketing and colouring the
 * warehouse path uses — so the demo cannot drift from the product.
 *
 * The transition weights encode a deliberate story: most customers repurchase
 * what they first bought (replenishment), a smaller share moves to the
 * complementary product, and the tail scatters. That is the shape real
 * consumable brands have, and a demo where every product flowed equally to
 * every other would show a Sankey with nothing to read.
 */

import {
  buildJourney,
  type FirstProductRepeat,
  type JourneyLink,
  type ProductJourney,
} from "@/lib/queries/journey";
import { PRODUCTS } from "./catalog";
import { jitter, unit } from "./random";

/** Customers entering each step, roughly halving as people stop reordering. */
const STEP_VOLUME = [2400, 1180, 640, 360];

export function demoJourney(maxStep: number): ProductJourney {
  const links: JourneyLink[] = [];

  for (let step = 1; step <= maxStep; step++) {
    const total = STEP_VOLUME[step - 1] ?? 200;

    for (const from of PRODUCTS) {
      const leaving = total * from.share;

      for (const to of PRODUCTS) {
        // Repurchasing the same product is the dominant behaviour; everything
        // else is distributed by the destination's own share.
        const same = from.name === to.name;
        const weight = same ? 0.46 : to.share * 0.54;
        const customers = Math.round(
          leaving * weight * jitter(`flow:${step}:${from.name}:${to.name}`, 0.22)
        );
        // Drop the noise: a ribbon of three customers is unreadable and makes
        // the diagram look busier than the behaviour actually is.
        if (customers < 12) continue;

        links.push({
          fromStep: step,
          fromProduct: from.name,
          toProduct: to.name,
          customers,
        });
      }
    }
  }

  return buildJourney(links, maxStep);
}

export function demoFirstProductRepeat(limit: number): FirstProductRepeat[] {
  return PRODUCTS.map((p) => {
    // Bundles and higher-priced products hold people better — the pattern the
    // page exists to reveal, so the demo had better contain one.
    const base = p.line === "bundle" ? 0.58 : p.price > 50 ? 0.47 : 0.34;
    const rate = Math.min(0.82, base * jitter(`repeat:${p.name}`, 0.16));
    const customers = Math.max(
      35,
      Math.round(2600 * p.share * (0.7 + unit(`cust:${p.name}`) * 0.6))
    );
    const repeaters = Math.round(customers * rate);

    return {
      product: p.name,
      customers,
      repeaters,
      repeatRate: customers > 0 ? repeaters / customers : null,
      // Someone who comes back at all tends to come back more than once.
      avgLifetimeOrders: 1 + rate * 2.6 * jitter(`ltos:${p.name}`, 0.1),
    };
  })
    .sort((a, b) => (b.repeatRate ?? 0) - (a.repeatRate ?? 0))
    .slice(0, limit);
}
