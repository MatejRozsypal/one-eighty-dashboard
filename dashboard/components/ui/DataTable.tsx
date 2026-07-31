"use client";

/**
 * Sortable table.
 *
 * ── Why the cells arrive pre-rendered ───────────────────────────────────────
 * Every page here is a server component, and its formatting — currency,
 * platform badges, delta chips, masked emails — already lives there. A generic
 * table that took `render: (row) => ReactNode` would force all of that across
 * the client boundary, where functions cannot go.
 *
 * So the server renders each cell and hands over `ReactNode[]`, which *is*
 * serializable, plus a parallel array of plain sort keys. The server keeps
 * owning what a cell looks like; this component only owns what order the rows
 * come in. Adding sorting to a table is then a mechanical change, not a rewrite
 * of its formatting.
 *
 * ── Why sorting is client-side ──────────────────────────────────────────────
 * The alternative is a search param and a re-query, which on this warehouse
 * means 2–5 seconds of BigQuery to reorder rows already on screen. These tables
 * are capped at tens to low hundreds of rows, so a comparator in the browser is
 * instant and costs nothing.
 *
 * ── Resizable columns ───────────────────────────────────────────────────────
 * Column widths are dragged, not fixed by a `fr` template. Ad and campaign
 * names here run to sixty characters and product names to forty, so any ratio
 * chosen up front is wrong for somebody — the grid ends up with names truncated
 * to nothing beside a Spend column padded with air.
 *
 * Widths start from the caller's template, measured once after first paint, and
 * are only taken over by explicit pixels once a handle is actually dragged. So
 * the default layout is still responsive; resizing is opt-in and per-session,
 * which is the right trade for a table nobody wants to configure before reading.
 *
 * ── Nulls ───────────────────────────────────────────────────────────────────
 * A null is "we don't know", not "zero", so nulls sort to the bottom in *both*
 * directions rather than flipping to the top on ascending. Sorting a column
 * ascending to find the worst performers should not surface the rows we failed
 * to measure.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type SortDirection = "desc" | "asc" | null;

export interface DataTableColumn {
  key: string;
  label: string;
  /** Right-align — use for every numeric column. */
  align?: "right";
  /** Omit or set false for columns with no meaningful order (badges, actions). */
  sortable?: boolean;
}

export interface DataTableRow {
  key: string;
  cells: ReactNode[];
  /**
   * Sort key per column, index-aligned with `cells`. Numbers compare
   * numerically, strings case-insensitively, null sorts last.
   */
  sort: Array<number | string | null>;
}

/**
 * Once widths are explicit pixels, the row must size to its own columns.
 *
 * Rows sit inside a `min-w-[…]` block within an `overflow-x-auto` parent, so a
 * plain grid takes that block's width — 1000px, say — while dragged columns can
 * total 1260px. The `px-5` then belongs to the 1000px box and the overflow
 * escapes it: scrolled fully right, the last column lands exactly on the
 * container edge with zero padding, and the row's bottom border and hover
 * background stop 260px short of the content.
 *
 * `w-max` makes the box as wide as the columns actually are, so the padding
 * travels to the true end of the row; `min-w-full` keeps it filling the
 * container when the dragged total is narrower than the viewport.
 *
 * This applies only to the resized branch. The default branch uses `fr` columns,
 * which resolve against available space and would collapse to min-content under
 * `w-max` — and it has no such bug, because `fr` never overflows the box.
 */
const ROW_RESIZED = "grid w-max min-w-full items-center gap-2";

