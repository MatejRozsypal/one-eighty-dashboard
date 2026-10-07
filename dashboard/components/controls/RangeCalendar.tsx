"use client";

/**
 * Two-month range calendar for the period picker's custom range.
 *
 * Start and end are filled black, the days between them light grey, drawn as
 * one strip that runs behind the two ends. Weeks start on Sunday. Below `sm`
 * only the later month shows.
 *
 * ── The calendar opens on the recent end of the range, not its start ──────
 * It used to anchor on `range.from`, which is fine for "Last 30 days" and
 * actively harmful for anything long: on "All time" the popover opened on
 * September 2021 and the two months on screen were five years ago. Picking a
 * range there is the obvious next click, and it produces a custom range in
 * 2021, which then follows you to every other screen, because the sidebar
 * appends the current query string to every link. Anchoring on the month
 * BEFORE `focus` puts the two most recent months side by side. `focus` moves
 * the view only when the parent says so, never on a day click, so the months
 * do not jump under the pointer.
 */

import { useEffect, useState } from "react";
import { ArrowIcon } from "@/components/controls/Pill";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Month = { year: number; month: number };

function monthOf(date: string): Month {
  const [y, m] = date.split("-").map(Number);
  return { year: y, month: m - 1 };
}

function shift(m: Month, k: number): Month {
  const index = m.year * 12 + m.month + k;
  return { year: Math.floor(index / 12), month: index - Math.floor(index / 12) * 12 };
}

/** Calendar grid for a month, padded to whole weeks (Sunday-first). */
function monthGrid({ year, month }: Month): Array<Array<string | null>> {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

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

export function RangeCalendar({
  from,
  to,
  focus,
  isDisabled,
  onPick,
}: {
  /** The selection: `to` is null while the second click is pending. */
  from: string | null;
  to: string | null;
  /** The date the view should show in its right-hand month. */
  focus: string;
  isDisabled: (day: string) => boolean;
  onPick: (day: string) => void;
}) {
  const [first, setFirst] = useState<Month>(() => shift(monthOf(focus), -1));
  useEffect(() => {
    setFirst(shift(monthOf(focus), -1));
  }, [focus]);

  const months = [first, shift(first, 1)];
  const end = to ?? from;

  return (
    <div className="grid gap-6 px-4 pb-3 pt-2 sm:grid-cols-2 sm:px-5">
      {months.map((m, mi) => (
        <div
          key={`${m.year}-${m.month}`}
          className={`min-w-0 flex-col gap-1 ${mi === 0 ? "hidden sm:flex" : "flex"}`}
        >
          <div className="flex h-9 items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setFirst((f) => shift(f, -1))}
              // On a phone the one month shown carries both arrows.
              className={`rounded-sm p-1.5 text-content-strong hover:bg-gray-100 ${
                mi === 0 ? "" : "sm:invisible"
              }`}
            >
              <ArrowIcon dir="left" />
            </button>
            <span className="text-[14.5px] font-semibold text-content-strong">
              {new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setFirst((f) => shift(f, 1))}
              className={`rounded-sm p-1.5 text-content-strong hover:bg-gray-100 ${
                mi === 0 ? "invisible" : ""
              }`}
            >
              <ArrowIcon dir="right" />
            </button>
          </div>
          <div className="flex">
            {WEEKDAYS.map((d) => (
              <span
                key={d}
                className="flex-1 py-1 text-center text-[12.5px] text-content-muted"
              >
                {d}
              </span>
            ))}
          </div>
          {/* No gap between weeks: the strip runs unbroken from row to row. */}
          <div className="flex flex-col">
            {monthGrid(m).map((week, wi) => (
              <div key={wi} className="flex">
                {week.map((day, di) => {
                  if (!day) return <span key={di} className="h-9 flex-1" aria-hidden="true" />;

                  const isStart = day === from;
                  const isEnd = day === end;
                  const inRange = from !== null && end !== null && day > from && day < end;
                  const disabled = isDisabled(day);

                  // The grey strip runs under the two ends, from the middle of
                  // the start cell to the middle of the end cell.
                  const strip =
                    from !== null && end !== null && from !== end
                      ? isStart
                        ? "bg-[linear-gradient(to_right,transparent_50%,var(--gray-100)_50%)]"
                        : isEnd
                          ? "bg-[linear-gradient(to_left,transparent_50%,var(--gray-100)_50%)]"
                          : inRange
                            ? "bg-gray-100"
                            : ""
                      : "";

                  return (
                    <span key={di} className={`h-9 flex-1 ${strip}`}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(day)}
                        aria-pressed={isStart || isEnd || inRange}
                        className={`h-9 w-full text-[13.5px] tabular transition-colors duration-fast ${
                          isStart || isEnd
                            ? "rounded-sm bg-ink-900 font-semibold text-content-inverse"
                            : disabled
                              ? "cursor-not-allowed text-gray-250"
                              : inRange
                                ? "text-content-strong hover:bg-gray-150"
                                : "rounded-sm text-content-strong hover:bg-gray-100"
                        }`}
                      >
                        {Number(day.slice(8))}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** First click starts a range, the second closes it; an earlier second day swaps. */
export function nextSelection(
  sel: { from: string | null; to: string | null },
  day: string
): { from: string; to: string | null } {
  if (sel.from === null || sel.to !== null) return { from: day, to: null };
  if (day < sel.from) return { from: day, to: sel.from };
  return { from: sel.from, to: day };
}
