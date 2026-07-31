"use client";

/**
 * Date range control — preset menu plus a two-month calendar for custom ranges.
 *
 * Every preset ends **yesterday**, never today. Today is always partial: shops
 * report same-day but ad platforms are structurally a day behind, so a range
 * including today can never be complete across sources and would show every
 * metric falling off a cliff. The control makes that choice for you rather than
 * leaving a trap in the UI.
 *
 * State lives in the URL so the view is shareable and server components can read
 * it without a round trip.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  PRESET_LABELS,
  presetRange,
  type DateRange,
  type PresetKey,
  daysInRange,
  addDays,
} from "@/lib/period";

const PRESETS: PresetKey[] = ["7d", "28d", "30d", "90d", "mtd", "ytd", "12m"];

function fmt(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Calendar grid for a month, padded to whole weeks (Sunday-first). */
function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();

  const cells: Array<string | null> = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function DateRangeControl({
  range,
  presetKey,
}: {
  range: DateRange;
  presetKey: PresetKey | "custom";
}) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState<{ from: string; to: string | null }>({
    from: range.from,
    to: range.to,
  });
  const [anchorMonth, setAnchorMonth] = useState(() => {
    const [y, m] = range.from.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Close on outside click / Escape — a popover this large is easy to strand open.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function apply(params: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
    setCustomMode(false);
  }

  function choosePreset(key: PresetKey) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("preset", key);
    next.delete("from");
    next.delete("to");
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
  }

  function pickDay(day: string) {
    // First click starts a new range; second click closes it. Clicking a day
    // before the open end swaps the two rather than rejecting the input.
    if (draft.to !== null) {
      setDraft({ from: day, to: null });
    } else if (day < draft.from) {
      setDraft({ from: day, to: draft.from });
    } else {
      setDraft({ from: draft.from, to: day });
    }
  }

  const label =
    presetKey === "custom" ? "Custom" : PRESET_LABELS[presetKey as PresetKey];
  const draftDays =
    draft.to !== null ? daysInRange({ from: draft.from, to: draft.to }) : null;

  const months = [
    anchorMonth,
    anchorMonth.month === 11
      ? { year: anchorMonth.year + 1, month: 0 }
      : { year: anchorMonth.year, month: anchorMonth.month + 1 },
  ];

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2.5 rounded-control border border-hairline-strong bg-paper px-3 py-2 text-content-strong transition-colors duration-fast hover:bg-gray-50"
      >
        <span aria-hidden="true" className="text-[13px]">
          🗓
        </span>
        <span className="font-mono text-[12px] tracking-[-0.01em] tabular">
          {fmt(range.from)} – {fmt(range.to)}
        </span>
        <span aria-hidden="true" className="text-[9px] text-content-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <span className="hidden font-mono text-[11px] uppercase tracking-[0.06em] text-content-muted sm:inline">
        {label}
      </span>

      {open && (
        <div className="absolute left-0 top-[46px] z-[90] grid w-[min(760px,calc(100vw-2rem))] grid-cols-1 overflow-hidden rounded-lg border border-hairline bg-paper shadow-lg sm:grid-cols-[212px_minmax(0,1fr)]">
          <div className="flex flex-col gap-0.5 border-hairline bg-gray-50 p-2.5 sm:border-r">
            {PRESETS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => choosePreset(key)}
                className={`flex w-full items-center justify-between rounded-sm px-3 py-[9px] text-left text-[13.5px] text-content-strong transition-colors duration-fast hover:bg-gray-100 ${
                  presetKey === key ? "font-semibold" : "font-normal"
                }`}
              >
                {PRESET_LABELS[key]}
                <span className="font-mono text-[10px] text-content-muted">
                  {daysInRange(presetRange(key))}d
                </span>
              </button>
            ))}
            <span className="my-[7px] block h-px bg-hairline" />
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className={`flex w-full items-center justify-between rounded-sm px-3 py-[9px] text-left text-[13.5px] text-content-strong transition-colors duration-fast hover:bg-gray-100 ${
                customMode || presetKey === "custom" ? "font-semibold" : ""
              }`}
            >
              Custom range
              <span className="text-content-muted">→</span>
            </button>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-3 px-5 pb-3 pt-[18px]">
              <span className="flex-1 rounded-sm border border-hairline-strong px-3 py-[9px] font-mono text-[12.5px] tabular text-content-strong">
                {fmt(draft.from)}
              </span>
              <span aria-hidden="true" className="text-content-muted">
                →
              </span>
              <span className="flex-1 rounded-sm border border-hairline-strong px-3 py-[9px] font-mono text-[12.5px] tabular text-content-strong">
                {draft.to ? fmt(draft.to) : "Pick end date"}
              </span>
            </div>

            <div className="flex items-center justify-between px-5 pb-1">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() =>
                  setAnchorMonth((m) =>
                    m.month === 0
                      ? { year: m.year - 1, month: 11 }
                      : { year: m.year, month: m.month - 1 }
                  )
                }
                className="rounded-sm px-2 py-1 text-content-muted hover:bg-gray-100"
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Next month"
                onClick={() =>
                  setAnchorMonth((m) =>
                    m.month === 11
                      ? { year: m.year + 1, month: 0 }
                      : { year: m.year, month: m.month + 1 }
                  )
                }
                className="rounded-sm px-2 py-1 text-content-muted hover:bg-gray-100"
              >
                →
              </button>
            </div>

            <div className="grid gap-[22px] px-5 pb-3.5 pt-1.5 sm:grid-cols-2">
              {months.map(({ year, month }) => (
                <div key={`${year}-${month}`} className="flex min-w-0 flex-col gap-2">
                  <span className="pb-1 pt-0.5 text-center text-[14px] font-semibold text-content-strong">
                    {new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                  <div className="flex">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <span
                        key={d}
                        className="flex-1 text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                  {monthGrid(year, month).map((week, wi) => (
                    <div key={wi} className="flex">
                      {week.map((day, di) => {
                        if (!day)
                          return <span key={di} className="h-8 flex-1" aria-hidden="true" />;

                        const inRange =
                          draft.to !== null && day >= draft.from && day <= draft.to;
                        const isEdge = day === draft.from || day === draft.to;
                        // Today and later are unselectable — see the header comment.
                        const disabled = day > addDays(new Date().toISOString().slice(0, 10), -1);

                        return (
                          <button
                            key={di}
                            type="button"
                            disabled={disabled}
                            onClick={() => pickDay(day)}
                            className={`h-8 flex-1 font-mono text-[12px] tabular transition-colors duration-fast ${
                              isEdge
                                ? "rounded-sm bg-accent font-semibold text-accent-contrast"
                                : inRange
                                  ? "bg-accent-soft text-growth-700"
                                  : disabled
                                    ? "cursor-not-allowed text-gray-200"
                                    : "text-content-body hover:bg-gray-100"
                            }`}
                          >
                            {Number(day.slice(8))}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3.5">
              <span className="font-mono text-[11.5px] tabular text-content-muted">
                {draft.to
                  ? `${fmt(draft.from)} – ${fmt(draft.to)} · ${draftDays} days`
                  : "Pick an end date"}
              </span>
              <span className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ from: range.from, to: range.to });
                    setOpen(false);
                  }}
                  className="rounded-control border border-hairline-strong px-3.5 py-2 text-[13px] text-content-body transition-colors duration-fast hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!draft.to}
                  onClick={() =>
                    draft.to &&
                    apply({ preset: "custom", from: draft.from, to: draft.to })
                  }
                  className="rounded-control bg-ink-900 px-3.5 py-2 text-[13px] font-medium text-content-inverse transition-colors duration-fast hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Apply
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
