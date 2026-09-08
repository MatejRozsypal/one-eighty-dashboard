/**
 * The three products behind the icon rail.
 *
 * Each rail icon opens a different instance of the app. They share exactly two
 * things — the sign-in session and the shell chrome — and nothing else. In
 * particular Chat deliberately loads no warehouse data at all, which is why it
 * is a product rather than another page inside Analytics.
 *
 * Analytics keeps the URLs it already had (`/snapshot`, `/paid`, …) rather than
 * moving under an `/analytics` prefix: those links are bookmarked and shared,
 * and a redirect that exists only to make three products look symmetric in a
 * route table is a cost paid by readers for the benefit of no one.
 */

export type ProductId = "chat" | "analytics" | "creative";

export interface Product {
  id: ProductId;
  label: string;
  /** Where the rail icon points. */
  href: string;
  /** Longer line for the tooltip. */
  hint: string;
  /** Client-role users are confined to products marked false. */
  internalOnly: boolean;
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
];

/**
 * Which product a path belongs to.
 *
 * Analytics is the fallback rather than an explicit list: it owns every route
 * that predates the rail, so enumerating them here would mean editing this file
 * every time a page is added — and forgetting to would silently unhighlight the
 * rail rather than fail loudly.
 */
export function productFor(pathname: string): ProductId {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "chat";
  if (pathname === "/creative" || pathname.startsWith("/creative/")) return "creative";
  return "analytics";
}

export function productsFor(isInternal: boolean): Product[] {
  return isInternal ? PRODUCTS : PRODUCTS.filter((p) => !p.internalOnly);
}
