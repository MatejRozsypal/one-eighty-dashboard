"use client";

/**
 * Read-only stack for viewports under 768px (design 1.12).
 *
 * Widgets keep their (y, x) reading order. KPI tiles go two to a row, every
 * other type is full width, and the height comes from the widget type (its
 * default row count) so a chart never collapses and a table never grows without
 * bound. There is no drag, no resize and no menu: editing starts at 1200px.
 *
 * Owner: RS6 (canvas).
 */

import type { ReactNode } from "react";
import { GRID, WIDGET_SIZE } from "@/lib/reports/limits";
import { readingOrder, type CanvasWidget } from "./useGridKeyboard";
import { WidgetFrame, type WidgetRender } from "./WidgetFrame";

/** Pixel height of `rows` grid rows including the gutters between them (same maths as the grid). */
export function stackHeight(rows: number): number {
  return rows * GRID.rowHeight + Math.max(0, rows - 1) * GRID.gutter;
}

export interface MobileStackProps {
  widgets: readonly CanvasWidget[];
  renderWidget(widget: CanvasWidget): WidgetRender;
  onOpen?(id: string): void;
  className?: string;
}

export function MobileStack({ widgets, renderWidget, onOpen, className }: MobileStackProps) {
  const ordered = readingOrder(widgets);

  // A run of KPI tiles pairs up two by two; a lone trailing tile spans the row.
  const span: Record<string, 1 | 2> = {};
  let run: CanvasWidget[] = [];
  const closeRun = () => {
    run.forEach((w, i) => {
      span[w.id] = run.length % 2 === 1 && i === run.length - 1 ? 2 : 1;
    });
    run = [];
  };
  for (const w of ordered) {
    if (w.type === "kpi") run.push(w);
    else {
      closeRun();
      span[w.id] = 2;
    }
  }
  closeRun();

  const items: ReactNode[] = ordered.map((w) => {
    const r = renderWidget(w);
    return (
      <div key={w.id} className={span[w.id] === 2 ? "col-span-2" : "col-span-1"} style={{ height: stackHeight(WIDGET_SIZE[w.type].h) }}>
        <WidgetFrame
          id={w.id}
          title={r.title}
          chip={r.chip}
          onOpen={onOpen ? () => onOpen(w.id) : undefined}
          onKeyDown={
            onOpen
              ? (e) => {
                  if (e.target === e.currentTarget && e.key === "Enter") {
                    e.preventDefault();
                    onOpen(w.id);
                  }
                }
              : undefined
          }
        >
          {r.body}
        </WidgetFrame>
      </div>
    );
  });

  return <div className={["report-stack grid grid-cols-2 gap-4", className].filter(Boolean).join(" ")}>{items}</div>;
}
