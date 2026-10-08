/**
 * Sidebar navigation.
 *
 * Pure (no server imports): the Sidebar, MobileTopBar and ProductRail run it in
 * the browser. A page the selected client can never have data for is hidden,
 * not greyed out; opened by URL it renders its title plus "{Source} not
 * connected." (see `lib/capabilities.ts`).
 *
 * The tree is two levels at most: a top-level item has an icon and may have
 * children (Paid's platforms, Breakdown's dimensions, Repurchase's timing view).
 * Children show indented under their parent while the parent's section is open,
 * the way Shopify's admin does, rather than as a tab row inside the page.
 */

import { matchesPrefix, pageAvailability, type HasCapabilities } from "@/lib/capabilities";
import { productsFor, type ProductId, type Product } from "@/lib/products";
import type { Role } from "@/lib/users/store";
import { PAID_TAB_HREF } from "@/lib/paid/links";
import type { PaidTabKey } from "@/lib/paid/types";
import { BREAKDOWN_DIMENSIONS } from "@/lib/creative/vocabulary";

/** The outline icon drawn beside a top-level item (see `components/shell/NavIcon.tsx`). */
export type NavIconKey =
  | "snapshot"
  | "goals"
  | "growth"
  | "orders"
  | "products"
  | "unit-economics"
  | "stock"
  | "catalogue"
  | "buying"
  | "paid"
  | "email"
  | "customers"
  | "repeat-rate"
  | "gaps"
  | "cohorts"
  | "repurchase"
  | "creatives"
  | "concepts"
  | "breakdown"
  | "velocity"
  | "production";

/**
 * A page below a top-level item. One level only: children have no icon and no
 * children of their own, and they show while their parent's section is open.
 */
export interface NavChild {
  label: string;
  /** May carry a query ("/creative/breakdown?by=persona") when siblings share a path. */
  href: string;
  /**
   * Set on siblings that share one path and differ by a query value. The one
   * marked `fallback` is current when the query does not name any of them.
   */
  param?: { key: string; value: string; fallback?: boolean };
  /** Stays listed, muted, when the client has no source for it, instead of being hidden. */
  keepWhenUnavailable?: boolean;
  /** Set by `navFor` on a `keepWhenUnavailable` child the selected client has no source for. */
  muted?: boolean;
  /** Page title while this child is current. Without it the parent's label is the title. */
  title?: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  /** Sub-pages, shown under the item while its section is open. */
  children?: NavChild[];
  /** Hidden entirely from non-admins, rather than shown and refused. */
  adminOnly?: boolean;
  /** Hidden from the client role (admin and agency see it). Presentation only: the route's layout enforces it. */
  internalOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The Paid section's pages, in display order. `href` is the capability key too:
 * `pageAvailability(client, tab.href)` says whether the client has that platform
 * (the Overview page needs Meta or Google Ads, the others one platform each).
 * They are the children of the Paid item in the sidebar.
 */
export const PAID_TABS: Array<{ key: PaidTabKey; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: PAID_TAB_HREF.overview },
  { key: "meta", label: "Meta", href: PAID_TAB_HREF.meta },
  { key: "google", label: "Google", href: PAID_TAB_HREF.google },
  { key: "ga4", label: "GA4", href: PAID_TAB_HREF.ga4 },
];

