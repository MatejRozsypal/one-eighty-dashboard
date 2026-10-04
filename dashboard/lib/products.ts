/**
 * The four products behind the icon rail.
 *
 * Each rail icon opens a different instance of the app. They share exactly two
 * things: the sign-in session and the shell chrome, and nothing else. In
 * particular Chat deliberately loads no warehouse data at all, which is why it
 * is a product rather than another page inside Analytics.
 *
 * Analytics keeps the URLs it already had (`/snapshot`, `/paid`, …) rather than
 * moving under an `/analytics` prefix: those links are bookmarked and shared,
 * and a redirect that exists only to make three products look symmetric in a
 * route table is a cost paid by readers for the benefit of no one.
 */

import { REPORTS_ROLES } from "@/lib/reports/contracts";
import type { Role } from "@/lib/users/store";

export type ProductId = "chat" | "analytics" | "creative" | "reports";

export interface Product {
  id: ProductId;
  label: string;
  /** Where the rail icon points. */
  href: string;
  /** Longer line for the tooltip. */
  hint: string;
  /** Client-role users are confined to products marked false. */
  internalOnly: boolean;
  /**
   * When set, only these roles see the icon. Presentation only: the real gate
   * for Reports is server side (`lib/authz.ts`, which also checks the email
   * domain), so a hidden icon is a courtesy and never the protection.
   */
  roles?: readonly Role[];
}

export const PRODUCTS: Product[] = [
  {
    id: "chat",
    label: "Assistant",
    href: "/chat",
    hint: "Ask a question in plain language",
    internalOnly: false,
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/snapshot",
    hint: "Profitability, inventory, marketing and retention",
    internalOnly: false,
  },
  {
    id: "creative",
    label: "Creative",
    href: "/creative",
    hint: "Ad creative analysis",
    internalOnly: true,
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    hint: "Build and share reports across clients",
    internalOnly: true,
    roles: REPORTS_ROLES,
  },
];

/**
 * Which product a path belongs to.
 *
 * Analytics is the fallback rather than an explicit list: it owns every route
 * that predates the rail, so enumerating them here would mean editing this file
 * every time a page is added, and forgetting to would silently unhighlight the
 * rail rather than fail loudly.
 */
export function productFor(pathname: string): ProductId {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "chat";
  if (pathname === "/creative" || pathname.startsWith("/creative/")) return "creative";
  if (pathname === "/reports" || pathname.startsWith("/reports/")) return "reports";
  return "analytics";
}

/**
 * The products a role gets a rail icon for. Internal means admin or agency;
 * `roles`, where a product sets it, narrows that further (Reports).
 */
export function productsFor(role: Role): Product[] {
  const isInternal = role !== "client";
  return PRODUCTS.filter(
    (p) => (isInternal || !p.internalOnly) && (!p.roles || p.roles.includes(role))
  );
}
