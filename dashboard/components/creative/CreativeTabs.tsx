"use client";

/**
 * The Creative section's tab bar.
 *
 * ── Why tabs and not the shell's sidebar ───────────────────────────────────
 * The approved design (docs/creative-engine/DEMO.html) puts navigation across
 * the top, and it earns that: this is a visual product whose main object is a
 * wall of creative, and 252px of dark chrome down the left is 252px not spent
 * on thumbnails. The sidebar panel is suppressed for this product — see
 * Sidebar.tsx — so there is exactly one navigation, here.
 *
 * The query string is carried across, because it holds the client, the window
 * and the breakdown dimension. Dropping it would silently reset whose numbers
 * you were looking at.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CREATIVE_NAV } from "@/lib/nav";

export function CreativeTabs({ unmapped, href }: { unmapped: number; href: string }) {
  const pathname = usePathname();
  const qs = useSearchParams().toString();

  return (
    <nav
      role="tablist"
      className="sticky top-[var(--header-h)] z-20 -mx-5 mb-1 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline bg-paper/70 px-5 backdrop-blur-[14px] lg:-mx-8 lg:px-8"
    >
      {CREATIVE_NAV.map((item) => {
        const active = item.href === pathname;
        return (
          <Link
            key={item.label}
            role="tab"
            aria-selected={active}
            href={qs ? `${item.href}?${qs}` : item.href!}
            className={`-mb-px whitespace-nowrap border-b-2 py-4 text-[14px] font-medium transition-colors duration-fast ${
              active
                ? "border-accent text-content-strong"
                : "border-transparent text-content-muted hover:text-content-body"
            }`}
          >
            {item.label}
          </Link>
        );
      })}

      {unmapped > 0 && (
        <Link
          href={href}
          className="ml-auto my-2 inline-flex items-center gap-2 rounded-pill border border-warning/25 bg-warning/10 px-3 py-1 text-[12.5px] font-medium text-warning transition-colors duration-fast hover:bg-warning/20"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {unmapped} {unmapped === 1 ? "ad" : "ads"} unmapped
        </Link>
      )}
    </nav>
  );
}
