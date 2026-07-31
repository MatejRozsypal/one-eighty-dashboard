/**
 * Sidebar navigation.
 *
 * Items with `href` are built. Items without are shown greyed with a "Soon"
 * badge — deliberately visible rather than hidden, so the shape of the product
 * is legible and it's obvious what the warehouse could already feed.
 */

export interface NavItem {
  label: string;
  /** Absent = not built yet. */
  href?: string;
  /** Tooltip explaining why an unbuilt item is unbuilt. */
  note?: string;
  /** Hidden entirely from non-admins, rather than shown and refused. */
  adminOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const NOT_BUILT = "Not built yet — the warehouse can feed it, the page doesn't exist.";

export const NAV: NavGroup[] = [
  {
    label: "Profitability",
    items: [
      { label: "Snapshot", href: "/snapshot" },
      { label: "Growth (MoM)", href: "/growth" },
      { label: "Orders", href: "/orders" },
      { label: "Products", href: "/products" },
      { label: "Unit economics", href: "/unit-economics" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { label: "Paid", href: "/paid" },
      { label: "Channels (GA4)", href: "/channels" },
      { label: "Email", href: "/email" },
    ],
  },
  {
    label: "Retention",
    items: [
      { label: "Customers", href: "/customers" },
      { label: "Time between orders", href: "/gaps" },
      { label: "Cohorts", href: "/cohorts" },
      // Repurchase-by-first-product needs a warehouse view that doesn't exist
      // yet; cohort repeat rate is already on the Cohorts page.
      { label: "Repurchase breakdown", note: NOT_BUILT },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Data Health", href: "/health", adminOnly: true },
      { label: "Users & access", href: "/admin", adminOnly: true },
    ],
  },
];

/** Eyebrow shown above the page title, e.g. "Profitability · Dr. Dobias". */
export function pageEyebrow(pathname: string, clientName: string): string {
  const group = NAV.find((g) => g.items.some((i) => i.href === pathname));
  if (!group) return clientName;
  return group.label === "Admin" ? "Admin" : `${group.label} · ${clientName}`;
}

export function pageTitle(pathname: string): string {
  for (const group of NAV) {
    const item = group.items.find((i) => i.href === pathname);
    if (item) return item.label;
  }
  return "Dashboard";
}

/**
 * The navigation a given user should see.
 *
 * Admin items are removed from the tree rather than rendered disabled: an
 * agency user has no business knowing the user-management screen exists, and a
 * greyed-out row invites someone to ask for access they don't need. Groups that
 * empty out disappear with their heading.
 */
export function navFor(isAdmin: boolean): NavGroup[] {
  if (isAdmin) return NAV;
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly),
  })).filter((g) => g.items.length > 0);
}
