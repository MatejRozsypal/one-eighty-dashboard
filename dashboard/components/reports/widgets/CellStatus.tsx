"use client";

/**
 * How a report cell shows what it is and what it is not.
 *
 * - `StatusText`: the `n/a` glyph plus two or three muted words ("Not
 *   connected", "No data", "No cost data", "No FX Oct 2026"). A gap is never
 *   0 and never a dash. The cell's own reason is on hover when it says more.
 * - `NotesMark`: the `^` caveat marker ("4 of 5" for a partial rollup).
 *   Hover (and keyboard focus, and tap) lists the left-out clients and the
 *   caveats that apply to this client and metric.
 * - `CellDelta`: the change chip, relative or in pp, coloured by whether the
 *   movement is good for this metric.
 * - `HoverCard`: the dark card every hover in the widgets uses. Rendered in a
 *   portal with fixed coordinates, so it is neither clipped by a widget frame
 *   nor displaced by the grid's CSS transforms.
 * - `SeriesLegend`, `MetricSwitch`: the HTML legend and local metric switch of
 *   the chart widgets.
 *
 * No chart library is imported here: KPI, ranked and table widgets use it.
 *
 * Owner: RS7 (widgets). Design: 1.1, 1.9, 2.5, 2.10.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DeltaChip } from "@/components/ui/Delta";
import { NoValue } from "@/components/ui/EmptyState";
import type { GoodWhen } from "@/lib/reports/registry/types";
import type { MetricCell } from "@/lib/reports/types";
import { statusDetail, statusLabel, formatDeltaMagnitude } from "./format";
import { coverageBadge } from "./types";
import { HATCH_STROKE } from "./chartTheme";

// ---------------------------------------------------------------------------
// HoverCard
// ---------------------------------------------------------------------------

const CARD_WIDTH = 288;
const CARD_GAP = 6;

interface CardPosition {
  left: number;
  top?: number;
  bottom?: number;
}

/**
 * A focusable trigger with a card on hover, keyboard focus and tap.
 *
 * `label` is the trigger's accessible name and carries the card's text, so a
 * screen reader gets the list without opening anything.
 */