export const NAV: NavGroup[] = [
  {
    label: "Profitability",
    items: [
      { label: "Snapshot", href: "/snapshot", icon: "snapshot" },
      { label: "Goals", href: "/goals", icon: "goals" },
      { label: "Growth (MoM)", href: "/growth", icon: "growth" },
      { label: "Orders", href: "/orders", icon: "orders" },
      { label: "Products", href: "/products", icon: "products" },
      { label: "Unit economics", href: "/unit-economics", icon: "unit-economics" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock health", href: "/inventory", icon: "stock" },
      { label: "Catalogue", href: "/inventory/catalogue", icon: "catalogue" },
      { label: "Buying plan", href: "/inventory/buying", icon: "buying" },
    ],
  },
  {
    label: "Marketing",
    items: [
      {
        label: "Paid",
        href: "/paid",
        icon: "paid",
        internalOnly: true,
        // A platform the client does not have stays listed, muted, so the set
        // does not shift from client to client; it opens on "not connected".
        children: PAID_TABS.map((t) => ({
          label: t.label,
          href: t.href,
          keepWhenUnavailable: t.key !== "overview",
        })),
      },
      { label: "Email", href: "/email", icon: "email" },
    ],
  },
  {
    label: "Retention",
    items: [
      { label: "Customers", href: "/customers", icon: "customers" },
      { label: "Repeat rate", href: "/repeat-rate", icon: "repeat-rate" },
      { label: "Time between orders", href: "/gaps", icon: "gaps" },
      { label: "Cohorts", href: "/cohorts", icon: "cohorts" },
      {
        label: "Repurchase",
        href: "/repurchase",
        icon: "repurchase",
        children: [{ label: "Repeat timing", href: "/repurchase/timing", title: "Repeat timing" }],
      },
    ],
  },
];

/**
 * The Creative section's own navigation.
 *
 * A separate tree rather than a group inside NAV: Creative is a product behind
 * the rail, not a category of Analytics pages. The order is the reading order:
 * what ran, what it belonged to, how it compares, whether enough of it is being
 * made, and what it cost. Breakdown's children are its dimensions, which used
 * to sit in a select above the table; Velocity's are its four screens.
 */
export const CREATIVE_NAV: NavGroup[] = [
  {
    label: "Creative",
    items: [
      { label: "Creatives", href: "/creative", icon: "creatives" },
      { label: "Concepts", href: "/creative/concepts", icon: "concepts" },
      {
        label: "Breakdown",
        href: "/creative/breakdown",
        icon: "breakdown",
        children: BREAKDOWN_DIMENSIONS.map((d, i) => ({
          label: d.label,
          href: `/creative/breakdown?by=${d.key}`,
          param: { key: "by", value: d.key, fallback: i === 0 },
        })),
      },
      {
        label: "Velocity",
        href: "/creative/velocity",
        icon: "velocity",
        // Overview is cross-client; the other three follow the client switcher.
        children: [
          { label: "Overview", href: "/creative/velocity" },
          { label: "This month", href: "/creative/velocity/month", title: "This month" },
          { label: "Plan", href: "/creative/velocity/plan", title: "Velocity plan" },
          { label: "Track record", href: "/creative/velocity/track", title: "Track record" },
        ],
      },
      { label: "Production ROI", href: "/creative/production", icon: "production" },
    ],
  },
];

/** Settings lives behind the gear in the sidebar footer, not in this tree. */
export const SETTINGS_HREF = "/settings";

/** Titles for routes outside NAV and CREATIVE_NAV (used by the mobile bar). */
const OTHER_TITLES: Array<{ href: string; label: string }> = [
  { href: "/home", label: "Home" },
  { href: "/chat", label: "Assistant" },
  { href: "/reports", label: "Reports" },
  { href: "/channels", label: "Channels" },
  { href: "/health", label: "Data health" },
  { href: "/settings", label: "Settings" },
  { href: "/admin", label: "Admin" },
];

/** The path of an href, without its query string or hash. */
function pathOf(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

/** Longest item whose href is `pathname` or a prefix of it ("/paid" matches "/paid/meta"). */
function longestMatch<T extends { href: string }>(pathname: string, items: T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    const path = pathOf(item.href);
    if (matchesPrefix(pathname, path) && (!best || path.length > pathOf(best.href).length)) {
      best = item;
    }
  }
  return best;
}

/** The part of the URL's query the nav reads: `URLSearchParams` and `ReadonlyURLSearchParams` both fit. */
export interface QueryReader {
  get(name: string): string | null;
}

/** The top-level item a route belongs to and, when it sits below one, the child that is current. */
export interface ActiveNav {
  item: NavItem | null;
  child: NavChild | null;
}

/**
 * Which item and child to highlight for a route.
 *
 * The item is the longest prefix match over its own href and its children's, so
 * "/repurchase/timing" belongs to Repurchase and "/paid/meta" to Paid, and
 * "/repurchase" never lights up for a sub-route of something else. The child is
 * the longest path match among the item's children; siblings that share a path
 * (Breakdown's dimensions) are told apart by their query value, and the one
 * marked `fallback` wins when the URL names none.
 */
export function resolveActive(
  pathname: string,
  query: QueryReader | null = null,
  items: NavItem[] = allNavItems()
): ActiveNav {
  let item: NavItem | null = null;
  let bestLength = -1;
  for (const candidate of items) {
    const paths = [candidate.href, ...(candidate.children ?? []).map((c) => c.href)].map(pathOf);
    for (const path of paths) {
      if (matchesPrefix(pathname, path) && path.length > bestLength) {
        item = candidate;
        bestLength = path.length;
      }
    }
  }
  if (!item?.children) return { item, child: null };

  const matching = item.children.filter((c) => matchesPrefix(pathname, pathOf(c.href)));
  const longest = Math.max(-1, ...matching.map((c) => pathOf(c.href).length));
  const tied = matching.filter((c) => pathOf(c.href).length === longest);
  const wanted = tied.find((c) => c.param && c.param.value === query?.get(c.param.key));
  const child = wanted ?? tied.find((c) => c.param?.fallback) ?? tied.find((c) => !c.param) ?? null;
  return { item, child };
}

/** The nav href to highlight for a path: the top-level item, so "/repurchase/timing" lights up Repurchase. */
export function activeNavHref(pathname: string, items: NavItem[] = allNavItems()): string | null {
  return resolveActive(pathname, null, items).item?.href ?? null;
}

/** Every Analytics and Creative nav item, flattened. */
function allNavItems(): NavItem[] {
  return [...NAV, ...CREATIVE_NAV].flatMap((g) => g.items);
}

/**
 * An item's href with the current query string carried across.
 *
 * The query holds the client, range, comparison and currency, so dropping it on
 * a nav click would silently change whose numbers you are reading. A query on
 * the href itself ("?by=persona") wins over the same key in the current one.
 */
export function navHref(href: string, query: string): string {
  const cut = href.indexOf("?");
  const path = cut === -1 ? href : href.slice(0, cut);
  const merged = new URLSearchParams(query);
  new URLSearchParams(cut === -1 ? "" : href.slice(cut + 1)).forEach((value, key) => merged.set(key, value));
  const qs = merged.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Page title for a route, by longest prefix match ("/paid/google" reads "Paid"). */
export function pageTitle(pathname: string): string {
  const titled = allNavItems().flatMap((item) => [
    { href: item.href, label: item.label },
    ...(item.children ?? []).flatMap((c) => (c.title ? [{ href: c.href, label: c.title }] : [])),
  ]);
  const item = longestMatch(pathname, [...titled, ...OTHER_TITLES]);
  return item?.label ?? "Dashboard";
}

/**
 * The navigation a given user should see for the selected client.
 *
 * Admin-only items are removed for non-admins, internal-only items (Paid) for
 * the client role: `isInternal` is admin or agency and defaults to `isAdmin`.
 * With a client, pages it has no source for are removed too, and so are
 * children, except those marked `keepWhenUnavailable`, which stay and come back
 * `muted`. Groups that empty out disappear with their heading. Without a client
 * (registry not loaded) only the admin filter runs.
 */
export function navFor(
  isAdmin: boolean,
  client?: HasCapabilities | null,
  isInternal: boolean = isAdmin
): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items
      .filter(
        (i) =>
          (isAdmin || !i.adminOnly) &&
          (isInternal || !i.internalOnly) &&
          (!client || pageAvailability(client, i.href) === "available")
      )
      .map((i) => (i.children ? { ...i, children: childrenFor(i.children, client) } : i)),
  })).filter((g) => g.items.length > 0);
}

function childrenFor(children: NavChild[], client?: HasCapabilities | null): NavChild[] {
  if (!client) return children;
  return children.flatMap((c) => {
    if (pageAvailability(client, c.href) === "available") return [c];
    return c.keepWhenUnavailable ? [{ ...c, muted: true }] : [];
  });
}

/** The groups the sidebar and the mobile sheet list for a product. Chat and Reports draw their own. */
export function navForProduct(
  product: ProductId,
  isAdmin: boolean,
  client?: HasCapabilities | null,
  isInternal: boolean = isAdmin
): NavGroup[] {
  if (product === "analytics") return navFor(isAdmin, client, isInternal);
  if (product === "creative") return CREATIVE_NAV;
  return [];
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
