"use client";

/**
 * Grid math and keyboard move/resize for the report canvas (design 1.11, 5.1).
 *
 * react-grid-layout has no keyboard support, so every keyboard action is a pure
 * function over the widget list, built on the library's own `moveElement` and
 * `verticalCompactor` so a key press lands exactly where the same change made
 * with the mouse would. `useGridKeyboard` only maps keys to those functions.
 *
 * Pure part (browser-safe, tested by `scripts/check-reports-canvas.ts`):
 *   normalizeWidgets, compactWidgets, moveWidget, resizeWidget, firstFreeSlot,
 *   readingOrder, tabletWidgets, announcement helpers.
 *
 * Keys (edit mode, a widget frame itself focused):
 *   Arrows            move one cell
 *   Shift + Arrows    resize one cell
 *   Enter             open config (any mode)
 *   Cmd/Ctrl + D      duplicate
 *   Delete/Backspace  remove
 * Tab and Shift+Tab are left to the browser: the canvas renders its widgets in
 * reading order (y, then x), so native tab order is the reading order.
 *
 * Owner: RS6 (canvas).
 */

import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import { cloneLayout, moveElement, verticalCompactor } from "react-grid-layout/core";
import type { LayoutItem as RglItem } from "react-grid-layout/core";
import { GRID, WIDGET_SIZE } from "@/lib/reports/limits";
import type { WidgetType } from "@/lib/reports/types";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** One canvas item: geometry plus the widget type (for min sizes). Titles and bodies come from the render prop. */
export interface CanvasWidget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geometry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLS = GRID.cols;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function toRgl(widgets: readonly CanvasWidget[]): RglItem[] {
  return widgets.map((w) => {
    const s = WIDGET_SIZE[w.type];
    return { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: s.minW, minH: s.minH, maxH: GRID.maxH };
  });
}

/** Merge a library layout back into widgets by id (type is kept; unknown ids are dropped). */
export function fromRgl(widgets: readonly CanvasWidget[], layout: readonly RglItem[]): CanvasWidget[] {
  const byId = new Map(layout.map((l) => [l.i, l]));
  return widgets.map((w) => {
    const l = byId.get(w.id);
    return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w;
  });
}

/** Clamp every item to its size limits and the grid, then compact. Idempotent. */
export function normalizeWidgets(widgets: readonly CanvasWidget[], cols: number = COLS): CanvasWidget[] {
  const clamped = widgets.map((w) => {
    const s = WIDGET_SIZE[w.type];
    const ww = clamp(Math.round(w.w), Math.min(s.minW, cols), cols);
    const hh = clamp(Math.round(w.h), s.minH, GRID.maxH);
    return {
      ...w,
      w: ww,
      h: hh,
      x: clamp(Math.round(w.x), 0, cols - ww),
      y: clamp(Math.round(w.y), 0, GRID.maxY),
    };
  });
  return compactWidgets(clamped, cols);
}

/** Vertical compaction through the library. Item order of the array is preserved. */
export function compactWidgets(widgets: readonly CanvasWidget[], cols: number = COLS): CanvasWidget[] {
  const compacted = verticalCompactor.compact(cloneLayout(toRgl(widgets)), cols);
  return fromRgl(widgets, compacted);
}

/** Reading order: by y, then x, then id (stable). */
export function readingOrder<T extends Geometry>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Move and resize
// ---------------------------------------------------------------------------

export interface MoveResult {
  widgets: CanvasWidget[];
  /** False when the item could not move (edge, or nothing to swap with). */
  changed: boolean;
  item: CanvasWidget | null;
}

const overlapsX = (a: Geometry, b: Geometry) => a.x < b.x + b.w && b.x < a.x + a.w;

/**
 * Move one item by one cell.
 *
 * Left and right: x +/- 1 (clamped), colliding items are pushed away by the
 * library. Up and down: vertical compaction pulls a lone cell step straight
 * back, so a vertical step jumps over the neighbour it touches instead: up
 * puts the item at the top of the nearest item above it (that item is pushed
 * down), down puts it directly below the nearest item beneath. With no
 * neighbour in that direction the item cannot move.
 */
