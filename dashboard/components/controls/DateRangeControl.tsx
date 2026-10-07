"use client";

/**
 * The period pill: preset menu plus a two-month calendar for custom ranges.
 *
 * Every range ends **yesterday** at the latest (locked rule), with one named
 * exception: the "Today" preset, offered where the page asks for it
 * (`withToday`). Today is always partial, shops report same-day but ad
 * platforms are a day behind, so the calendar never offers today or later.
 *
 * A preset applies on click. A custom range is picked on the calendar and
 * applied with Apply.
 *
 * State lives in the URL so the view is shareable and server components can read
 * it without a round trip.
 *
 * Below the `sm` breakpoint the popover is a bottom sheet: presets first, the
 * calendar (one month) behind "Custom range", and Cancel/Apply pinned to the
 * sheet's foot. As a popover it was about 1,100 px tall on a phone, with Apply
 * below the fold (QA C-13).
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { ArrowIcon, CalendarIcon, Pill, Popover, PopoverFooter, usePopover } from "@/components/controls/Pill";
import { RangeCalendar, nextSelection } from "@/components/controls/RangeCalendar";
import { formatRange } from "@/components/controls/rangeText";
import {
  PRESET_LABELS,
  presetRange,
  todayUtc,
  type DateRange,
  type PresetKey,
} from "@/lib/period";

/** The presets in menu order, grouped by the rail's dividers. */
const GROUPS: PresetKey[][] = [
  ["today"],
  ["7d", "28d", "30d", "90d"],
  ["mtd", "ytd"],
  ["12m", "all"],
];

const RAIL_ITEM =
  "flex w-full items-center rounded-sm px-3 py-2 text-left text-[14px] text-content-strong transition-colors duration-fast";

export function DateRangeControl({
  range,
  presetKey,
  withToday = false,
}: {
  range: DateRange;
  presetKey: PresetKey | "custom";
  /** Offer the "Today" preset. Only where the page's params accept it. */
  withToday?: boolean;
}) {
  const { open, setOpen, wrapRef } = usePopover();
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState<{ from: string | null; to: string | null }>({
    from: range.from,
    to: range.to,
  });

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The popover closes and the pill relabels the instant you choose, while
  // the query runs behind the progress bar. Holding the popover open until
  // BigQuery answers would leave the calendar sitting there for seconds
  // looking like the click was dropped.
  const { isPending, navigate, baseQuery } = useNavigation();

  // While a range is in flight the pill shows the range you asked for, not
  // the one still on screen, and pulses until the page commits (QA A-21).
  const [pending, setPending] = useState<{ range: DateRange; label: string } | null>(null);
  useEffect(() => {
    if (!isPending) setPending(null);
  }, [isPending]);

  const shownRange = pending?.range ?? range;
  const label =
    pending?.label ??
    (presetKey === "custom" ? formatRange(range) : PRESET_LABELS[presetKey]);

  function toggle() {
    // Every opening starts on the presets and on what is on screen; on a
    // phone the calendar is a second step behind "Custom range".
    if (!open) {
      setCustomMode(false);
      setDraft({ from: range.from, to: range.to });
    }
    setOpen((v) => !v);
  }

  // Merged onto the URL a still-loading change is heading to (compare,
  // currency, client), not the committed one, so neither change is lost.
  function applyCustom(from: string, to: string) {
    const next = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    next.set("preset", "custom");
    next.set("from", from);
    next.set("to", to);
    setPending({ range: { from, to }, label: formatRange({ from, to }) });
    setOpen(false);
    setCustomMode(false);
    navigate(`${pathname}?${next.toString()}`);
  }

  function choosePreset(key: PresetKey) {
    const next = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    next.set("preset", key);
    next.delete("from");
    next.delete("to");
    setPending({ range: presetRange(key), label: PRESET_LABELS[key] });
    setOpen(false);
    navigate(`${pathname}?${next.toString()}`);
  }

  const groups = GROUPS.map((g) => g.filter((k) => withToday || k !== "today")).filter(
    (g) => g.length > 0
  );
  const today = todayUtc();

  return (
    <div ref={wrapRef} className="relative">
      <Pill
        icon={<CalendarIcon />}
        label={label}
        open={open}
        onClick={toggle}
        pending={isPending}
        title={formatRange(shownRange)}
      />

      {open && (
        <Popover
          label="Date range"
          onClose={() => setOpen(false)}
          className="sm:grid sm:w-[min(800px,calc(100vw-2rem))] sm:grid-cols-[200px_minmax(0,1fr)]"
        >
          <div
            className={`min-h-0 flex-col overflow-y-auto border-hairline p-2.5 sm:flex sm:overflow-visible sm:border-r ${
              customMode ? "hidden" : "flex"
            }`}
          >
            {groups.map((group, gi) => (
              <div key={gi} className="flex flex-col gap-0.5">
                {gi > 0 && <span aria-hidden="true" className="my-1.5 block h-px bg-hairline" />}
                {group.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={presetKey === key}
                    onClick={() => choosePreset(key)}
                    className={`${RAIL_ITEM} ${
                      presetKey === key ? "bg-gray-100 font-semibold" : "hover:bg-gray-50"
                    }`}
                  >
                    {PRESET_LABELS[key]}
                  </button>
                ))}
              </div>
            ))}
            <span aria-hidden="true" className="my-1.5 block h-px bg-hairline" />
            <button
              type="button"
              aria-pressed={presetKey === "custom"}
              onClick={() => setCustomMode(true)}
              className={`${RAIL_ITEM} justify-between ${
                customMode || presetKey === "custom" ? "bg-gray-100 font-semibold" : "hover:bg-gray-50"
              }`}
            >
              Custom range
              <span className="text-content-muted sm:hidden">
                <ArrowIcon dir="right" />
              </span>
            </button>
          </div>

          <div className={`min-h-0 flex-1 flex-col sm:flex ${customMode ? "flex" : "hidden"}`}>
            <div className="min-h-0 flex-1 overflow-y-auto pt-2 sm:overflow-visible">
              <button
                type="button"
                onClick={() => setCustomMode(false)}
                className="flex items-center gap-1 px-4 pb-1 pt-1 text-[14px] text-content-strong sm:hidden"
              >
                <ArrowIcon dir="left" />
                Presets
              </button>
              <RangeCalendar
                from={draft.from}
                to={draft.to}
                focus={range.to}
                // Today and later are not selectable: ranges end yesterday.
                isDisabled={(day) => day >= today}
                onPick={(day) => setDraft(nextSelection(draft, day))}
              />
            </div>
            <PopoverFooter
              summary={
                draft.from
                  ? formatRange({ from: draft.from, to: draft.to ?? draft.from })
                  : null
              }
              canApply={draft.to !== null}
              onCancel={() => {
                setDraft({ from: range.from, to: range.to });
                setCustomMode(false);
                setOpen(false);
              }}
              onApply={() => draft.from && draft.to && applyCustom(draft.from, draft.to)}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}
