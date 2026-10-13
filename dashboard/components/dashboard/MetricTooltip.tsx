"use client";

/**
 * The ⓘ next to a metric label.
 *
 * Half the metrics here need a sentence of explanation and several need a
 * caveat. Surfacing those at the point of reading is what makes this dashboard
 * more trustworthy than the reports it replaces, so the limitation gets its own
 * visually distinct row rather than being folded into prose.
 *
 * Opens on hover for pointers and on focus/click for keyboard and touch.
 * Same dismissal rules as `InfoTip` (WCAG 1.4.13): Escape closes it, and hover
 * covers the tip as well as the (i), with a short grace period to cross the gap.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MetricDefinition } from "@/lib/metrics";
import { CLOSE_DELAY } from "@/components/ui/InfoTip";

export function MetricTooltip({ definition }: { definition: MetricDefinition }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    // Hover is tracked on the wrapper, which holds the tip, so moving onto the
    // tip to read it keeps it open.
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={closeSoon}
    >
      <button
        type="button"
        aria-label={`About ${definition.title}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onClick={() => {
          cancelClose();
          setOpen((v) => !v);
        }}
        className="cursor-help text-content-muted transition-colors duration-fast hover:text-content-strong"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {open && (
        <span
          id={id}
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
          {definition.note && (
            <span className="border-t border-hairline-inverse pt-[9px] font-sans text-[12px] leading-[1.5] text-gray-300">
              {definition.note}
            </span>
          )}
          {definition.limitation && (
            <span className="flex gap-2 border-t border-hairline-inverse pt-[9px] font-sans text-[12px] leading-[1.5] text-warning-300">
              <span aria-hidden="true">⚠</span>
              {definition.limitation}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
