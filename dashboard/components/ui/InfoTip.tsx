"use client";

/**
 * The (i) next to a header or label. Where definitions, formulas and caveats
 * live (copy policy: at most 40 words, never a footnote).
 *
 * Focusable: opens on hover, on keyboard focus, and on tap.
 * For a metric with an entry in `METRIC_DEFINITIONS`, use `MetricTooltip`.
 *
 * A click opens the tip and keeps it open (so it works on touch and after a
 * hover). It never closes a tip that hover opened. It closes on Escape, on a
 * press outside, or when the pointer leaves an unpinned tip.
 *
 * Placement starts below and left-aligned. After the tip is rendered it is
 * measured once, before paint: near the right edge it aligns to the right edge
 * of the (i), near the bottom edge of the viewport it opens above.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

interface Placement {
  right: boolean;
  above: boolean;
}

const EDGE = 8;
const HOME: Placement = { right: false, above: false };

/** Hover/focus tooltip with plain text. */
export function InfoTip({ text, label = "More info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [placement, setPlacement] = useState<Placement>(HOME);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  // Measure at the default position and flip once if it would be cut off.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(HOME);
      return;
    }
    const tip = tipRef.current;
    const root = rootRef.current;
    if (!tip || !root) return;
    const t = tip.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const right = t.right > window.innerWidth - EDGE && r.right - t.width >= EDGE;
    const above =
      t.bottom > window.innerHeight - EDGE && r.top - t.height - EDGE >= EDGE;
    setPlacement((p) => (p.right === right && p.above === above ? p : { right, above }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    }
    function onPress(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex align-middle normal-case tracking-normal">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setPinned(false);
        }}
        onClick={(e) => {
          // Inside a sortable table header the click must not also sort.
          e.stopPropagation();
          // Opens, never closes: a click right after a hover must not hide
          // the tip the hover just showed.
          setOpen(true);
          setPinned(true);
        }}
        className="cursor-help rounded-full text-gray-250 transition-colors duration-fast hover:text-content-muted focus-visible:text-content-muted"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {open && (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className={`absolute z-[80] w-[260px] max-w-[calc(100vw-16px)] whitespace-normal rounded-md border border-hairline-inverse bg-bg-inverse p-[11px_13px] text-left font-sans text-[12px] font-normal leading-[1.5] text-gray-250 shadow-lg ${
            placement.right ? "right-0" : "left-0"
          } ${placement.above ? "bottom-[22px]" : "top-[22px]"}`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
