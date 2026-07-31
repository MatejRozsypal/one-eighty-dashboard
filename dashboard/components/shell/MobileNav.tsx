"use client";

/**
 * Mobile bottom navigation — a floating pill.
 *
 * The four live destinations sit one level deep, so a drawer would cost a tap
 * and buy nothing. Floating rather than docked so content scrolls visibly
 * beneath it, which is what makes an installed PWA feel like an app rather than
 * a page.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { href: "/snapshot", label: "Snapshot", icon: "◧" },
  { href: "/growth", label: "Growth", icon: "◪" },
  { href: "/customers", label: "Customers", icon: "◕" },
  { href: "/health", label: "Health", icon: "◍" },
];

export function MobileNav({ initials }: { initials: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  return (
    // pb sits on top of the home-indicator inset rather than guessing past it:
    // on a Face ID phone `--safe-bottom` is ~34px, on older hardware it is 0.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 px-3 pt-2.5 pb-[calc(0.75rem+var(--safe-bottom))] lg:hidden">
      <span className="pointer-events-auto flex flex-1 items-center justify-around rounded-pill bg-paper px-1.5 py-1.5 shadow-lg">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={qs ? `${tab.href}?${qs}` : tab.href}
              title={tab.label}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-[17px] leading-none transition-colors duration-fast ${
                isActive
                  ? "bg-gray-100 text-content-strong"
                  : "text-content-muted"
              }`}
            >
              <span aria-hidden="true">{tab.icon}</span>
            </Link>
          );
        })}
      </span>
      <span className="pointer-events-auto flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-accent font-mono text-[12px] font-semibold text-accent-contrast shadow-lg">
        {initials}
      </span>
    </div>
  );
}