function compare(
  a: number | string | null,
  b: number | string | null
): number {
  // Nulls last, independent of direction — see the header note.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

export function DataTable({
  columns,
  rows,
  gridClass,
  emptyMessage = "Nothing in this range.",
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  /** Tailwind grid template shared by the header and every row. */
  gridClass: string;
  emptyMessage?: string;
}) {
  const [sortIndex, setSortIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<SortDirection>(null);

  // Null until a drag happens, so the caller's responsive template stays in
  // charge for anyone who never touches a handle.
  const [widths, setWidths] = useState<number[] | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  const beginResize = useCallback(
    (index: number, clientX: number) => {
      const cells = headerRef.current
        ? Array.from(headerRef.current.children)
        : [];
      const measured = cells.map((c) => (c as HTMLElement).getBoundingClientRect().width);
      if (measured.length === 0) return;
      setWidths((w) => w ?? measured);
      drag.current = {
        index,
        startX: clientX,
        startWidth: (widths ?? measured)[index] ?? 120,
      };
    },
    [widths]
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      setWidths((current) => {
        if (!current) return current;
        const next = [...current];
        // 56px floor: narrower than this and the heading is unreadable, so the
        // column can no longer say what it holds.
        next[d.index] = Math.max(56, d.startWidth + (e.clientX - d.startX));
        return next;
      });
    }
    function onUp() {
      drag.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const template = widths
    ? { gridTemplateColumns: widths.map((w) => `${w}px`).join(" ") }
    : undefined;

  const sorted = useMemo(() => {
    if (sortIndex === null || direction === null) return rows;
    // Copy first: sorting `rows` in place would mutate a prop and leave the
    // unsorted order unrecoverable when the user cycles back to default.
    const out = [...rows];
    out.sort((x, y) => {
      const r = compare(x.sort[sortIndex] ?? null, y.sort[sortIndex] ?? null);
      return direction === "desc" ? -r : r;
    });
    return out;
  }, [rows, sortIndex, direction]);

  // Highest first, then lowest, then back to whatever order the query returned.
  function cycle(index: number) {
    if (sortIndex !== index) {
      setSortIndex(index);
      setDirection("desc");
      return;
    }
    if (direction === "desc") {
      setDirection("asc");
      return;
    }
    setSortIndex(null);
    setDirection(null);
  }

  if (rows.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-[13px] text-content-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div role="table">
      <div
        ref={headerRef}
        role="row"
        style={template}
        className={`${widths ? ROW_RESIZED : gridClass} border-b border-hairline bg-gray-50 px-5 py-3`}
      >
        {columns.map((c, i) => {
          const active = sortIndex === i && direction !== null;
          const base = `font-mono text-[10.5px] uppercase tracking-[0.08em] ${
            c.align === "right" ? "text-right" : "text-left"
          }`;

          const handle = (
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${c.label}`}
              onMouseDown={(e) => {
                // Stops the header's own sort click from firing on drag start.
                e.preventDefault();
                e.stopPropagation();
                beginResize(i, e.clientX);
              }}
              className="absolute right-[-5px] top-0 z-10 h-full w-[10px] cursor-col-resize select-none before:absolute before:left-[4px] before:top-1/2 before:h-[14px] before:w-px before:-translate-y-1/2 before:bg-hairline-strong before:opacity-0 hover:before:opacity-100"
            />
          );

          if (c.sortable === false) {
            return (
              <span
                key={c.key}
                role="columnheader"
                className={`${base} relative text-content-muted`}
              >
                {c.label}
                {i < columns.length - 1 && handle}
              </span>
            );
          }

          return (
            <button
              key={c.key}
              type="button"
              role="columnheader"
              aria-sort={
                active
                  ? direction === "desc"
                    ? "descending"
                    : "ascending"
                  : "none"
              }
              onClick={() => cycle(i)}
              title={
                active
                  ? direction === "desc"
                    ? "Sorted highest first — click for lowest first"
                    : "Sorted lowest first — click to clear"
                  : `Sort by ${c.label}`
              }
              className={`${base} inline-flex items-center gap-1 transition-colors duration-fast hover:text-content-strong ${
                c.align === "right" ? "justify-end" : "justify-start"
              } relative ${active ? "text-content-strong" : "text-content-muted"}`}
            >
              <span className="truncate">{c.label}</span>
              {/*
                The caret holds its slot whether or not the column is active, so
                turning sorting on doesn't shove every other heading sideways.
              */}
              <span
                aria-hidden="true"
                className={`w-[7px] flex-none text-[8px] leading-none ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              >
                {direction === "asc" ? "▲" : "▼"}
              </span>
              {i < columns.length - 1 && handle}
            </button>
          );
        })}
      </div>

      {sorted.map((row) => (
        <div
          key={row.key}
          role="row"
          style={template}
          className={`${widths ? ROW_RESIZED : gridClass} border-b border-hairline px-5 py-3 transition-colors duration-fast hover:bg-gray-50`}
        >
          {row.cells.map((cell, i) => (
            <span
              key={columns[i]?.key ?? i}
              role="cell"
              className={`min-w-0 truncate ${columns[i]?.align === "right" ? "text-right" : ""}`}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
