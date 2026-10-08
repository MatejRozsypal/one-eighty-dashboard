"use client";

/**
 * Mobile top bar, black, notch-aware, and the page switcher.
 *
 * ── The notch ───────────────────────────────────────────────────────────────
 * `viewportFit: "cover"` plus `statusBarStyle: "black-translucent"` is what
 * makes the installed PWA paint edge to edge like a native app. The cost is
 * that iOS then draws the clock, signal and battery *on top of* our own header
 *, which is exactly what was happening: the title and the status bar were
 * printed over each other.
 *
 * The fix is not to stop covering; it's to pad by `--safe-top` and paint that
 * strip black, so the system glyphs sit on a black bar of our own making. That
 * is the same shape the Shopify app uses, and it is why this bar is black on
 * mobile while the desktop header stays light: on a phone it has to own the
 * status-bar strip, on a laptop there is no strip to own.
 *
 * ── The title is the navigation ─────────────────────────────────────────────
 * There is no room for a sidebar here. Rather than hide the pages behind a
 * hamburger, the page title itself opens the full list: the label you are
 * already looking at is the control that changes it. The list is filtered for
 * the selected client, like the sidebar.
 *
 * The title comes from the route rather than a prop, which is what lets the
 * app layout own this bar. That matters for the rounded shoulder: the content
 * beneath has to be a single surface the layout can round the top of, so the
 * bar cannot live inside the per-page `Header`.
 */

import { AppLink } from "@/components/ui/AppLink";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  SETTINGS_HREF,
  isSettingsPath,
  navForProduct,
  navHref,
  pageTitle,
  resolveActive,
  selectedClient,
  sidebarProducts,
} from "@/lib/nav";
import { productFor } from "@/lib/products";
import { NavIcon } from "@/components/shell/NavIcon";
import { ProductIcon, SettingsIcon } from "@/components/shell/ProductIcon";
import { WhatsNewMenuItem } from "@/components/whatsnew/WhatsNewButton";
import { useNavigation } from "@/components/shell/NavigationPending";
import type { Client } from "@/lib/clients";
import type { Role } from "@/lib/users/store";

