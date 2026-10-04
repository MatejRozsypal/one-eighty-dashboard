"use client";

/**
 * The Paid section's tab bar: Overview, Meta, Google, GA4.
 *
 * Sticky under the page header and carrying the full query string, so the
 * client, range, comparison and currency survive a tab change (a link that
 * dropped them would silently change whose numbers you are reading).
 *
 * A tab for a platform the client does not have stays visible at muted weight
 * and still opens: it lands on that platform's "not connected" line. Hiding it
 * would make the tab set shift from client to client.
 *
 * The layout hands over the client registry; which client is selected is read
 * from `?client=` here, because layouts do not receive search params (the
 * Sidebar does the same).
 *
 * Scrolls sideways on a narrow screen instead of wrapping.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PAID_TABS, selectedClient } from "@/lib/nav";
import { pageAvailability, matchesPrefix, type HasCapabilities } from "@/lib/capabilities";
import { tabHref } from "@/lib/paid/links";

export function PaidTabs({
  clients,
}: {
  clients: Array<HasCapabilities & { clientId: string }>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const client = selectedClient(clients, searchParams.get("client"));

  return (
    <nav
      role="tablist"
      aria-label="Paid"
      className="sticky top-[var(--header-h)] z-20 border-b border-hairline bg-paper/90 backdrop-blur-[14px]"
    >
      <div className="page-frame flex h-[var(--paid-tabs-h)] items-stretch gap-6 overflow-x-auto px-5 [scrollbar-width:none] lg:px-8 [&::-webkit-scrollbar]:hidden">
        {PAID_TABS.map((tab) => {
          // Overview is "/paid" and is also a prefix of every other tab, so it is
          // active only on the exact route.
          const active =
            tab.key === "overview" ? pathname === tab.href : matchesPrefix(pathname, tab.href);
          const connected =
            tab.key === "overview" || !client || pageAvailability(client, tab.href) === "available";
          return (
            <Link
              key={tab.key}
              role="tab"
              aria-selected={active}
              href={tabHref(tab.key, searchParams)}
              className={`-mb-px flex flex-none items-center whitespace-nowrap border-b-2 text-[14px] transition-colors duration-fast ${
                active
                  ? "border-accent font-medium text-content-strong"
                  : connected
                    ? "border-transparent font-medium text-content-muted hover:text-content-body"
                    : "border-transparent font-normal text-content-muted/60 hover:text-content-muted"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
