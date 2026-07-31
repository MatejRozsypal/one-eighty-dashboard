"use client";

/**
 * Mobile top bar — black, notch-aware, and the page switcher.
 *
 * ── The notch ───────────────────────────────────────────────────────────────
 * `viewportFit: "cover"` plus `statusBarStyle: "black-translucent"` is what
 * makes the installed PWA paint edge to edge like a native app. The cost is
 * that iOS then draws the clock, signal and battery *on top of* our own header
 * — which is exactly what was happening: the title and the status bar were
 * printed over each other.
 *
 * The fix is not to stop covering; it's to pad by `--safe-top` and paint that
 * strip black, so the system glyphs sit on a black bar of our own making. That
 * is the same shape the Shopify app uses, and it is why this bar is black on
 * mobile while the desktop header stays light: on a phone it has to own the
 * status-bar strip, on a laptop there is no strip to own.
 *
 * ── The title is the navigation ─────────────────────────────────────────────
 * There is no room for a sidebar here, and the bottom pill only holds four
 * destinations. Rather than hide the other eight behind a hamburger, the page
 * title itself opens the full list — the label you are already looking at is
 * the control that changes it.
 *
 * The title comes from the route rather than a prop, which is what lets the
 * app layout own this bar. That matters for the rounded shoulder: the content
 * beneath has to be a single surface the layout can round the top of, so the
 * bar cannot live inside the per-page `Header`.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { navFor, pageTitle } from "@/lib/nav";
import { useNavigation } from "@/components/shell/NavigationPending";
import type { Client } from "@/lib/clients";

export function MobileTopBar({
  clients = [],
  isAdmin = false,
}: {
  clients?: Client[];
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const title = pageTitle(pathname);
  const nav = navFor(isAdmin);

  // Same resolution the sidebar uses: the selection lives in the URL, so both
  // switchers agree without any shared state.
  const activeClient =
    clients.find((c) => c.clientId === searchParams.get("client")) ?? clients[0];

  const { isPending, navigate } = useNavigation();
  const [optimisticClient, setOptimisticClient] = useState<Client | null>(null);
  useEffect(() => {
    if (!isPending) setOptimisticClient(null);
  }, [isPending]);

  const shownClient = optimisticClient ?? activeClient;

  function selectClient(client: Client) {
    setClientOpen(false);
    if (client.clientId === shownClient?.clientId) return;
    setOptimisticClient(client);
    const next = new URLSearchParams(qs);
    next.set("client", client.clientId);
    navigate(`${pathname}?${next.toString()}`);
  }

  // Close on route change — without this the sheet stays up over the new page
  // for the whole BigQuery round trip and reads as a stuck menu.
  useEffect(() => {
    setOpen(false);
    setClientOpen(false);
  }, [pathname, qs]);

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
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex min-w-0 items-center gap-1.5 text-[21px] font-bold tracking-heading text-content-inverse"
        >
          <span className="truncate">{title}</span>
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
          edit `?client=` by hand. Shows the short name rather than initials —
          two clients whose initials collide are a real possibility, and there
          is room for a word.
        */}
        {shownClient && clients.length > 1 && (
          <div className="relative flex-none">
            <button
              type="button"
              onClick={() => setClientOpen((v) => !v)}
              aria-expanded={clientOpen}
              aria-haspopup="menu"
              aria-label={`Client: ${shownClient.name}`}
              className={`flex max-w-[136px] items-center gap-1.5 rounded-pill bg-white/[0.11] px-3 py-1.5 text-content-inverse transition-colors duration-fast active:bg-white/[0.18] ${
                isPending ? "animate-pulse" : ""
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
                  onClick={() => setClientOpen(false)}
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
        Black outside, content colour inside — the corner cut-outs are what
        show the black through.
      */}
      <div aria-hidden="true" className="h-4 bg-ink-900">
        <div className="h-4 rounded-t-2xl bg-bg-subtle" />
      </div>

      {open && (
        <>
          {/*
            Covers the viewport, not just the area under the sheet, so a tap
            anywhere outside dismisses — including on the bar itself.
          */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
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
            aria-label="Pages"
            className="absolute left-3 top-[calc(var(--header-bar-h)+var(--safe-top))] z-[50] max-h-[70vh] w-[64%] min-w-[228px] max-w-[300px] overflow-y-auto rounded-lg bg-paper p-2 shadow-lg"
          >
            {nav.map((group) => (
              <div key={group.label} className="flex flex-col">
                <span className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                  {group.label}
                </span>

                {group.items.map((item) => {
                  // Unbuilt pages stay visible and disabled rather than being
                  // dropped, matching the sidebar: the shape of the product is
                  // legible, and it's obvious what is coming.
                  if (!item.href) {
                    return (
                      <span
                        key={item.label}
                        title={item.note}
                        className="flex items-center justify-between gap-2 rounded-sm px-3 py-2.5 text-[15px] text-gray-250"
                      >
                        {item.label}
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-gray-250">
                          Soon
                        </span>
                      </span>
                    );
                  }

                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={qs ? `${item.href}?${qs}` : item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`rounded-sm px-3 py-2.5 text-[15px] transition-colors duration-fast ${
                        isActive
                          ? "bg-gray-100 font-semibold text-content-strong"
                          : "text-content-body"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </>
      )}
    </header>
  );
}
