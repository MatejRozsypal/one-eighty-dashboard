/**
 * Which pages a client can have data for, decided from the registry flags.
 *
 * Pure on purpose: `import type` only, no `server-only`, no BigQuery. The
 * Sidebar and the mobile menu run this in the browser to hide pages, and every
 * page runs it on the server as its first guard:
 *
 *     if (pageAvailability(client, "/email") !== "available") {
 *       return <><Header title="Email" /><NotConnected source={missingSource(client, "/email")!} /></>;
 *     }
 *
 * "Not connected" is decided here, from `ref.clients` flags. "No data in this
 * range" is decided by the page, from its query. Never mix the two up: a page
 * that guesses "not connected" from an empty result blames the wrong thing.
 */

import type { ClientCapabilities } from "@/lib/clients";

/** The capability flags this module needs. A full `Client` satisfies it. */
export interface HasCapabilities {
  capabilities: ClientCapabilities;
}

/** Result of `pageAvailability`. */
export type PageAvailability = "available" | "not-connected";

type Capability = keyof ClientCapabilities;

interface PageRequirement {
  /** Route prefix. Matches the route itself and anything below it. */
  prefix: string;
  /** Available when the client has ANY of these. Empty means never. */
  anyOf: Capability[];
  /** Name used in "{source} not connected." */
  source: string;
}

const SHOP: Capability[] = ["shopify", "shoptet", "woocommerce"];

/**
 * The page requirements table (sprint plan WP1). Longest matching prefix wins,
 * so `/paid/meta` can be stricter than `/paid`. Routes not listed (Settings,
 * Data Health, Admin, Assistant) are always available.
 */
export const PAGE_REQUIREMENTS: readonly PageRequirement[] = [
  // Profitability
  { prefix: "/snapshot", anyOf: SHOP, source: "Shop" },
  { prefix: "/goals", anyOf: SHOP, source: "Shop" },
  { prefix: "/growth", anyOf: SHOP, source: "Shop" },
  { prefix: "/orders", anyOf: SHOP, source: "Shop" },
  { prefix: "/products", anyOf: SHOP, source: "Shop" },
  { prefix: "/unit-economics", anyOf: SHOP, source: "Shop" },
  // Retention
  { prefix: "/customers", anyOf: SHOP, source: "Shop" },
  { prefix: "/gaps", anyOf: SHOP, source: "Shop" },
  { prefix: "/cohorts", anyOf: SHOP, source: "Shop" },
  { prefix: "/repurchase", anyOf: SHOP, source: "Shop" },
  // Inventory reads the Shopify products snapshot only.
  { prefix: "/inventory", anyOf: ["shopify"], source: "Shopify" },
  // Marketing
  { prefix: "/paid", anyOf: ["meta", "googleAds"], source: "Ads" },
  { prefix: "/paid/meta", anyOf: ["meta"], source: "Meta" },
  { prefix: "/paid/google", anyOf: ["googleAds"], source: "Google Ads" },
  { prefix: "/paid/ga4", anyOf: ["ga4"], source: "GA4" },
  { prefix: "/email", anyOf: ["klaviyo", "ecomail"], source: "Email" },
  // No GA4 mart yet, so Channels is never available this sprint.
  { prefix: "/channels", anyOf: [], source: "GA4" },
  // Creative
  { prefix: "/creative", anyOf: ["meta"], source: "Meta" },
];

/** Strip query string and hash, so a full nav href can be passed in. */
function routeOf(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** True when `pathname` is `prefix` or a route below it. */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** The requirement row for a route, or null when the route has none. */
function requirementFor(href: string): PageRequirement | null {
  const path = routeOf(href);
  let best: PageRequirement | null = null;
  for (const r of PAGE_REQUIREMENTS) {
    if (matchesPrefix(path, r.prefix) && (!best || r.prefix.length > best.prefix.length)) {
      best = r;
    }
  }
  return best;
}

/** True when the client has at least one shop platform connected. */
export function hasShop(client: HasCapabilities): boolean {
  return SHOP.some((c) => client.capabilities[c]);
}

/** "available" when the client has a source the page reads, else "not-connected". */
export function pageAvailability(client: HasCapabilities, href: string): PageAvailability {
  const req = requirementFor(href);
  if (!req) return "available";
  return req.anyOf.some((c) => client.capabilities[c]) ? "available" : "not-connected";
}

/** The source to name in `<NotConnected source=... />`, or null when the page is available. */
export function missingSource(client: HasCapabilities, href: string): string | null {
  const req = requirementFor(href);
  if (!req || pageAvailability(client, href) === "available") return null;
  return req.source;
}
