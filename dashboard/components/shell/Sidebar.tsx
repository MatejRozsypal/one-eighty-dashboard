"use client";

/**
 * Left sidebar: dark, fixed, the app's spine.
 *
 * The nav is filtered for the selected client: a page the client has no source
 * for is hidden (see `navFor` and `lib/capabilities.ts`). The selected client
 * is worked out here from `?client=`, because the layout cannot read search
 * params; it falls back to the first client exactly as `resolveClient` does.
 *
 * On mobile the sidebar collapses out of flow entirely and navigation moves to
 * `MobileTopBar`. The client switcher and the account live in `AccountMenu`.
 *
 * This panel belongs to whichever product the rail has selected, so its
 * contents change with the section. It is also the half that collapses: the
 * rail beside it never does, because it is the only route back to the other
 * products.
 *
 * ── Items and their children ────────────────────────────────────────────────
 * Every top-level item has an icon. An item with children (Paid's platforms,
 * Breakdown's dimensions) lists them directly beneath it, indented, as plain
 * muted rows: the same vertical list, no flyout and no second column. They are
 * open while the item's section is the current one and fold away when you go
 * elsewhere. A chevron beside the item opens or folds them by hand for as long
 * as you stay on the page.
 */

import { useEffect, useRef, useState } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { usePathname, useSearchParams } from "next/navigation";
import { navForProduct, navHref, resolveActive, selectedClient, type NavChild, type NavItem } from "@/lib/nav";
import { productFor } from "@/lib/products";
import { NavCollapseToggle } from "@/components/shell/NavCollapseToggle";
import { NavIcon } from "@/components/shell/NavIcon";
import { HistoryList } from "@/components/chat/HistoryList";
import { Logo } from "@/components/ui/Logo";
import type { Client } from "@/lib/clients";

const ROW =
  "flex w-full items-center gap-[9px] rounded-sm px-2.5 py-[9px] text-left text-[13.5px] tracking-[-0.01em] transition-colors duration-fast focus-visible:outline-offset-[-2px]";

export function Sidebar({
  clients,
  isAdmin = false,
  isInternal = isAdmin,
}: {
  /** The switcher's client list; the selected one decides which pages show. */
  clients: Client[];
  isAdmin?: boolean;
  /** Admin or agency: sees internal-only pages such as Paid. */
  isInternal?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const client = selectedClient(clients, searchParams.get("client"));
  const product = productFor(pathname);
  const nav = navForProduct(product, isAdmin, client, isInternal);
  const active = resolveActive(pathname, searchParams, nav.flatMap((g) => g.items));

  // Hand-opened and hand-folded sections, held for the page they were set on:
  // going to another page drops them, so a section you folded does not stay
  // folded the next time you arrive, and one you peeked into closes again.
  // Reset during render (the derived-state pattern) rather than in an effect, so
  // the stale state never paints.
  const [manual, setManual] = useState<{ path: string; open: Record<string, boolean> }>({
    path: pathname,
    open: {},
  });
  if (manual.path !== pathname) setManual({ path: pathname, open: {} });
  const override = manual.path === pathname ? manual.open : {};
  const toggle = (href: string, next: boolean) =>
    setManual({ path: pathname, open: { ...override, [href]: next } });

  // With children open the list is taller than a laptop screen, so a page near
  // the bottom would be current and out of sight. Bring it into view on arrival.
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  // Reports draws its own list panel in its layout, to keep the width for the
  // canvas. Creative used to do the same with a top tab bar; its pages now live
  // here, as this panel's items and children.
  // Home spans every client and has no pages under it, so it has no panel either.
  if (product === "reports" || product === "home") return null;

  return (
    <aside className="nav-panel sticky top-0 hidden h-screen w-[var(--nav-w)] flex-none flex-col gap-[22px] bg-bg-inverse px-4 pb-[18px] pt-[22px] lg:flex">
      <div className="flex items-center justify-between gap-2 px-2">
        <Logo tone="inverse" />
        <NavCollapseToggle variant="panel" />
      </div>

      <nav
        ref={listRef}
        aria-label={product === "creative" ? "Creative" : "Analytics"}
        className="scrollbar-inverse flex flex-1 flex-col gap-[18px] overflow-auto"
      >
        {product === "chat" ? (
          <HistoryList />
        ) : (
          nav.map((group) => (
            <div key={group.label} className="flex flex-col gap-[3px]">
              <span className="px-2.5 pb-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-gray-400">
                {group.label}
              </span>

              {group.items.map((item) => (
                <NavEntry
                  key={item.href}
                  item={item}
                  qs={qs}
                  // Longest prefix wins, so a sub-route (/paid/meta) lights its parent.
                  isSection={active.item?.href === item.href}
                  activeChild={active.item?.href === item.href ? active.child : null}
                  expanded={override[item.href] ?? active.item?.href === item.href}
                  onToggle={(next) => toggle(item.href, next)}
                />
              ))}
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}

function NavEntry({
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
  const listId = `nav-children-${item.href.replace(/\W+/g, "-").replace(/^-|-$/g, "")}`;
  // On a child's page the parent is a place you are inside, not the page itself.
  const current = isSection ? (activeChild ? "true" : "page") : undefined;
  const pill = isSection
    ? "bg-growth-500/[0.14] font-semibold text-growth-300"
    : "text-gray-250 hover:bg-white/[0.06]";

  const link = (
    <AppLink
      href={navHref(item.href, qs)}
      aria-current={current}
      className={`${ROW} ${children.length > 0 ? "min-w-0 flex-1 pr-1" : ""} ${children.length > 0 ? "" : pill} ${
        isSection ? "relative" : ""
      }`}
    >
      {isSection && (
        <span
          aria-hidden="true"
          className="absolute left-[3px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent"
        />
      )}
      <NavIcon name={item.icon} />
      <span className="min-w-0 truncate">{item.label}</span>
    </AppLink>
  );

  if (children.length === 0) return link;

  return (
    <div className="flex flex-col">
      <div className={`flex items-center rounded-sm transition-colors duration-fast ${pill}`}>
        {link}
        <button
          type="button"
          onClick={() => onToggle(!expanded)}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-label={`${item.label} pages`}
          className="mr-1 flex h-7 w-7 flex-none items-center justify-center rounded-sm text-gray-400 transition-colors duration-fast hover:bg-white/[0.08] hover:text-gray-250 focus-visible:outline-offset-[-2px]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`transition-transform duration-fast ${expanded ? "rotate-90" : ""}`}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {expanded && (
        <ul id={listId} className="m-0 flex list-none flex-col gap-px p-0 pb-1 pt-[3px]">
          {children.map((child) => {
            const isActive = activeChild !== null && child.href === activeChild.href;
            return (
              <li key={child.href}>
                <AppLink
                  href={navHref(child.href, qs)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex w-full items-center rounded-sm py-[6px] pl-[37px] pr-2.5 text-left text-[13px] tracking-[-0.01em] transition-colors duration-fast focus-visible:outline-offset-[-2px] ${
                    isActive
                      ? "bg-white/[0.08] font-medium text-content-inverse"
                      : child.muted
                        ? "text-gray-400 hover:bg-white/[0.06] hover:text-gray-300"
                        : "text-gray-300 hover:bg-white/[0.06] hover:text-gray-250"
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
