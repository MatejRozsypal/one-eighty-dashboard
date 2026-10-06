/**
 * Sidebar navigation.
 *
 * Pure (no server imports): the Sidebar, MobileTopBar and ProductRail run it in
 * the browser. A page the selected client can never have data for is hidden,
 * not greyed out; opened by URL it renders its title plus "{Source} not
 * connected." (see `lib/capabilities.ts`).
 */

import { matchesPrefix, pageAvailability, type HasCapabilities } from "@/lib/capabilities";
import { productsFor, type Product } from "@/lib/products";
import type { Role } from "@/lib/users/store";
import { PAID_TAB_HREF } from "@/lib/paid/links";
import type { PaidTabKey } from "@/lib/paid/types";

export interface NavItem {
  label: string;
  href: string;
  /** Hidden entirely from non-admins, rather than shown and refused. */
  adminOnly?: boolean;
  /** Hidden from the client role (admin and agency see it). Presentation only: the route's layout enforces it. */
  internalOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Profitability",
    items: [
      { label: "Snapshot", href: "/snapshot" },
      { label: "Plan", href: "/plan" },
      { label: "Growth (MoM)", href: "/growth" },
      { label: "Orders", href: "/orders" },
      { label: "Products", href: "/products" },
      { label: "Unit economics", href: "/unit-economics" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock health", href: "/inventory" },
      { label: "Catalogue", href: "/inventory/catalogue" },
      { label: "Buying plan", href: "/inventory/buying" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { label: "Paid", href: "/paid", internalOnly: true },
      { label: "Email", href: "/email" },
    ],
  },
  {
    label: "Retention",
    items: [
      { label: "Customers", href: "/customers" },
      { label: "Repeat rate", href: "/repeat-rate" },
      { label: "Time between orders", href: "/gaps" },
      { label: "Cohorts", href: "/cohorts" },
      { label: "Repurchase", href: "/repurchase" },
      { label: "Repeat timing", href: "/repurchase/timing" },
    ],
  },
];

/**
 * The Creative section's own navigation.
 *
 * A separate tree rather than a group inside NAV: Creative is a product behind
 * the rail, not a category of Analytics pages. The order is the reading order:
 * what ran, what it belonged to, how it compares, whether enough of it is being
 * made, and what it cost.
 */
export const CREATIVE_NAV: NavItem[] = [
  { label: "Creatives", href: "/creative" },
  { label: "Concepts", href: "/creative/concepts" },
  { label: "Breakdown", href: "/creative/breakdown" },
  { label: "Velocity", href: "/creative/velocity" },
  { label: "Production ROI", href: "/creative/production" },
];

/**
 * The Paid section's tabs, in display order. `href` is the capability key too:
 * `pageAvailability(client, tab.href)` says whether the client has that platform
 * (the Overview tab needs Meta or Google Ads, the others one platform each).
 */
export const PAID_TABS: Array<{ key: PaidTabKey; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: PAID_TAB_HREF.overview },
  { key: "meta", label: "Meta", href: PAID_TAB_HREF.meta },
  { key: "google", label: "Google", href: PAID_TAB_HREF.google },
  { key: "ga4", label: "GA4", href: PAID_TAB_HREF.ga4 },
];

/** Settings lives behind the gear in the sidebar footer, not in this tree. */
export const SETTINGS_HREF = "/settings";

/** Titles for routes outside NAV and CREATIVE_NAV (used by the mobile bar). */
const OTHER_TITLES: Array<{ href: string; label: string }> = [
  { href: "/chat", label: "Assistant" },
  { href: "/reports", label: "Reports" },
  { href: "/channels", label: "Channels" },
  { href: "/health", label: "Data health" },
  { href: "/settings", label: "Settings" },
  { href: "/admin", label: "Admin" },
];

/** Longest item whose href is `pathname` or a prefix of it ("/paid" matches "/paid/meta"). */
function longestMatch<T extends { href: string }>(pathname: string, items: T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (matchesPrefix(pathname, item.href) && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best;
}

/** The nav href to highlight for a path: the longest prefix match, so "/repurchase/timing" does not also light up "/repurchase". */
export function activeNavHref(pathname: string, items: NavItem[] = allNavItems()): string | null {
  return longestMatch(pathname, items)?.href ?? null;
}

/** Every Analytics and Creative nav item, flattened. */
function allNavItems(): NavItem[] {
  return [...NAV.flatMap((g) => g.items), ...CREATIVE_NAV];
}

/** Page title for a route, by longest prefix match ("/paid/google" reads "Paid"). */
export function pageTitle(pathname: string): string {
  const item = longestMatch(pathname, [...allNavItems(), ...OTHER_TITLES]);
  return item?.label ?? "Dashboard";
}

/**
 * The navigation a given user should see for the selected client.
 *
 * Admin-only items are removed for non-admins, internal-only items (Paid) for
 * the client role: `isInternal` is admin or agency and defaults to `isAdmin`.
 * With a client, pages it has no source for are removed too. Groups that empty out disappear with their
 * heading. Without a client (registry not loaded) only the admin filter runs.
 */
export function navFor(
  isAdmin: boolean,
  client?: HasCapabilities | null,
  isInternal: boolean = isAdmin
): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        (isAdmin || !i.adminOnly) &&
        (isInternal || !i.internalOnly) &&
        (!client || pageAvailability(client, i.href) === "available")
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * Rail products for this role. The rail is stable across clients: Creative stays visible and its
 * pages show "Meta not connected" for a client without Meta. Reports is not client-scoped.
 */
export function railProducts(role: Role, _client?: HasCapabilities | null): Product[] {
  return productsFor(role);
}

/** The client selected by `?client=`, falling back to the first, exactly as `resolveClient` does. */
export function selectedClient<T extends { clientId: string }>(
  clients: T[],
  requested: string | null | undefined
): T | null {
  return clients.find((c) => c.clientId === requested) ?? clients[0] ?? null;
}
