/**
 * Pacing status as a small pill.
 *
 * The status comes from the warehouse (pace and a noise test together), never
 * from the page, and the word and the colour come from `lib/plan/health.ts`,
 * so the chip, the tile's ring and the charts cannot disagree.
 *
 * A status held back because the period is too young to judge is drawn faded;
 * the hover title says so. The word is always present, so the status never
 * rests on colour alone.
 *
 * It is a coloured word rather than a tinted pill. The skin's status colours
 * are tuned to clear 4.5:1 on white, and on their own tints the darker ones
 * land in the low fours; the choice was a second, darker set of reds and
 * greens for pills alone, or no pill. The mock has no pills either, and the
 * tile's own footer already says the status as a word, so the table and the
 * timeline now say it the same way.
 */

import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import type { PacingRow } from "@/lib/plan/types";

export function StatusChip({
  row,
  className = "",
}: {
  row: Pick<PacingRow, "status" | "metric" | "result" | "isTooEarly">;
  className?: string;
}) {
  const label = planStatusLabel(row);
  const colour = toneVars(toneOfRow(row));
  return (
    <span
      title={row.isTooEarly ? "Too early to call" : undefined}
      style={{ color: colour.text }}
      className={[
        "inline-flex items-center whitespace-nowrap text-[12.5px] font-semibold leading-[1.35]",
        row.isTooEarly ? "opacity-60" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
      {row.isTooEarly && <span className="sr-only"> (too early to call)</span>}
    </span>
  );
}

/** A small hollow dot after a figure that includes preliminary days. */
export function PreliminaryMark() {
  return (
    <span
      title="Includes preliminary days"
      className="ml-1 inline-block h-[6px] w-[6px] translate-y-[-2px] rounded-full border border-content-muted align-middle"
    >
      <span className="sr-only">Includes preliminary days</span>
    </span>
  );
}
