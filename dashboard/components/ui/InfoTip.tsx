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
 * ── Placement ──────────────────────────────────────────────────────────────
 * The tip is portalled to <body> with `position: fixed`, so no parent with
 * `overflow: hidden` (a card, a strip, a table wrapper) can cut it off. It is
 * measured before paint: below the (i) and left-aligned by default, above it
 * when there is no room below, and shifted sideways to stay 8 px inside the
 * viewport. It follows the (i) on scroll and resize while open.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EDGE = 8;
const GAP = 6;

interface Position {
  top: number;
  left: number;
}

/** Where the tip goes for an (i) at `anchor`, given the tip's size and the viewport. Pure. */
export function placeTip(
  anchor: { top: number; bottom: number; left: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): Position {
  const maxLeft = viewport.width - EDGE - tip.width;
  const left = Math.max(EDGE, Math.min(anchor.left, maxLeft));
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - tip.height;
  const fitsBelow = below + tip.height <= viewport.height - EDGE;
  const fitsAbove = above >= EDGE;
  const top = fitsBelow || !fitsAbove ? below : above;
  return { top, left };
}

/** Hover/focus tooltip with plain text. */
export function InfoTip({ text, label = "More info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  const measure = useCallback(() => {
    const tip = tipRef.current;
    const root = rootRef.current;
    if (!tip || !root) return;
    const r = root.getBoundingClientRect();
    const next = placeTip(
      r,
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
    );
    setPos((p) => (p && p.top === next.top && p.left === next.left ? p : next));
  }, []);

  // Measured before paint, so the tip never flashes at a wrong spot.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
      setPinned(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPress(e: PointerEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    // Capture: a scroll inside any scrolling parent moves the (i) as well.
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

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
        className="cursor-help rounded-full text-content-muted transition-colors duration-fast hover:text-content-strong focus-visible:text-content-strong"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="pointer-events-auto fixed z-[90] block w-[260px] max-w-[calc(100vw-16px)] whitespace-normal rounded-md border border-hairline-inverse bg-bg-inverse p-[11px_13px] text-left font-sans text-[12px] font-normal normal-case leading-[1.5] tracking-normal text-gray-250 shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
