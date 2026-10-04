"use client";

/**
 * Widget type picker: six icons, one word each (design 1.5, 1.6).
 *
 *   [#] KPI   [~] Line   [||] Bar
 *   [=] Table [1.] Ranked [.:] Scatter
 *
 * Two layouts of the same radio group:
 * - "grid": the popover opened by `+` or `/` (3 x 2). Picking calls `onPick`;
 *   the caller inserts the widget with its default size and opens the config
 *   drawer with the metric picker focused.
 * - "row": the Type field of the config drawer. Same keys, one line.
 *
 * Keyboard: arrows move (Left and Right by one, Up and Down by a row in the
 * grid), Home and End jump, Enter or Space picks, Esc calls `onClose`. The
 * group takes one Tab stop (roving tabindex) and focuses the current or first
 * type when `autoFocus` is set.
 *
 * Owner: RS8.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { WIDGET_TYPES, type WidgetType } from "@/lib/reports/types";

const LABEL: Record<WidgetType, string> = {
  kpi: "KPI",
  line: "Line",
  bar: "Bar",
  table: "Table",
  ranked: "Ranked",
  scatter: "Scatter",
};

const SVG = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const ICON: Record<WidgetType, ReactElement> = {
  kpi: (
    <svg {...SVG}>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M6.5 11.5 9 9l2 2 2.5-3" />
    </svg>
  ),
  line: (
    <svg {...SVG}>
      <path d="M3 15 7.5 9.5 11 12.5 17 5" />
    </svg>
  ),
  bar: (
    <svg {...SVG}>
      <path d="M5 16V9M10 16V4M15 16v-5" />
    </svg>
  ),
  table: (
    <svg {...SVG}>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8.5h14M3 12.5h14M8.5 4v12" />
    </svg>
  ),
  ranked: (
    <svg {...SVG}>
      <path d="M4 5.5h12M4 10h8M4 14.5h5" />
    </svg>
  ),
  scatter: (
    <svg {...SVG}>
      <circle cx="6" cy="13" r="1.4" />
      <circle cx="10.5" cy="8" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="13.5" cy="5" r="1.4" />
    </svg>
  ),
};

export interface WidgetTypePickerProps {
  /** Current type. Marks the radio checked; where focus starts. */
  value?: WidgetType;
  onPick: (type: WidgetType) => void;
  /** Esc. */
  onClose?: () => void;
  layout?: "grid" | "row";
  /** Move focus into the group on mount. */
  autoFocus?: boolean;
  /** Accessible name. Default "Widget type". */
  label?: string;
}

export function WidgetTypePicker({
  value,
  onPick,
  onClose,
  layout = "grid",
  autoFocus = false,
  label = "Widget type",
}: WidgetTypePickerProps) {
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, value ? WIDGET_TYPES.indexOf(value) : 0));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const columns = layout === "grid" ? 3 : WIDGET_TYPES.length;

  useEffect(() => {
    if (autoFocus) refs.current[focusIndex]?.focus();
    // Only on mount: later focus moves come from the key handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveTo(index: number) {
    const n = WIDGET_TYPES.length;
    const next = ((index % n) + n) % n;
    setFocusIndex(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        moveTo(focusIndex + 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        moveTo(focusIndex - 1);
        return;
      case "ArrowDown":
        e.preventDefault();
        moveTo(columns === WIDGET_TYPES.length ? focusIndex + 1 : Math.min(focusIndex + columns, WIDGET_TYPES.length - 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        moveTo(columns === WIDGET_TYPES.length ? focusIndex - 1 : Math.max(focusIndex - columns, 0));
        return;
      case "Home":
        e.preventDefault();
        moveTo(0);
        return;
      case "End":
        e.preventDefault();
        moveTo(WIDGET_TYPES.length - 1);
        return;
      case "Escape":
        if (onClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={
        layout === "grid"
          ? "grid w-[264px] grid-cols-3 gap-1 rounded-lg border border-hairline bg-paper p-1.5 shadow-lg"
          : "flex gap-0.5 rounded-pill bg-gray-100 p-[3px]"
      }
    >
      {WIDGET_TYPES.map((type, i) => {
        const checked = type === value;
        return (
          <button
            key={type}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(i)}
            onClick={() => onPick(type)}
            className={
              layout === "grid"
                ? `flex flex-col items-center gap-1.5 rounded-md px-2 py-2.5 text-[12px] transition-colors duration-fast hover:bg-gray-50 ${
                    checked ? "bg-accent-soft text-growth-700" : "text-content-strong"
                  }`
                : `flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
                    checked ? "bg-paper text-content-strong shadow-sm" : "text-content-muted hover:text-content-body"
                  }`
            }
          >
            {layout === "grid" ? ICON[type] : null}
            <span>{LABEL[type]}</span>
          </button>
        );
      })}
    </div>
  );
}
