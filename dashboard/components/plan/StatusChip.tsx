/**
 * Pacing status as a small pill.
 *
 * The status comes from the warehouse (pace and a noise test together), never
 * from the page. A closed period shows its result instead (met or missed).
 * For ad spend "ahead" means spending over plan, so it reads as a warning,
 * not as good news. A status held back because the period is too young to
 * judge is drawn faded; the hover title says so.
 */

import { STATUS_LABEL } from "@/lib/plan/format";
import type { PacingRow, PacingStatus } from "@/lib/plan/types";

const TONE = {
  info: "bg-info/10 text-info",
  positive: "bg-growth-50 text-growth-700",
  warning: "bg-warning/15 text-warning-700",
  negative: "bg-negative/10 text-negative",
  neutral: "bg-gray-100 text-content-muted",
} as const;

type Tone = keyof typeof TONE;

function toneOf(status: PacingStatus, metric: string, result: PacingRow["result"]): Tone {
  switch (status) {
    case "ahead":
      return metric === "ad_spend" ? "warning" : "info";
    case "on_track":
      return "positive";
    case "behind":
      return "warning";
    case "off_track":
      return "negative";
    case "closed":
      return result === "met" ? "positive" : result === "missed" ? "negative" : "neutral";
    default:
      return "neutral";
  }
}

export function StatusChip({ row, className = "" }: { row: Pick<PacingRow, "status" | "metric" | "result" | "isTooEarly">; className?: string }) {
  const label =
    row.status === "closed" && row.result ? (row.result === "met" ? "Met" : "Missed") : STATUS_LABEL[row.status];
  const tone = toneOf(row.status, row.metric, row.result);
  return (
    <span
      title={row.isTooEarly ? "Too early to call" : undefined}
      className={[
        "inline-flex items-center whitespace-nowrap rounded-pill px-2 py-[3px] font-mono text-[10.5px] font-medium uppercase leading-none tracking-[0.04em]",
        TONE[tone],
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