export function moveWidget(widgets: readonly CanvasWidget[], id: string, dx: number, dy: number, cols: number = COLS): MoveResult {
  const current = normalizeWidgets(widgets, cols);
  const item = current.find((w) => w.id === id);
  if (!item) return { widgets: current, changed: false, item: null };

  let nx = item.x;
  let ny = item.y;
  if (dx !== 0) {
    nx = clamp(item.x + dx, 0, cols - item.w);
  } else if (dy < 0) {
    const above = current
      .filter((o) => o.id !== id && o.y + o.h <= item.y && overlapsX(o, item))
      .sort((a, b) => b.y + b.h - (a.y + a.h) || a.y - b.y);
    if (above.length === 0) return { widgets: current, changed: false, item };
    ny = above[0].y;
  } else if (dy > 0) {
    const below = current
      .filter((o) => o.id !== id && o.y >= item.y + item.h && overlapsX(o, item))
      .sort((a, b) => a.y - b.y);
    if (below.length === 0) return { widgets: current, changed: false, item };
    ny = below[0].y + below[0].h;
  }
  if (nx === item.x && ny === item.y) return { widgets: current, changed: false, item };

  const layout = cloneLayout(toRgl(current));
  const target = layout.find((l) => l.i === id) as RglItem;
  const moved = moveElement(layout, target, nx, ny, true, false, "vertical", cols, false);
  const next = fromRgl(current, verticalCompactor.compact(moved, cols));
  const after = next.find((w) => w.id === id) ?? null;
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  return { widgets: changed ? next : current, changed, item: after };
}

/**
 * Resize one item by whole cells, clamped to its type's minimum, the grid width
 * and `GRID.maxH`. Items it now overlaps are pushed down by compaction.
 */
export function resizeWidget(widgets: readonly CanvasWidget[], id: string, dw: number, dh: number, cols: number = COLS): MoveResult {
  const current = normalizeWidgets(widgets, cols);
  const item = current.find((w) => w.id === id);
  if (!item) return { widgets: current, changed: false, item: null };
  const s = WIDGET_SIZE[item.type];
  const w = clamp(item.w + dw, Math.min(s.minW, cols), cols - item.x);
  const h = clamp(item.h + dh, s.minH, GRID.maxH);
  if (w === item.w && h === item.h) return { widgets: current, changed: false, item };
  const grown = current.map((o) => (o.id === id ? { ...o, w, h } : o));
  const next = compactWidgets(grown, cols);
  return { widgets: next, changed: true, item: next.find((o) => o.id === id) ?? null };
}

/**
 * First free slot for a new w x h widget: the first row, then column, with no
 * overlap (design 1.4: "+ adds a widget at the first free slot"). Rows beyond
 * the bottom are always free, so this never fails.
 */
export function firstFreeSlot(widgets: readonly Geometry[], w: number, h: number, cols: number = COLS): { x: number; y: number } {
  const ww = Math.min(w, cols);
  const bottom = widgets.reduce((m, o) => Math.max(m, o.y + o.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + ww <= cols; x++) {
      const probe = { id: "", x, y, w: ww, h };
      const hit = widgets.some((o) => o.x < probe.x + probe.w && probe.x < o.x + o.w && o.y < probe.y + probe.h && probe.y < o.y + o.h);
      if (!hit) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** Add a widget of `type` at the first free slot, at its default size. */
export function addWidget(widgets: readonly CanvasWidget[], id: string, type: WidgetType, cols: number = COLS): CanvasWidget[] {
  const size = WIDGET_SIZE[type];
  const slot = firstFreeSlot(widgets, size.w, size.h, cols);
  return normalizeWidgets([...widgets, { id, type, x: slot.x, y: slot.y, w: size.w, h: size.h }], cols);
}

/** Clone `sourceId` as `newId`, placed directly below the source (compaction settles the rest). */
export function duplicateWidget(widgets: readonly CanvasWidget[], sourceId: string, newId: string, cols: number = COLS): CanvasWidget[] {
  const src = widgets.find((w) => w.id === sourceId);
  if (!src) return normalizeWidgets(widgets, cols);
  const clone: CanvasWidget = { ...src, id: newId, y: src.y + src.h };
  return normalizeWidgets([...widgets, clone], cols);
}

export function removeWidget(widgets: readonly CanvasWidget[], id: string, cols: number = COLS): CanvasWidget[] {
  return normalizeWidgets(
    widgets.filter((w) => w.id !== id),
    cols,
  );
}

/** Grow an item to its type's minimum when its type changed. */
export function retypeWidget(widgets: readonly CanvasWidget[], id: string, type: WidgetType, cols: number = COLS): CanvasWidget[] {
  return normalizeWidgets(
    widgets.map((w) => (w.id === id ? { ...w, type } : w)),
    cols,
  );
}

// ---------------------------------------------------------------------------
// Tablet (768 to 1199px): 6 columns derived from the 12-column layout. Display only.
// ---------------------------------------------------------------------------

export function tabletWidgets(widgets: readonly CanvasWidget[], cols: number = GRID.tabletCols): CanvasWidget[] {
  const factor = cols / COLS;
  // First fit in reading order: each item takes the first free spot at or below its own row, so
  // tiles that sat side by side stay side by side whenever they fit. Minimum sizes do not apply here.
  const placed: CanvasWidget[] = [];
  for (const w of readingOrder(widgets)) {
    const ww = clamp(Math.ceil(w.w * factor), 1, cols);
    let spot: { x: number; y: number } | null = null;
    for (let y = w.y; spot === null; y++) {
      for (let x = 0; x + ww <= cols; x++) {
        const hit = placed.some((o) => o.x < x + ww && x < o.x + o.w && o.y < y + w.h && y < o.y + o.h);
        if (!hit) {
          spot = { x, y };
          break;
        }
      }
    }
    placed.push({ ...w, w: ww, x: spot.x, y: spot.y });
  }
  const compacted = verticalCompactor.compact(
    cloneLayout(placed.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h }))),
    cols,
  );
  return fromRgl(placed, compacted);
}

