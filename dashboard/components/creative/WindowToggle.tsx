"use client";

/**
 * Lifetime against last 30 days.
 *
 * ── Why lifetime is the default, against the habit of every other screen ───
 * Accumulation is how a small account buys statistical power. A persona tested
 * across five months may reach 80 purchases even though no single month reaches
 * 20 — and 20 purchases carries a ±51% interval where 80 carries ±26%. A
 * rolling 30-day window throws that away and starts again every month.
 *
 * The 30-day view is labelled diagnostic, and it earns its place by making the
 * point visibly: switch to it and most rows stop being readable at all, which
 * is the honest picture of what one month of this account can support.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function WindowToggle({ current }: { current: "lifetime" | "30d" }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (value: "lifetime" | "30d") => {
    const next = new URLSearchParams(params.toString());
    if (value === "lifetime") next.delete("window");
    else next.set("window", value);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="flex items-center gap-px rounded-control border border-hairline-strong bg-paper/70 p-0.5 backdrop-blur-[8px]">
      {(
        [
          ["lifetime", "Lifetime"],
          ["30d", "30 days"],
        ] as const
      ).map(([value, label]) => (
        <Link
          key={value}
          href={href(value)}
          aria-current={current === value ? "true" : undefined}
          className={`rounded-[5px] px-2.5 py-1 text-[12.5px] transition-colors duration-fast ${
            current === value
              ? "bg-content-strong font-medium text-paper"
              : "text-content-muted hover:bg-gray-100"
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
