/**
 * The demo client's registry entry and cost assumptions.
 *
 * ── Why it is not a row in `ref.clients` ────────────────────────────────────
 * A registry row would put a fake client in the warehouse, where every
 * cross-client query, every n8n loop and every freshness check would have to
 * learn to skip it. It would also make the demo depend on BigQuery being up —
 * and the one moment you cannot afford a warehouse hiccup is halfway through
 * showing the dashboard to a prospect.
 *
 * Declared here instead, the demo client exists entirely inside the app. It
 * renders when the warehouse is unreachable, it cannot contaminate a real
 * aggregate, and deleting the `lib/demo` directory removes it completely.
 *
 * ── Cost assumptions ────────────────────────────────────────────────────────
 * Real clients keep these in Postgres because they are stated inputs, not
 * measurements. The demo states its own here for the same reason, so the margin
 * stack runs all the way to EBITDA instead of stopping at CM2 with a hatched
 * band — which is the honest rendering for a client who has entered nothing,
 * but a poor advertisement for the page.
 */

import type { Client } from "@/lib/clients";
import type { ClientSettings } from "@/lib/users/settings";
import {
  DEMO_CLIENT_ID,
  DEMO_CURRENCY,
  DEMO_FULFILMENT_PER_ORDER,
  DEMO_NAME,
  DEMO_OPEX_RATE,
  DEMO_OTHER_CM1_PER_ORDER,
} from "./business";

export { DEMO_CLIENT_ID };

/** True for the one client whose figures are invented. */
export function isDemo(clientId: string | undefined | null): boolean {
  return clientId === DEMO_CLIENT_ID;
}

/**
 * Capabilities are all-on except the two the dashboard genuinely cannot show.
 *
 * GA4 is not connected for anybody, and Instagram has no page — switching them
 * on would produce cards advertising features that do not exist. A demo that
 * promises more than the product delivers is worse than no demo.
 */
export const DEMO_CLIENT: Client = {
  clientId: DEMO_CLIENT_ID,
  name: DEMO_NAME,
  currency: DEMO_CURRENCY,
  timezone: "America/New_York",
  country: "US",
  shopPlatform: "shopify",
  emailPlatform: "klaviyo",
  status: "active",
  capabilities: {
    shopify: true,
    shoptet: false,
    klaviyo: true,
    ecomail: false,
    meta: true,
    googleAds: true,
    ga4: false,
    instagram: false,
  },
  klaviyoConversionMetricId: "DemoPlacedOrder",
  klaviyoSubscriberSegmentId: "DemoMasterList",
};

export const DEMO_SETTINGS: ClientSettings = {
  clientId: DEMO_CLIENT_ID,
  opexRate: DEMO_OPEX_RATE,
  fulfilmentPerOrder: DEMO_FULFILMENT_PER_ORDER,
  otherCm1PerOrder: DEMO_OTHER_CM1_PER_ORDER,
  updatedAt: null,
  updatedBy: "demo",
};
