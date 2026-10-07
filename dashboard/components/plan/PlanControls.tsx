"use client";

/**
 * The Plan page's control bar: the view (Month, Quarter, Promo, Target) and
 * the concrete period of that view. Both live in the URL (`view`, `period`),
 * like every other control, so a view is a shareable link. Switching the view
 * drops the period: each view opens on the period running today.
 *
 * Same frame as `ControlBar`, sticky under the header from `lg` up. The page
 * has no date range: a plan period is a calendar unit, and a free range would
 * let a target be read against the wrong days.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import type { PeriodOption } from "@/lib/plan/model";
import type { PlanView } from "@/lib/plan/types";

const VIEWS: Array<{ value: PlanView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "promo", label: "Promo" },
  { value: "target", label: "Target" },
];

export function PlanControls({
  view,
  options,
  period,
}: {
  view: PlanView;
  options: PeriodOption[];
  period: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, navigate, baseQuery } = useNavigation();
  const [optimistic, setOptimistic] = useState<PlanView | null>(null);

  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);

  function go(mutate: (q: URLSearchParams) => void) {
    const next = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    mutate(next);
    navigate(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="z-20 py-2 lg:sticky lg:top-[var(--header-h)] lg:border-b lg:border-hairline lg:bg-paper">
      <div className="page-frame flex flex-wrap items-center gap-x-4 gap-y-2 px-5 lg:px-8">
        <SegmentPills
          ariaLabel="Goals view"
          shown={optimistic ?? view}
          pending={isPending}
          segments={VIEWS}
          onSelect={(v) => {
            setOptimistic(v as PlanView);
            go((q) => {
              q.set("view", v);
              q.delete("period");
            });
          }}
        />

        {options.length > 0 && (
          <>
            <span aria-hidden="true" className="hidden h-5 w-px bg-hairline lg:block" />
            <label className="flex items-center gap-2">
              <span className="sr-only">Period</span>
              <select
                value={period ?? ""}
                onChange={(e) => go((q) => q.set("period", e.target.value))}
                className={`h-[34px] max-w-[300px] cursor-pointer truncate rounded-control border border-hairline bg-surface-card px-4 pr-8 text-[13px] text-content-strong shadow-xs transition-colors duration-fast hover:border-hairline-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                  isPending ? "oe-pulse" : ""
                }`}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  );
}
