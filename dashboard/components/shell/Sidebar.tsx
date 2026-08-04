"use client";

/**
 * Left sidebar — dark, fixed, the app's spine.
 *
 * Dark is on-brand here specifically: the brand guide reserves near-black
 * surfaces and platform colors for "product/dashboard UI", which is what this
 * is. The marketing site's "no sidebars" rule doesn't apply to the product.
 *
 * Unbuilt nav items are shown greyed with a "Soon" badge rather than hidden.
 * That makes the shape of the product legible and marks what the warehouse
 * could already feed if the page existed.
 *
 * On mobile the sidebar collapses out of flow entirely and navigation moves to
 * the bottom tab bar — the four live destinations sit one level deep, so a
 * drawer would add a tap for nothing.
 *
 * Navigation only. The client switcher and the account both moved to
 * `AccountMenu` in the top-right corner: they answer the same question — whose
 * numbers am I looking at, and as whom — and were split across opposite ends of
 * this column.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { navFor } from "@/lib/nav";
import { Logo } from "@/components/ui/Logo";
import { Badge } from "@/components/ui/Badge";
import type { Client } from "@/lib/clients";

export function Sidebar({
  clients,
  isAdmin = false,
}: {
  /** Unused for rendering; kept so the shell passes one shape everywhere. */
  clients: Client[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const nav = navFor(isAdmin);

  return (
    <aside className="sticky top-0 hidden h-screen w-[252px] flex-none flex-col gap-[22px] bg-bg-inverse px-4 pb-[18px] pt-[22px] lg:flex">
      <div className="flex items-center px-2">
        <Logo tone="inverse" />
      </div>

      <nav className="scrollbar-inverse flex flex-1 flex-col gap-[18px] overflow-auto">
        {nav.map((group) => (
          <div key={group.label} className="flex flex-col gap-[3px]">
            <span className="px-2.5 pb-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-gray-400">
              {group.label}
            </span>

            {group.items.map((item) => {
              const isActive = item.href === pathname;
              const content = (
                <>
                  <span className="flex items-center gap-[9px]">
                    <span
                      aria-hidden="true"
                      className={`h-4 w-[5px] rounded-[3px] ${
                        isActive ? "bg-accent" : "bg-transparent"
                      }`}
                    />
                    {item.label}
                  </span>
                  {!item.href && (
                    <Badge variant="inverse" size="sm">
                      Soon
                    </Badge>
                  )}
                </>
              );

              const base =
                "flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-[9px] text-left text-[13.5px] tracking-[-0.01em]";

              return item.href ? (
                <Link
                  key={item.label}
                  href={qs ? `${item.href}?${qs}` : item.href}
                  className={`${base} transition-colors duration-fast ${
                    isActive
                      ? "bg-growth-500/[0.14] font-semibold text-growth-300"
                      : "text-gray-250 hover:bg-white/[0.06]"
                  }`}
                >
                  {content}
                </Link>
              ) : (
                <span
                  key={item.label}
                  title={item.note}
                  className={`${base} cursor-not-allowed text-gray-400`}
                >
                  {content}
                </span>
              );
            })}
          </div>
        ))}
      </nav>

    </aside>
  );
}
