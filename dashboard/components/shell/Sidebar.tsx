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
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { activeNavHref, navFor, selectedClient } from "@/lib/nav";
import { productFor } from "@/lib/products";
import { NavCollapseToggle } from "@/components/shell/NavCollapseToggle";
import { HistoryList } from "@/components/chat/HistoryList";
import { Logo } from "@/components/ui/Logo";
import type { Client } from "@/lib/clients";

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
  const nav = navFor(isAdmin, client, isInternal);
  const active = activeNavHref(pathname);
  const product = productFor(pathname);

  // Creative navigates with a top tab bar, matching its approved design: it is
  // a wall of thumbnails, and 252px of dark chrome down the left is 252px not
  // spent on them. Returning null rather than rendering an empty panel means
  // the column collapses instead of leaving a dark gutter.
  // Reports draws its own list panel in its layout, for the same reason.
  if (product === "creative" || product === "reports") return null;

  return (
    <aside className="nav-panel sticky top-0 hidden h-screen w-[var(--nav-w)] flex-none flex-col gap-[22px] bg-bg-inverse px-4 pb-[18px] pt-[22px] lg:flex">
      <div className="flex items-center justify-between gap-2 px-2">
        <Logo tone="inverse" />
        <NavCollapseToggle variant="panel" />
      </div>

      <nav className="scrollbar-inverse flex flex-1 flex-col gap-[18px] overflow-auto">
        {product === "chat" ? (
          <HistoryList />
        ) : (
          nav.map((group) => (
          <div key={group.label} className="flex flex-col gap-[3px]">
            <span className="px-2.5 pb-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-gray-400">
              {group.label}
            </span>

            {group.items.map((item) => {
              // Longest prefix wins, so a sub-route (/paid/meta) lights its parent.
              const isActive = item.href === active;
              return (
                <Link
                  key={item.href}
                  href={qs ? `${item.href}?${qs}` : item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex w-full items-center gap-[9px] rounded-sm px-2.5 py-[9px] text-left text-[13.5px] tracking-[-0.01em] transition-colors duration-fast ${
                    isActive
                      ? "bg-growth-500/[0.14] font-semibold text-growth-300"
                      : "text-gray-250 hover:bg-white/[0.06]"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-4 w-[5px] rounded-[3px] ${
                      isActive ? "bg-accent" : "bg-transparent"
                    }`}
                  />
                  {item.label}
                </Link>
              );
            })}
            </div>
          ))
        )}
      </nav>

    </aside>
  );
}
