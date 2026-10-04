"use client";

/**
 * The (i) next to a header or label. Where definitions, formulas and caveats
 * live (copy policy: at most 40 words, never a footnote).
 *
 * Focusable: opens on hover, on keyboard focus, and on tap.
 * For a metric with an entry in `METRIC_DEFINITIONS`, use `MetricTooltip`.
 */

import { useId, useState } from "react";

/** Hover/focus tooltip with plain text. */
export function InfoTip({ text, label = "More info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex align-middle normal-case tracking-normal">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Inside a sortable table header the click must not also sort.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="cursor-help rounded-full text-gray-250 transition-colors duration-fast hover:text-content-muted focus-visible:text-content-muted"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-[22px] z-[80] w-[260px] whitespace-normal rounded-md border border-hairline-inverse bg-bg-inverse p-[11px_13px] text-left font-sans text-[12px] font-normal leading-[1.5] text-gray-250 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
