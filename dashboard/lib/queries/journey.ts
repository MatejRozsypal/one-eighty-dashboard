/**
 * Product journey — what customers buy, and what they buy next.
 *
 * ── Why only four products carry a colour ───────────────────────────────────
 * A Sankey shows every colour at once, so the palette has to survive an
 * all-pairs comparison rather than the usual adjacent-pair one. Running the
 * design system's own validator over candidate palettes, four hues pass every
 * check — lightness band, chroma floor, colour-vision separation and the
 * normal-vision floor — and five do not, at any hue spacing tried. So the top
 * four products by volume are coloured and the rest fold into a neutral
 * "Other".
 *
 * That is a limit on what a reader can actually distinguish, not on what the
 * warehouse can produce, so it is applied here rather than in SQL: the mart
 * keeps every product, and the choice of how many to show belongs to the thing
 * doing the showing.
 *
 * ── Why the volume ranking is global ────────────────────────────────────────
 * Colour follows the product, not its position in the diagram. The ranking is
 * computed across every step at once, so GutSense is the same colour wherever
 * it appears and does not change when a step is added or a filter narrows the
 * view.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoJourney, demoFirstProductRepeat } from "@/lib/demo/journey";
import {
  buildJourney,
  OTHER_PRODUCT,
  JOURNEY_COLORS,
  OTHER_COLOR,
  type FirstProductRepeat,
  type JourneyLink,
  type JourneyNode,
  type ProductJourney,
} from "@/lib/queries/journeyShape";

export {
  buildJourney,
  OTHER_PRODUCT,
  JOURNEY_COLORS,
  OTHER_COLOR,
  type FirstProductRepeat,
  type JourneyLink,
  type JourneyNode,
  type ProductJourney,
};

interface JourneyRow {
  from_step: unknown;
  from_product: string;
  to_product: string;
  customers: unknown;
}

export async function getProductJourney(
  clientId: string,
  maxStep = 3
): Promise<ProductJourney> {
  if (isDemo(clientId)) return demoJourney(maxStep);

  const rows = await query<JourneyRow>(
    `SELECT from_step, from_product, to_product, customers
       FROM \`${PROJECT_ID}.mart.mart_product_journey\`
      WHERE client_id = @clientId AND from_step <= @maxStep`,
    { clientId, maxStep }
  );

  return buildJourney(
    rows.map((r) => ({
      fromStep: Number(num(r.from_step) ?? 0),
      fromProduct: r.from_product,
      toProduct: r.to_product,
      customers: Number(num(r.customers) ?? 0),
    })),
    maxStep
  );
}

interface RepeatRow {
  first_product: string;
  customers: unknown;
  repeaters: unknown;
  avg_lifetime_orders: unknown;
}

export async function getFirstProductRepeat(
  clientId: string,
  limit = 15,
  minCustomers = 30
): Promise<FirstProductRepeat[]> {
  if (isDemo(clientId)) return demoFirstProductRepeat(limit);

  const rows = await query<RepeatRow>(
    `SELECT first_product, customers, repeaters, avg_lifetime_orders
       FROM \`${PROJECT_ID}.mart.mart_first_product_repeat\`
      WHERE client_id = @clientId AND customers >= @minCustomers
      ORDER BY repeaters / customers DESC
      LIMIT @limit`,
    { clientId, limit, minCustomers }
  );

  return rows.map((r) => {
    const customers = Number(num(r.customers) ?? 0);
    const repeaters = Number(num(r.repeaters) ?? 0);
    return {
      product: r.first_product,
      customers,
      repeaters,
      repeatRate: customers > 0 ? repeaters / customers : null,
      avgLifetimeOrders: num(r.avg_lifetime_orders),
    };
  });
}
