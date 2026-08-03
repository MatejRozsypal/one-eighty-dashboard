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
      { label: "Goals", href: "/goals" },
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
      { label: "Repurchase", href: "/repurchase" },
    ],
  },
];

/**
 * Settings lives behind the gear in the sidebar footer, not in this tree.
 *
 * It was two rows in an "Admin" group — Data Health and Users & access — which
 * put internal plumbing in the same list as the pages a client reads, and gave
 * the flat all-users screen equal billing with the analysis. Everything
 * configurable now hangs off one icon and is organised by client inside it.
 */
export const SETTINGS_HREF = "/settings";

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
