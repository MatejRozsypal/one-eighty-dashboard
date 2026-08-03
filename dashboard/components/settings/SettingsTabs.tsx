"use client";

/**
 * The Settings tab bar.
 *
 * Shared by `/settings` and `/health` rather than owned by one of them. Data
 * Health is a genuinely separate route — it spans every client and predates
 * this area — but to the reader it is one of these tabs, and rebuilding its
 * page inside `/settings` to make that literally true would have meant moving
 * two hundred lines of working JSX for a visual outcome the user cannot
 * distinguish. Both routes render this bar; the highlight follows the path.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { label: "Clients", href: "/settings", tab: "clients" },
  { label: "Team", href: "/settings", tab: "team" },
  { label: "Data Health", href: "/health", tab: null },
  { label: "Access log", href: "/settings", tab: "log" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const search = useSearchParams();
  const currentTab = search.get("tab") ?? "clients";

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-hairline px-5 lg:px-8">
      {TABS.map((t) => {
        const active =
          t.href === "/health"
            ? pathname === "/health"
            : pathname === "/settings" && currentTab === t.tab;

        // The client selection is carried across tabs, so switching from a
        // client's goals to their people does not silently change who you are
        // looking at.
        const client = search.get("client");
        const query = new URLSearchParams();
        if (t.tab) query.set("tab", t.tab);
        if (client) query.set("client", client);
        const qs = query.toString();

        return (
          <Link
            key={t.label}
            href={qs ? `${t.href}?${qs}` : t.href}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-[13px] transition-colors duration-fast ${
              active
                ? "border-accent font-semibold text-content-strong"
                : "border-transparent text-content-muted hover:text-content-body"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