export function HoverCard({
  label,
  trigger,
  children,
  className = "",
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CardPosition | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();

  const cancelClose = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    cancelClose();
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8));
      // Flip above the trigger when there is no room below.
      const flip = rect.bottom + 180 > window.innerHeight && rect.top > 180;
      setPos(flip ? { left, bottom: window.innerHeight - rect.top + CARD_GAP } : { left, top: rect.bottom + CARD_GAP });
    }
    setOpen(true);
  }, [cancelClose]);

  // A short delay lets the pointer travel from the trigger onto the card (it can hold a link).
  const hide = useCallback(() => {
    cancelClose();
    timer.current = window.setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        className={`cursor-help rounded-sm transition-colors duration-fast focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${className}`}
      >
        {trigger}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              onMouseEnter={cancelClose}
              onMouseLeave={hide}
              style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: CARD_WIDTH }}
              className="z-[90] whitespace-normal rounded-md border border-hairline-inverse bg-bg-inverse p-[11px_13px] text-left font-sans text-[12px] font-normal normal-case leading-[1.5] tracking-normal text-gray-250 shadow-lg"
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/** One line of a hover card: a label and, right aligned, a value. */
export function CardRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-content-inverse">{label}</span>
      {value !== undefined && <span className="font-mono tabular text-content-inverse">{value}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gap and caveat rendering
// ---------------------------------------------------------------------------

/**
 * `n/a` and the status words. Not an empty state: it sits where the value
 * would. The reason is on hover only when it adds something to the words.
 */
export function StatusText({
  cell,
  size = "sm",
}: {
  cell: Pick<MetricCell, "status" | "reason" | "fxMonths">;
  /** "lg" matches a KPI figure. */
  size?: "sm" | "lg";
}) {
  const label = statusLabel(cell);
  const detail = statusDetail(cell);
  return (
    <span className={`inline-flex items-baseline gap-1.5 font-mono ${size === "lg" ? "text-[28px] leading-none" : "text-[12.5px]"}`}>
      <NoValue />
      {detail.length > 0 ? (
        <HoverCard label={`${label}. ${detail.join(". ")}`} trigger={<span className="font-mono text-[11px] text-content-muted">{label}</span>}>
          {detail.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </HoverCard>
      ) : (
        <span className="font-mono text-[11px] text-content-muted">{label}</span>
      )}
    </span>
  );
}

/**
 * The `^` caveat marker. Renders nothing for an empty list. A partial rollup
 * (first line "4 of 5 clients") shows the compact "4 of 5" instead of `^`;
 * the hover lists the left-out clients and their reasons.
 */
export function NotesMark({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  const badge = coverageBadge(lines[0]);
  return (
    <HoverCard
      label={lines.join(". ")}
      className={badge ? "ml-1.5 self-center" : "align-super"}
      trigger={
        badge ? (
          <span className="whitespace-nowrap font-mono text-[10px] leading-none text-content-muted hover:text-content-strong">{badge}</span>
        ) : (
          <span className="ml-0.5 font-mono text-[10px] leading-none text-content-muted hover:text-content-strong">^</span>
        )
      }
    >
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </HoverCard>
  );
}

/**
 * Change versus the comparison period. Relative deltas reuse DeltaChip; "pp"
 * deltas (percent metrics) are drawn the same way with the unit in pp. The
 * arrow follows the movement, the colour follows whether it is good.
 */
export function CellDelta({ delta, kind, goodWhen }: { delta: number | null; kind: "relative" | "pp"; goodWhen: GoodWhen }) {
  if (delta === null) return null;
  if (kind === "relative") return <DeltaChip delta={delta} goodWhen={goodWhen} />;
  const flat = Math.abs(delta) < 0.0005;
  const direction = flat ? "flat" : delta > 0 ? "up" : "down";
  const sentiment = goodWhen === "neutral" || flat ? "neutral" : direction === goodWhen ? "good" : "bad";
  const color = { good: "text-positive", bad: "text-negative", neutral: "text-content-muted" }[sentiment];
  const arrow = { up: "▲", down: "▼", flat: "→" }[direction];
  return (
    <span className={`inline-flex items-center gap-[5px] font-mono text-[12px] font-medium tabular ${color}`}>
      <span aria-hidden="true" className="text-[9px]">
        {arrow}
      </span>
      {formatDeltaMagnitude(delta, "pp")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Chart furniture (HTML, no chart library)
// ---------------------------------------------------------------------------

/** Diagonal hatch for a missing bar or series swatch. Tokens only. */
export const HATCH_STYLE = {
  backgroundImage: `repeating-linear-gradient(45deg, ${HATCH_STROKE} 0, ${HATCH_STROKE} 1.5px, transparent 1.5px, transparent 5px)`,
} as const;

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  dash?: string;
  /** Set when the series has no value for the shown metric. */
  cell?: Pick<MetricCell, "status" | "reason" | "fxMonths">;
  /** Caveat marker lines for the series. */
  notes?: readonly string[];
}

/**
 * Always present for two or more series. A series with a gap is greyed with
 * its status words; a not-connected series has no line, so its swatch is a
 * hatched, empty box.
 */
export function SeriesLegend({ items }: { items: readonly LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Series">
      {items.map((item) => {
        const gap = item.cell !== undefined && item.cell.status !== "ok";
        return (
          <li key={item.id} className="inline-flex items-center gap-[7px] font-mono text-[11px]">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 flex-none rounded-[3px] border"
              style={gap ? { ...HATCH_STYLE, borderColor: "var(--gray-250)" } : { background: item.color, borderColor: item.color }}
            />
            <span className={gap ? "text-content-muted" : "text-content-body"}>{item.label}</span>
            {item.cell && gap && <span className="text-content-muted">{statusLabel(item.cell)}</span>}
            {item.notes && <NotesMark lines={item.notes} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Local metric switch for charts with more than one metric. Every metric
 * arrived in the same result, so switching never queries. One axis per chart:
 * two measures are never drawn together.
 */
export function MetricSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div role="group" aria-label="Metric" className="flex flex-wrap gap-0.5 rounded-pill bg-gray-100 p-[3px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
            o.id === value ? "bg-paper text-content-strong shadow-sm" : "text-content-muted hover:text-content-body"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