// ---------------------------------------------------------------------------
// Announcements (aria-live)
// ---------------------------------------------------------------------------

export function announceMoved(title: string, item: Geometry): string {
  return `${title} moved to column ${item.x + 1}, row ${item.y + 1}`;
}

export function announceResized(title: string, item: Geometry): string {
  return `${title} resized to ${item.w} by ${item.h}`;
}

export function announceBlocked(title: string): string {
  return `${title} cannot move further`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface GridKeyboardOptions {
  widgets: readonly CanvasWidget[];
  /** Move, resize, remove and duplicate are only active when true. */
  editing: boolean;
  titleOf(id: string): string;
  /** Commit a new widget list. `key` lets the history coalesce key repeats. */
  onChange(next: CanvasWidget[], key: string): void;
  announce(message: string): void;
  onOpen?(id: string): void;
  onRemove?(id: string): void;
  onDuplicate?(id: string): void;
}

/** Returns a `keydown` handler factory for the widget frame of a given id. */
export function useGridKeyboard(opts: GridKeyboardOptions) {
  const { widgets, editing, titleOf, onChange, announce, onOpen, onRemove, onDuplicate } = opts;

  return useCallback(
    (id: string) => (e: KeyboardEvent<HTMLElement>) => {
      // Only keys pressed on the frame itself: inner inputs, menus and charts keep theirs.
      if (e.target !== e.currentTarget) return;
      const meta = e.metaKey || e.ctrlKey;

      if (e.key === "Enter" && !meta && !e.altKey) {
        if (onOpen) {
          e.preventDefault();
          onOpen(id);
        }
        return;
      }
      if (!editing) return;

      if (meta && (e.key === "d" || e.key === "D")) {
        if (onDuplicate) {
          e.preventDefault();
          onDuplicate(id);
        }
        return;
      }
      if (!meta && !e.altKey && (e.key === "Delete" || e.key === "Backspace")) {
        if (onRemove) {
          e.preventDefault();
          onRemove(id);
        }
        return;
      }

      const dir = e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowUp" ? [0, -1] : e.key === "ArrowDown" ? [0, 1] : null;
      if (!dir || meta || e.altKey) return;
      e.preventDefault();

      const title = titleOf(id);
      if (e.shiftKey) {
        const r = resizeWidget(widgets, id, dir[0], dir[1]);
        if (r.changed && r.item) {
          onChange(r.widgets, `resize:${id}`);
          announce(announceResized(title, r.item));
        } else {
          announce(announceBlocked(title));
        }
        return;
      }
      const r = moveWidget(widgets, id, dir[0], dir[1]);
      if (r.changed && r.item) {
        onChange(r.widgets, `move:${id}`);
        announce(announceMoved(title, r.item));
      } else {
        announce(announceBlocked(title));
      }
    },
    [widgets, editing, titleOf, onChange, announce, onOpen, onRemove, onDuplicate],
  );
}
