/**
 * A one-line notice above a section.
 *
 * Copy comes from a closed list (sprint plan section 4.7), 12 words or fewer:
 * "{n} {CUR} orders excluded from totals.", "Paid spend is Google only.",
 * "Stock as of {date}.", "No verdicts. Set thresholds in Settings.",
 * "Quantities only, not orders.", "Demo client: read only.", "No targets set.",
 * "Only {pct} of spend is tagged.", "Costs are estimates."
 * Anything new needs the lead's OK. Tokens only, no hex.
 */

import type { ReactNode } from "react";

const TONES = {
  info: "border-hairline bg-gray-50",
  warning: "border-warning/30 bg-notice-warning",
} as const;

/** One line of context. `tone` defaults to "info". */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <p
      role="note"
      className={`m-0 flex items-center gap-2 rounded-md border px-4 py-2.5 text-[13px] leading-[1.5] text-content-body ${TONES[tone]}`}
    >
      {tone === "warning" && (
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-warning" />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
