"use client";

/**
 * The sidebar: one dark column, the way Shopify's admin has one.
 *
 * Top to bottom: the logo and the collapse toggle, then the products (Home,
 * Assistant, Analytics, Creative, Reports) as rows with an icon and a label,
 * then Settings pinned at the foot. The product you are in opens in place and
 * lists its own navigation underneath, indented and without icons:
 *
 *  - Analytics and Creative: their trees from `lib/nav.ts`, group labels as
 *    small headers, and a third level (Paid's platforms, Breakdown's
 *    dimensions, Velocity's screens) under an item while its section is open;
 *  - Assistant: the latest conversations (`HistoryList`);
 *  - Reports: the pinned and recent reports, portalled in by the Reports
 *    layout, which is the only place that list is read (`NavSlot`).
 *
 * Only the open product's list scrolls. The product rows above and below it
 * and Settings stay where they are, so Creative and Reports never drop off a
 * laptop screen while Analytics is open.
 *
 * The tree is filtered for the selected client (`navForProduct`): a page the
 * client has no source for is hidden, a `keepWhenUnavailable` child stays
 * muted, `adminOnly` and `internalOnly` items go for roles that may not see
 * them, and the products themselves follow the role (`sidebarProducts`). The
 * selected client is worked out here from `?client=`, because the layout
 * cannot read search params; it falls back to the first client exactly as
 * `resolveClient` does.
 *
 * A chevron beside a product opens its list without navigating (a peek) or
 * folds the open one; a chevron beside an item does the same for its children.
 * Both last until the next navigation.
 *
 * Collapsed (`data-nav="collapsed"`, see `NavCollapseToggle`) it is a column
 * of product icons with the label as a tooltip; everything below the product
 * rows is hidden. Below `lg` it is not rendered at all and `MobileTopBar`
 * carries the same hierarchy in its page sheet.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { Logo } from "@/components/ui/Logo";
import { HistoryList } from "@/components/chat/HistoryList";
import { NavCollapseToggle } from "@/components/shell/NavCollapseToggle";
import { NavSlotHost } from "@/components/shell/NavSlot";
import { ProductIcon, SettingsIcon } from "@/components/shell/ProductIcon";
import {
  SUB_HEAD,
  SUB_ROW,
  SUB_ROW_ACTIVE,
  SUB_ROW_IDLE,
  SUB_ROW_MUTED,
  THIRD_ROW,
} from "@/components/shell/navStyles";
import {
  SETTINGS_HREF,
  isSettingsPath,
  navForProduct,
  navHref,
  resolveActive,
  selectedClient,
  sidebarProducts,
  type NavChild,
  type NavGroup,
  type NavItem,
} from "@/lib/nav";
import { productFor, type Product, type ProductId } from "@/lib/products";
import type { Client } from "@/lib/clients";
import type { Role } from "@/lib/users/store";

/** A product row and the Settings row: 32px, icon and label. */
const TOP_ROW =
  "nav-row relative flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2 text-left text-[13.5px] tracking-[-0.01em] transition-colors duration-fast focus-visible:outline-offset-[-2px]";

/** The label shown beside a row while the sidebar is collapsed. Decorative: the row keeps its own name. */
function Tip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="nav-tip whitespace-nowrap rounded-sm bg-ink-900 px-2 py-1 text-[12px] font-medium text-content-inverse shadow-lg ring-1 ring-white/[0.08]"
    >
      {label}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform duration-fast ${open ? "rotate-90" : ""}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const CHEVRON_BUTTON =
  "flex h-7 w-7 flex-none items-center justify-center rounded-sm text-gray-400 transition-colors duration-fast hover:bg-white/[0.08] hover:text-gray-250 focus-visible:outline-offset-[-2px]";

const idFor = (prefix: string, href: string) =>
  `${prefix}-${href.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`;

