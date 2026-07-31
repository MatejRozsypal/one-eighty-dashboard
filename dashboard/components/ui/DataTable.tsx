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
 * ── Nulls ───────────────────────────────────────────────────────────────────
 * A null is "we don't know", not "zero", so nulls sort to the bottom in *both*
 * directions rather than flipping to the top on ascending. Sorting a column
 * ascending to find the worst performers should not surface the rows we failed
 * to measure.
 */

import { useMemo, useState, type ReactNode } from "react";

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
        role="row"
        className={`${gridClass} border-b border-hairline bg-gray-50 px-5 py-3`}
      >
        {columns.map((c, i) => {
          const active = sortIndex === i && direction !== null;
          const base = `font-mono text-[10.5px] uppercase tracking-[0.08em] ${
            c.align === "right" ? "text-right" : "text-left"
          }`;

          if (c.sortable === false) {
            return (
              <span key={c.key} role="columnheader" className={`${base} text-content-muted`}>
                {c.label}
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
              } ${active ? "text-content-strong" : "text-content-muted"}`}
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
            </button>
          );
        })}
      </div>

      {sorted.map((row) => (
        <div
          key={row.key}
          role="row"
          className={`${gridClass} border-b border-hairline px-5 py-3 transition-colors duration-fast hover:bg-gray-50`}
        >
          {row.cells.map((cell, i) => (
            <span
              key={columns[i]?.key ?? i}
              role="cell"
              className={columns[i]?.align === "right" ? "text-right" : undefined}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
