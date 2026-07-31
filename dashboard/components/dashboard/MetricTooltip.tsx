"use client";

/**
 * The ⓘ next to a metric label.
 *
 * Half the metrics here need a sentence of explanation and several need a
 * caveat — CM3 nets two cost lines that are hardcoded to zero, revenue doesn't
 * net refunds, Manami's margin includes VAT. Surfacing those at the point of
 * reading is what makes this dashboard more trustworthy than the Looker reports
 * it replaces, so the limitation gets its own visually distinct row rather than
 * being folded into prose.
 *
 * Opens on hover for pointers and on focus/click for keyboard and touch.
 */

import { useState } from "react";
import type { MetricDefinition } from "@/lib/metrics";

export function MetricTooltip({ definition }: { definition: MetricDefinition }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`About ${definition.title}`}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="cursor-help text-gray-250 transition-colors duration-fast hover:text-content-muted"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-[22px] z-[80] flex w-[280px] flex-col gap-2 whitespace-normal rounded-md border border-hairline-inverse bg-bg-inverse p-[13px_15px] normal-case tracking-normal shadow-lg"
        >
          <span className="font-sans text-[13px] font-semibold text-content-inverse">
            {definition.title}
          </span>
          <span className="font-mono text-[11px] text-growth-300">
            {definition.formula}
          </span>
          <span className="font-sans text-[12px] text-gray-300">
            Source · {definition.source}
          </span>
          {definition.limitation && (
            <span className="flex gap-2 border-t border-hairline-inverse pt-[9px] font-sans text-[12px] leading-[1.5] text-[#F0C070]">
              <span aria-hidden="true">⚠</span>
              {definition.limitation}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
