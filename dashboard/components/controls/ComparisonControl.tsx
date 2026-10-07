"use client";

/**
 * The comparison pill: the comparison's own dates ("Sep 1-30, 2025"), or "No
 * comparison", over a plain list of the three modes. A row applies on click.
 *
 * The pill answers on click, not on response: the new dates come from the
 * same `comparisonRange` the server uses, and are held until the page
 * commits. Without that, a click does nothing visible for the length of a
 * BigQuery query and reads as broken.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { CompareIcon, MenuRow, Pill, Popover, usePopover } from "@/components/controls/Pill";
import { formatRange } from "@/components/controls/rangeText";
import { comparisonRange, type ComparisonMode, type DateRange } from "@/lib/period";

const OPTIONS: Array<{ mode: ComparisonMode; label: string }> = [
  { mode: "previous_period", label: "Previous period" },
  { mode: "previous_year", label: "Previous year" },
  { mode: "none", label: "No comparison" },
];

export function ComparisonControl({
  range,
  mode,
  comparison,
}: {
  range: DateRange;
  mode: ComparisonMode;
  comparison: DateRange | null;
}) {
  const { open, setOpen, wrapRef } = usePopover();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, navigate, baseQuery } = useNavigation();

  const [optimistic, setOptimistic] = useState<ComparisonMode | null>(null);
  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);

  const shownMode = optimistic ?? mode;
  const shownComparison = optimistic ? comparisonRange(range, optimistic) : comparison;

  // Merged onto the URL a still-loading change is heading to, so a second
  // control used before the first answers does not undo it.
  function select(next: ComparisonMode) {
    setOpen(false);
    if (next === shownMode) return;
    setOptimistic(next);
    const q = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    q.set("compare", next);
    navigate(`${pathname}?${q.toString()}`);
  }

  return (
    <div ref={wrapRef} className="relative">
      <Pill
        icon={<CompareIcon />}
        label={shownComparison ? formatRange(shownComparison) : "No comparison"}
        open={open}
        onClick={() => setOpen((v) => !v)}
        pending={isPending && optimistic !== null}
        ariaLabel="Comparison period"
      />
      {open && (
        <Popover label="Comparison period" onClose={() => setOpen(false)} className="sm:w-[260px]">
          <div role="menu" className="flex flex-col gap-0.5 p-2">
            {OPTIONS.map((o) => (
              <MenuRow key={o.mode} selected={o.mode === shownMode} onClick={() => select(o.mode)}>
                {o.label}
              </MenuRow>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