export function Sidebar({
  clients,
  role,
  isAdmin = false,
  isInternal = isAdmin,
  showSettings = isInternal,
}: {
  /** The switcher's client list; the selected one decides which pages show. */
  clients: Client[];
  /** Decides which products get a row. */
  role: Role;
  isAdmin?: boolean;
  /** Admin or agency: sees internal-only pages such as Paid. */
  isInternal?: boolean;
  /** Settings is internal only. */
  showSettings?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const client = selectedClient(clients, searchParams.get("client"));
  const onSettings = isSettingsPath(pathname);
  const current: ProductId | null = onSettings ? null : productFor(pathname);
  const products = sidebarProducts(role, client);

  // Peeks and folds, held for the page they were made on: navigating drops
  // them, so the sidebar always comes back to "the product you are in is open".
  // Reset during render (the derived-state pattern) so the stale value never paints.
  const [manual, setManual] = useState<{
    path: string;
    product?: ProductId | null;
    items: Record<string, boolean>;
  }>({ path: pathname, items: {} });
  if (manual.path !== pathname) setManual({ path: pathname, items: {} });
  const held = manual.path === pathname ? manual : { path: pathname, items: {} };
  const open: ProductId | null = held.product !== undefined ? held.product : current;

  // The current page can sit low in a long list. Bring it into view on arrival,
  // inside the list's own scroll area, never by scrolling the page.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !here) return;
    const top = here.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + here.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [pathname, open]);

  /** Whether a product has anything to list under it here. */
  const hasContent = (id: ProductId): boolean => {
    if (id === "analytics" || id === "creative") {
      return navForProduct(id, isAdmin, client, isInternal).length > 0;
    }
    if (id === "chat") return true;
    // The report list is read by the Reports layout only, so it exists on /reports.
    if (id === "reports") return current === "reports";
    return false;
  };

  return (
    <div className="nav-shell sticky top-0 z-40 hidden h-screen w-[var(--nav-w)] flex-none flex-col bg-bg-inverse lg:flex">
      <div className="nav-head flex h-[var(--header-bar-h)] flex-none items-center justify-between gap-2 pl-4 pr-2">
        <span className="nav-when-open">
          <Logo tone="inverse" size={22} />
        </span>
        <NavCollapseToggle />
      </div>

      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 px-2 pb-2 pt-1">
          {products.map((p) => {
            const isOpen = p.id === open && hasContent(p.id);
            const listId = `nav-product-${p.id}`;
            return (
              <li
                key={p.id}
                className={isOpen ? "flex min-h-0 flex-[0_1_auto] flex-col" : "flex-none"}
              >
                <ProductRow
                  product={p}
                  qs={qs}
                  pathname={pathname}
                  isCurrent={p.id === current}
                  canOpen={hasContent(p.id)}
                  isOpen={isOpen}
                  listId={listId}
                  onToggle={() =>
                    setManual({ ...held, product: isOpen ? null : p.id })
                  }
                />
                {isOpen && (
                  <div
                    id={listId}
                    ref={listRef}
                    className="nav-when-open scrollbar-inverse min-h-0 flex-[0_1_auto] overflow-y-auto pb-2 pt-0.5"
                  >
                    {p.id === "chat" ? (
                      <HistoryList />
                    ) : p.id === "reports" ? (
                      <NavSlotHost id="reports" />
                    ) : (
                      <ProductTree
                        groups={navForProduct(p.id, isAdmin, client, isInternal)}
                        qs={qs}
                        pathname={pathname}
                        query={searchParams}
                        expanded={held.items}
                        onToggleItem={(href, next) =>
                          setManual({ ...held, items: { ...held.items, [href]: next } })
                        }
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {showSettings && (
          <div className="flex flex-none border-t border-white/[0.07] px-2 py-2">
            <AppLink
              href={SETTINGS_HREF}
              aria-current={onSettings ? "page" : undefined}
              className={`${TOP_ROW} ${
                onSettings
                  ? "nav-current bg-growth-500/[0.14] font-semibold text-growth-300"
                  : "text-gray-250 hover:bg-white/[0.06]"
              }`}
            >
              <span className={onSettings ? "" : "text-gray-400"}>
                <SettingsIcon />
              </span>
              <span className="nav-label truncate">Settings</span>
              <Tip label="Settings" />
            </AppLink>
          </div>
        )}
      </nav>
    </div>
  );
}

function ProductRow({
  product,
  qs,
  pathname,
  isCurrent,
  canOpen,
  isOpen,
  listId,
  onToggle,
}: {
  product: Product;
  qs: string;
  pathname: string;
  /** The current page belongs to this product. */
  isCurrent: boolean;
  /** It has a list to open, so it gets a chevron. */
  canOpen: boolean;
  isOpen: boolean;
  listId: string;
  onToggle: () => void;
}) {
  // The row is the page itself where the product is one page with no list
  // (Home) or on its own landing page (the report list). Elsewhere it is the
  // place you are inside, and the page is a row in its list (in the Assistant,
  // "New conversation" or the open conversation).
  const isPage =
    isCurrent && (product.id === "home" || (product.id === "reports" && pathname === "/reports"));
  const tone = isPage
    ? "bg-growth-500/[0.14] font-semibold text-growth-300"
    : isCurrent
      ? "nav-current font-semibold text-content-inverse hover:bg-white/[0.06]"
      : "text-gray-250 hover:bg-white/[0.06]";

  return (
    <div className="flex items-center gap-0.5">
      <AppLink
        // The query string carries client, range and currency. Dropping it when
        // switching products would silently reset whose numbers you were reading.
        href={qs ? `${product.href}?${qs}` : product.href}
        aria-current={isPage ? "page" : isCurrent ? "true" : undefined}
        className={`${TOP_ROW} ${tone}`}
      >
        <span className={isCurrent ? "" : "text-gray-400"}>
          <ProductIcon id={product.id} />
        </span>
        <span className="nav-label truncate">{product.label}</span>
        <Tip label={product.label} />
      </AppLink>
      {canOpen && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={`${product.label} pages`}
          className={`nav-when-open ${CHEVRON_BUTTON}`}
        >
          <Chevron open={isOpen} />
        </button>
      )}
    </div>
  );
}

function ProductTree({
  groups,
  qs,
  pathname,
  query,
  expanded,
  onToggleItem,
}: {
  groups: NavGroup[];
  qs: string;
  pathname: string;
  query: { get(name: string): string | null };
  /** Items whose children were opened or folded by hand on this page. */
  expanded: Record<string, boolean>;
  onToggleItem: (href: string, next: boolean) => void;
}) {
  const active = resolveActive(pathname, query, groups.flatMap((g) => g.items));
  // One group (Creative) needs no heading: the product row above already names it.
  const headed = groups.length > 1;

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const headingId = idFor("nav-group", group.label);
        return (
          <div key={group.label} className="flex flex-col">
            {headed && (
              <span id={headingId} className={SUB_HEAD}>
                {group.label}
              </span>
            )}
            <ul
              aria-labelledby={headed ? headingId : undefined}
              className="m-0 flex list-none flex-col gap-px p-0"
            >
              {group.items.map((item) => {
                const isSection = active.item?.href === item.href;
                return (
                  <li key={item.href}>
                    <ItemRow
                      item={item}
                      qs={qs}
                      isSection={isSection}
                      activeChild={isSection ? active.child : null}
                      expanded={expanded[item.href] ?? isSection}
                      onToggle={(next) => onToggleItem(item.href, next)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ItemRow({
  item,
  qs,
  isSection,
  activeChild,
  expanded,
  onToggle,
}: {
  item: NavItem;
  qs: string;
  /** This item's section is the current page (the item itself or one of its children). */
  isSection: boolean;
  /** The child that is the current page, when the current page is one of this item's children. */
  activeChild: NavChild | null;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  const children = item.children ?? [];
  const listId = idFor("nav-children", item.href);
  const isPage = isSection && !activeChild;
  const tone = isPage
    ? SUB_ROW_ACTIVE
    : isSection
      ? "font-medium text-content-inverse hover:bg-white/[0.06]"
      : SUB_ROW_IDLE;

  const link = (
    <AppLink
      href={navHref(item.href, qs)}
      // On a child's page the parent is a place you are inside, not the page itself.
      aria-current={isPage ? "page" : isSection ? "true" : undefined}
      className={`${SUB_ROW} ${tone}`}
    >
      <span className="min-w-0 truncate">{item.label}</span>
    </AppLink>
  );

  if (children.length === 0) return link;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5">
        {link}
        <button
          type="button"
          onClick={() => onToggle(!expanded)}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-label={`${item.label} pages`}
          className={CHEVRON_BUTTON}
        >
          <Chevron open={expanded} />
        </button>
      </div>

      {expanded && (
        <ul id={listId} className="m-0 flex list-none flex-col gap-px p-0 pb-0.5 pt-px">
          {children.map((child) => {
            const isActive = activeChild !== null && child.href === activeChild.href;
            return (
              <li key={child.href}>
                <AppLink
                  href={navHref(child.href, qs)}
                  aria-current={isActive ? "page" : undefined}
                  className={`${THIRD_ROW} ${
                    isActive ? SUB_ROW_ACTIVE : child.muted ? SUB_ROW_MUTED : SUB_ROW_IDLE
                  }`}
                >
                  <span className="min-w-0 truncate">{child.label}</span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
