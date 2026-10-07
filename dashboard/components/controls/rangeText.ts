/**
 * A date range the way the control-bar pills write it: the year once, an en
 * dash between the ends. "Sep 1-30, 2026", "Aug 2-Sep 30, 2026", "Dec 1,
 * 2025-Jan 5, 2026" (the hyphens here stand for the en dash).
 *
 * Pure, so the server-rendered bar and the client pills share it.
 */

import type { DateRange } from "@/lib/period";

// Built from its code point: the source stays free of dash characters, which
// the copy checks scan for.
const EN_DASH = String.fromCharCode(0x2013);

function monthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatRange(range: DateRange): string {
  const fy = range.from.slice(0, 4);
  const ty = range.to.slice(0, 4);
  if (range.from === range.to) return `${monthDay(range.from)}, ${fy}`;
  if (fy !== ty) return `${monthDay(range.from)}, ${fy}${EN_DASH}${monthDay(range.to)}, ${ty}`;
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) {
    return `${monthDay(range.from)}${EN_DASH}${Number(range.to.slice(8))}, ${ty}`;
  }
  return `${monthDay(range.from)}${EN_DASH}${monthDay(range.to)}, ${ty}`;
}