export function MobileTopBar({
  clients = [],
  isAdmin = false,
  isInternal = false,
  role,
}: {
  clients?: Client[];
  isAdmin?: boolean;
  isInternal?: boolean;
  /** Decides which products the sheet lists. */
  role: Role;
}) {
  // One menu at a time: the page sheet and the client menu used to stack over
  // each other at 390 px (QA C-12). A single value cannot hold both open.
  const [menu, setMenu] = useState<"pages" | "client" | null>(null);
  /** The title, which is what opens this sheet and outlives it. */
  const titleRef = useRef<HTMLButtonElement>(null);
  const open = menu === "pages";
  const clientOpen = menu === "client";
  const toggle = (which: "pages" | "client") =>
    setMenu((current) => (current === which ? null : which));
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const title = pageTitle(pathname);
  const activeProduct = productFor(pathname);

  // Same resolution the sidebar uses: the selection lives in the URL, so both
  // switchers agree without any shared state.
  const activeClient = selectedClient(clients, searchParams.get("client"));

  const { isPending, navigate, baseQuery } = useNavigation();
  const [optimisticClient, setOptimisticClient] = useState<Client | null>(null);
  useEffect(() => {
    if (!isPending) setOptimisticClient(null);
  }, [isPending]);

  const shownClient = optimisticClient ?? activeClient;

  // Reports picks its clients per report and Home shows them all, so the bar's
  // switcher is hidden on both.
  const showClientSwitcher = activeProduct !== "reports" && activeProduct !== "home";

  // Pages the selected client has no source for are hidden; products follow the role.
  const onSettings = isSettingsPath(pathname);
  const nav = onSettings ? [] : navForProduct(activeProduct, isAdmin, shownClient, isInternal);
  const products = sidebarProducts(role, shownClient);

  // The section you are in: its children are listed under it in the sheet, the
  // same as in the sidebar, and the bar names the page you are on inside it.
  const active = resolveActive(pathname, searchParams, nav.flatMap((g) => g.items));
  const subpage =
    active.child && active.child.href !== active.item?.href && title === active.item?.label
      ? active.child.label
      : null;

  function selectClient(client: Client) {
    setMenu(null);
    if (client.clientId === shownClient?.clientId) return;
    setOptimisticClient(client);
    // Merged onto the URL a still-loading change is heading to (see AccountMenu).
    const next = new URLSearchParams(baseQuery(pathname, qs));
    next.set("client", client.clientId);
    // A "client" navigation hides the page body until the new client's
    // figures commit, so the new name above never labels the old numbers.
    navigate(`${pathname}?${next.toString()}`, { kind: "client" });
  }

  // Close on route change, without this the sheet stays up over the new page
  // for the whole BigQuery round trip and reads as a stuck menu.
  useEffect(() => {
    setMenu(null);
  }, [pathname, qs]);

  // Escape closes whichever menu is open.
  useEffect(() => {
    if (menu === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  // The current page can sit far down the open product's list. Show it on open,
  // scrolling the sheet only, never the page behind it.
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const sheet = sheetRef.current;
    const here = sheet?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!open || !sheet || !here) return;
    const top = here.offsetTop;
    if (top + here.offsetHeight > sheet.clientHeight - 64) sheet.scrollTop = top - sheet.clientHeight / 3;
  }, [open]);

  // A sheet this tall over a scrollable page invites scrolling the page behind
  // it by accident.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 bg-ink-900 pt-[var(--safe-top)] lg:hidden">
      <div className="flex h-[var(--header-bar-h)] items-center justify-between gap-3 px-4">
        <button
          ref={titleRef}
          type="button"
          onClick={() => toggle("pages")}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex min-w-0 items-center gap-1.5 text-[21px] font-bold tracking-heading text-content-inverse"
        >
          <span className="truncate">
            {title}
            {subpage && <span className="font-medium text-gray-300"> / {subpage}</span>}
          </span>
          <span
            aria-hidden="true"
            className={`flex-none text-[13px] leading-none transition-transform duration-fast ${
              open ? "rotate-180" : ""
            }`}
          >
            ⌄
          </span>
        </button>

        {/*
          Client switcher, mirroring the sidebar's. On a phone the sidebar is
          gone entirely, so without this the only way to change client is to
          edit `?client=` by hand. Shows the short name rather than initials,
          two clients whose initials collide are a real possibility, and there
          is room for a word.
        */}
        {showClientSwitcher && shownClient && clients.length > 1 && (
          <div className="relative flex-none">
            <button
              type="button"
              onClick={() => toggle("client")}
              aria-expanded={clientOpen}
              aria-haspopup="menu"
              aria-label={`Client: ${shownClient.name}`}
              className={`flex max-w-[136px] items-center gap-1.5 rounded-pill bg-white/[0.11] px-3 py-1.5 text-content-inverse transition-colors duration-fast active:bg-white/[0.18] ${
                isPending ? "oe-pulse" : ""
              }`}
            >
              <span className="truncate font-mono text-[11.5px] font-medium">
                {shownClient.name}
              </span>
              <span aria-hidden="true" className="flex-none text-[10px] leading-none">
                ⌄
              </span>
            </button>

            {clientOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close client menu"
                  onClick={() => setMenu(null)}
                  className="fixed inset-0 z-[55] block w-full cursor-default"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-[38px] z-[60] flex w-[212px] flex-col gap-0.5 rounded-lg bg-paper p-1.5 shadow-lg"
                >
                  {clients.map((c) => {
                    const isActive = c.clientId === shownClient.clientId;
                    return (
                      <button
                        key={c.clientId}
                        type="button"
                        role="menuitem"
                        onClick={() => selectClient(c)}
                        className={`flex items-center justify-between gap-2 rounded-sm px-3 py-2.5 text-left text-[14px] transition-colors duration-fast ${
                          isActive
                            ? "bg-gray-100 font-semibold text-content-strong"
                            : "text-content-body"
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="flex-none font-mono text-[10px] text-content-muted">
                          {c.currency}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/*
        The rounded shoulder, and it lives *inside* the sticky header on
        purpose. When it was a corner on the scrolling content it was only
        visible at scroll-top: scroll down and the curve left with the content,
        so the page went flush against the black bar. Here it sticks, so the
        content always passes underneath a rounded edge.
        Black outside, content colour inside, the corner cut-outs are what
        show the black through.
      */}
      <div aria-hidden="true" className="h-4 bg-ink-900">
        <div className="h-4 rounded-t-2xl bg-bg-subtle" />
      </div>

      {open && (
        <>
          {/*
            Covers the viewport, not just the area under the sheet, so a tap
            anywhere outside dismisses, including on the bar itself.
          */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
            // Same expression as the sheet below rather than `var(--header-h)`:
            // that variable is resolved at :root, so it always carries the
            // root's `--safe-top`, while this needs whatever inset applies here.
            className="fixed inset-0 top-[calc(var(--header-bar-h)+var(--safe-top))] z-[45] block w-full cursor-default bg-ink-950/45"
          />

          {/*
            A panel down the left, not a full-width sheet: it hangs off the
            title it was opened from, and leaving the right-hand strip of the
            page visible keeps it reading as a menu over the screen rather than
            a new screen.
          */}
          <nav
            ref={sheetRef}
            aria-label="Pages"
            className="absolute left-3 top-[calc(var(--header-bar-h)+var(--safe-top))] z-[50] max-h-[70vh] w-[64%] min-w-[228px] max-w-[300px] overflow-y-auto rounded-lg bg-paper p-2 shadow-lg"
          >
            {/*
              The same hierarchy as the desktop sidebar: the products are the
              top-level rows, and the one you are in lists its pages under it,
              indented, with their own children one step further in. One
              vertical list, so nothing sits behind a sideways scroll at 390px
              (QA C-12). Chat history and the report list stay on their pages
              here: the sheet is for moving between pages.
            */}
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {products.map((p) => {
                const isCurrent = p.id === activeProduct && !onSettings;
                const isPage =
                  isCurrent &&
                  (p.id === "home" || p.id === "chat" || (p.id === "reports" && pathname === "/reports"));
                return (
                  <li key={p.id} className="flex flex-col">
                    <AppLink
                      href={qs ? `${p.href}?${qs}` : p.href}
                      onClick={() => setMenu(null)}
                      aria-current={isPage ? "page" : isCurrent ? "true" : undefined}
                      className={`flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-[15px] tracking-[-0.01em] transition-colors duration-fast ${
                        isPage
                          ? "bg-gray-100 font-semibold text-content-strong"
                          : isCurrent
                            ? "font-semibold text-content-strong"
                            : "text-content-body"
                      }`}
                    >
                      <span className={isCurrent ? "text-growth-700" : "text-content-muted"}>
                        <ProductIcon id={p.id} />
                      </span>
                      {p.label}
                    </AppLink>

                    {isCurrent && nav.length > 0 && (
                      <div className="flex flex-col pb-1">
                        {nav.map((group) => (
                          <div key={group.label} className="flex flex-col">
                            {nav.length > 1 && (
                              <span className="pb-1 pl-[40px] pr-3 pt-2.5 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                                {group.label}
                              </span>
                            )}

                            {group.items.map((item) => {
                              const isSection = active.item?.href === item.href;
                              const activeChild = isSection ? active.child : null;
                              const current = isSection ? (activeChild ? "true" : "page") : undefined;
                              return (
                                <div key={item.href} className="flex flex-col">
                                  <AppLink
                                    href={navHref(item.href, qs)}
                                    aria-current={current}
                                    className={`flex items-center gap-2.5 rounded-sm py-2 pl-[40px] pr-3 text-[14.5px] transition-colors duration-fast ${
                                      isSection
                                        ? "bg-gray-100 font-semibold text-content-strong"
                                        : "text-content-body"
                                    }`}
                                  >
                                    <span className={isSection ? "text-growth-700" : "text-content-muted"}>
                                      <NavIcon name={item.icon} size={16} />
                                    </span>
                                    {item.label}
                                  </AppLink>

                                  {isSection &&
                                    item.children?.map((child) => {
                                      const isActive = activeChild !== null && child.href === activeChild.href;
                                      return (
                                        <AppLink
                                          key={child.href}
                                          href={navHref(child.href, qs)}
                                          aria-current={isActive ? "page" : undefined}
                                          // Both steps clear 4.5:1 at 14px on the sheet: a
                                          // muted child is `--text-muted`, a plain one the
                                          // body colour, so the step between them survives.
                                          className={`rounded-sm py-2 pl-[66px] pr-3 text-[14px] transition-colors duration-fast ${
                                            isActive
                                              ? "font-semibold text-content-strong"
                                              : child.muted
                                                ? "text-content-muted"
                                                : "text-content-body"
                                          }`}
                                        >
                                          {child.label}
                                        </AppLink>
                                      );
                                    })}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}

              {isInternal && (
                <li className="flex flex-col">
                  <AppLink
                    href={SETTINGS_HREF}
                    onClick={() => setMenu(null)}
                    aria-current={onSettings ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-[15px] tracking-[-0.01em] transition-colors duration-fast ${
                      onSettings ? "bg-gray-100 font-semibold text-content-strong" : "text-content-body"
                    }`}
                  >
                    <span className={onSettings ? "text-growth-700" : "text-content-muted"}>
                      <SettingsIcon />
                    </span>
                    Settings
                  </AppLink>
                </li>
              )}
            </ul>

            {/*
              The account menu is `hidden lg:block`, so a phone has no corner
              drawer for this to sit in. The page sheet is the only global menu
              there is, so the item sits at its foot behind a rule, where a
              footer action is expected and cannot be mistaken for a page.

              Sticky, because this sheet scrolls: the nav groups are about
              1050px of list inside a 70vh box, so a footer in normal flow was
              a scroll away from anybody who did not already know it was there,
              which is the opposite of what a permanent control is for.

              Padded to a 44px target rather than matching the 42px nav rows:
              this one is a touch target first.
            */}
            <div className="sticky bottom-0 -mx-2 -mb-2 mt-2 border-t border-hairline bg-paper px-2 pb-2 pt-1.5">
              <WhatsNewMenuItem
                className="flex w-full items-center gap-2.5 rounded-sm px-3 py-3 text-left text-[15px] text-content-body transition-colors duration-fast active:bg-gray-100"
                onOpen={() => setMenu(null)}
                restoreFocusTo={() => titleRef.current}
              />
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
