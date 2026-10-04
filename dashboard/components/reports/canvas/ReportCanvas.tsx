"use client";

/**
 * The report canvas: a 12-column grid of resizable, draggable widget cards
 * (design 1.4, 1.11 to 1.13, 5.1).
 *
 * What it owns: layout state, undo/redo, autosave of the layout, keyboard
 * move/resize, the aria-live announcer, and the three display tiers. What it
 * does not own: widget data and bodies (the page renders those through
 * `renderWidget`), the widget configs (the page keeps them by id), the picker
 * and the config drawer (the page opens them from `onOpenConfig` and adds
 * widgets through the handle).
 *
 * Tiers (viewport width, not container width):
 *   >= 1200px   12 columns, full editing (when `mode` is "edit")
 *   768 - 1199  6 columns derived from the 12-column layout, display only
 *   < 768       `MobileStack`, display only
 *
 * Layout state is uncontrolled: `widgets` seeds it. To load another report,
 * remount with `key={reportId}`. Every committed change (drag stop, resize
 * stop, key press, add, remove, duplicate, undo, redo) calls `onWidgetsChange`,
 * and the geometry of the current list is autosaved through `onSave`.
 *
 * Page CSS (RS9's `app/(app)/reports/layout.tsx`), in this order:
 *   import "react-grid-layout/css/styles.css";
 *   import "./grid.css";
 *
 * Owner: RS6 (canvas).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { GridLayout, verticalCompactor } from "react-grid-layout";
import type { Layout, LayoutItem as RglItem } from "react-grid-layout";
import { GRID } from "@/lib/reports/limits";
import type { LayoutItem, WidgetType } from "@/lib/reports/types";
import { MobileStack } from "./MobileStack";
import { useAutosave, type AutosaveStatus, type SaveOutcome } from "./useAutosave";
import {
  addWidget,
  announceMoved,
  announceResized,
  duplicateWidget,
  fromRgl,
  normalizeWidgets,
  readingOrder,
  removeWidget,
  retypeWidget,
  tabletWidgets,
  toRgl,
  useGridKeyboard,
  type CanvasWidget,
} from "./useGridKeyboard";
import { useLayoutHistory } from "./useLayoutHistory";
import { WidgetFrame, type FrameMenuItem, type WidgetRender } from "./WidgetFrame";

export type { CanvasWidget } from "./useGridKeyboard";
export type { WidgetRender, FrameMenuItem } from "./WidgetFrame";
export type { AutosaveStatus, SaveOutcome } from "./useAutosave";

export type CanvasMode = "view" | "edit";
export type CanvasTier = "stack" | "tablet" | "desktop";
export type ChangeReason = "layout" | "add" | "remove" | "duplicate" | "retype" | "undo" | "redo";

export interface RenderContext {
  /** True only when the canvas is actually editable (edit mode at 1200px and up). */
  editing: boolean;
  tier: CanvasTier;
}

export interface ReportCanvasProps {
  /** Seed layout. Remount (`key`) to load another report. */
  widgets: readonly CanvasWidget[];
  mode: CanvasMode;
  /** Title, chip and body for one item. Called on every render of the canvas, so keep it cheap. */
  renderWidget(widget: CanvasWidget, ctx: RenderContext): WidgetRender;
  /** Autosave target (the page wires `ReportActions.saveLayout`). Debounced 800 ms. Omit to disable. */
  onSave?(layout: LayoutItem[]): Promise<SaveOutcome> | SaveOutcome;
  onSaveStatus?(status: AutosaveStatus): void;
  /** After every committed change, with the new list (so the page can drop configs of removed ids). */
  onWidgetsChange?(widgets: CanvasWidget[], reason: ChangeReason): void;
  /** Title click, menu "Edit", Enter on a focused widget. */
  onOpenConfig?(id: string): void;
  /**
   * The canvas created `newId` for a copy of `sourceId` and placed it. The page
   * must clone the config under `newId` in the same update. Without this
   * prop there is no Duplicate action.
   */
  onDuplicate?(sourceId: string, newId: string): void;
  /** After a widget was removed. The page may show an Undo toast that calls `handle.undo()`. */
  onRemove?(id: string): void;
  onHistoryChange?(state: { canUndo: boolean; canRedo: boolean }): void;
  /** Bind Cmd/Ctrl+Z and Shift+Z while editing. Default true. Turn off if the page owns undo. */
  undoShortcuts?: boolean;
  /** Shown instead of the grid while there are no widgets. */
  empty?: ReactNode;
  className?: string;
}

export interface ReportCanvasHandle {
  /** Add a widget of `type` at the first free slot, default size. The page creates its config under `id`. */
  add(id: string, type: WidgetType): void;
  remove(id: string): void;
  /** Change a widget's type (grows it to the new minimum when needed). */
  retype(id: string, type: WidgetType): void;
  undo(): void;
  redo(): void;
  /** Save now. Resolves when nothing is pending. */
  flush(): Promise<void>;
  focus(id: string): void;
  /** The current list. */
  getWidgets(): CanvasWidget[];
}

// ---------------------------------------------------------------------------
// Viewport tier and container width
// ---------------------------------------------------------------------------

function subscribeTier(cb: () => void): () => void {
  const queries = [window.matchMedia(`(min-width: ${GRID.editMinWidth}px)`), window.matchMedia(`(min-width: ${GRID.tabletMinWidth}px)`)];
  queries.forEach((q) => q.addEventListener("change", cb));
  return () => queries.forEach((q) => q.removeEventListener("change", cb));
}

function tierSnapshot(): CanvasTier {
  if (window.matchMedia(`(min-width: ${GRID.editMinWidth}px)`).matches) return "desktop";
  if (window.matchMedia(`(min-width: ${GRID.tabletMinWidth}px)`).matches) return "tablet";
  return "stack";
}

/** Null on the server and during hydration, then the real tier. */
function useViewportTier(): CanvasTier | null {
  return useSyncExternalStore<CanvasTier | null>(subscribeTier, tierSnapshot, () => null);
}

/** Measures the element with a ResizeObserver (own implementation: see the RS0 note on the v2 hook's ref type). */
function useElementWidth(): [RefObject<HTMLDivElement>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

const toLayoutItems = (ws: readonly CanvasWidget[]): LayoutItem[] => ws.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ReportCanvas = forwardRef<ReportCanvasHandle, ReportCanvasProps>(function ReportCanvas(props, handleRef) {
  const { mode, renderWidget, onSave, onSaveStatus, onWidgetsChange, onOpenConfig, onDuplicate, onRemove, onHistoryChange, undoShortcuts = true, empty, className } = props;

  const history = useLayoutHistory<CanvasWidget[]>(() => normalizeWidgets(props.widgets));
  const widgets = history.present;
  const wRef = useRef(widgets);
  wRef.current = widgets;

  const tier = useViewportTier();
  const [wrapRef, width] = useElementWidth();
  const canEdit = mode === "edit" && tier === "desktop";

  // Announcer: a trailing no-break space on alternate messages makes a repeated message re-announce.
  const [live, setLive] = useState("");
  const liveToggle = useRef(false);
  const announce = useCallback((message: string) => {
    liveToggle.current = !liveToggle.current;
    setLive(liveToggle.current ? message : `${message} `);
  }, []);

  // Titles for announcements, refreshed on each render.
  const titles = useRef(new Map<string, string>());
  const titleOf = useCallback((id: string) => titles.current.get(id) ?? "Widget", []);

  // Focus follows a widget across reorders (React moves the node, the browser drops focus).
  const frames = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = frames.current.get(id);
    if (el) {
      if (document.activeElement !== el) el.focus({ preventScroll: false });
      pendingFocus.current = null;
    }
  }, [widgets]);

  // ---- commits ------------------------------------------------------------

  const commit = useCallback(
    (next: CanvasWidget[], reason: ChangeReason, key?: string): CanvasWidget[] => {
      const before = wRef.current;
      const result = history.commit(next, { key });
      if (result !== before) {
        wRef.current = result;
        onWidgetsChange?.(result, reason);
      }
      return result;
    },
    [history, onWidgetsChange],
  );

  const undo = useCallback(() => {
    if (!history.canUndo) return;
    const before = wRef.current;
    const result = history.undo();
    if (result !== before) {
      wRef.current = result;
      onWidgetsChange?.(result, "undo");
      announce("Undone");
    }
  }, [history, onWidgetsChange, announce]);

  const redo = useCallback(() => {
    if (!history.canRedo) return;
    const before = wRef.current;
    const result = history.redo();
    if (result !== before) {
      wRef.current = result;
      onWidgetsChange?.(result, "redo");
      announce("Redone");
    }
  }, [history, onWidgetsChange, announce]);

  const remove = useCallback(
    (id: string) => {
      const list = wRef.current;
      if (!list.some((w) => w.id === id)) return;
      const order = readingOrder(list);
      const at = order.findIndex((w) => w.id === id);
      const neighbour = order[at + 1] ?? order[at - 1];
      const title = titleOf(id);
      pendingFocus.current = neighbour?.id ?? null;
      commit(removeWidget(list, id), "remove");
      onRemove?.(id);
      announce(`${title} removed`);
    },
    [commit, onRemove, announce, titleOf],
  );

  const duplicate = useCallback(
    (id: string) => {
      if (!onDuplicate) return;
      const newId = crypto.randomUUID();
      onDuplicate(id, newId);
      pendingFocus.current = newId;
      commit(duplicateWidget(wRef.current, id, newId), "duplicate");
      announce(`${titleOf(id)} duplicated`);
    },
    [commit, onDuplicate, announce, titleOf],
  );

  const onKeyboardChange = useCallback(
    (next: CanvasWidget[], key: string) => {
      pendingFocus.current = key.split(":")[1] ?? null;
      commit(next, "layout", key);
    },
    [commit],
  );

  const keyHandler = useGridKeyboard({
    widgets,
    editing: canEdit,
    titleOf,
    onChange: onKeyboardChange,
    announce,
    onOpen: onOpenConfig,
    onRemove: remove,
    onDuplicate: onDuplicate ? duplicate : undefined,
  });

  // ---- autosave and history reporting -------------------------------------

  const layoutItems = useMemo(() => toLayoutItems(widgets), [widgets]);
  const autosave = useAutosave<LayoutItem[]>(layoutItems, {
    onSave: (items) => (onSave ? onSave(items) : undefined),
    enabled: Boolean(onSave),
  });
  useEffect(() => {
    onSaveStatus?.(autosave.status);
  }, [autosave.status, onSaveStatus]);

  const { canUndo, canRedo } = history;
  useEffect(() => {
    onHistoryChange?.({ canUndo, canRedo });
  }, [canUndo, canRedo, onHistoryChange]);

  // Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y.
  useEffect(() => {
    if (!canEdit || !undoShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y" && e.ctrlKey) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, undoShortcuts, undo, redo]);

  // ---- handle -------------------------------------------------------------

  useImperativeHandle(
    handleRef,
    () => ({
      add(id, type) {
        pendingFocus.current = id;
        commit(addWidget(wRef.current, id, type), "add");
        announce("Widget added");
      },
      remove,
      retype(id, type) {
        commit(retypeWidget(wRef.current, id, type), "retype");
      },
      undo,
      redo,
      flush: autosave.flush,
      focus(id) {
        frames.current.get(id)?.focus();
      },
      getWidgets: () => wRef.current,
    }),
    [commit, remove, undo, redo, autosave.flush, announce],
  );

  // ---- mouse drag and resize: commit on stop only -------------------------

  const onGridStop = useCallback(
    (layout: Layout, oldItem: RglItem | null, newItem: RglItem | null) => {
      const next = normalizeWidgets(fromRgl(wRef.current, layout));
      const moved = commit(next, "layout");
      if (!oldItem || !newItem) return;
      const item = moved.find((w) => w.id === newItem.i);
      if (!item) return;
      const title = titleOf(item.id);
      if (item.w !== oldItem.w || item.h !== oldItem.h) announce(announceResized(title, item));
      else if (item.x !== oldItem.x || item.y !== oldItem.y) announce(announceMoved(title, item));
    },
    [commit, announce, titleOf],
  );

  // ---- render -------------------------------------------------------------

  const ctx: RenderContext = { editing: canEdit, tier: tier ?? "desktop" };
  const ordered = readingOrder(widgets);
  const rendered = new Map<string, WidgetRender>();
  for (const w of ordered) {
    const r = renderWidget(w, ctx);
    rendered.set(w.id, r);
    titles.current.set(w.id, r.title);
  }

  const menuFor = (w: CanvasWidget): FrameMenuItem[] => {
    const items: FrameMenuItem[] = [];
    if (onOpenConfig) items.push({ id: "edit", label: canEdit ? "Edit" : "Details", onSelect: () => onOpenConfig(w.id) });
    items.push(...(rendered.get(w.id)?.menu ?? []));
    if (canEdit && onDuplicate) items.push({ id: "duplicate", label: "Duplicate", onSelect: () => duplicate(w.id) });
    if (canEdit) items.push({ id: "remove", label: "Remove", danger: true, onSelect: () => remove(w.id) });
    return items;
  };

  const cols = tier === "tablet" ? GRID.tabletCols : GRID.cols;
  const shown = tier === "tablet" ? tabletWidgets(widgets) : widgets;
  const rgl: RglItem[] =
    tier === "tablet"
      ? shown.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h }))
      : toRgl(widgets);

  const gridChildren = readingOrder(shown).map((w) => {
    const r = rendered.get(w.id) as WidgetRender;
    return (
      <div key={w.id}>
        <WidgetFrame
          ref={(el) => {
            if (!el) {
              frames.current.delete(w.id);
              return;
            }
            frames.current.set(w.id, el);
            // A frame that mounts after the commit (the grid renders new items a pass later) takes focus here.
            if (pendingFocus.current === w.id && el.isConnected) {
              pendingFocus.current = null;
              el.focus();
            }
          }}
          id={w.id}
          title={r.title}
          chip={r.chip}
          editing={canEdit}
          menu={menuFor(w)}
          onOpen={onOpenConfig ? () => onOpenConfig(w.id) : undefined}
          onKeyDown={keyHandler(w.id)}
        >
          {r.body}
        </WidgetFrame>
      </div>
    );
  });

  const gridConfig = useMemo(
    () => ({ cols, rowHeight: GRID.rowHeight, margin: [GRID.gutter, GRID.gutter] as const, containerPadding: [0, 0] as const, maxRows: Infinity }),
    [cols],
  );
  const dragConfig = useMemo(() => ({ enabled: canEdit, bounded: false, handle: ".widget-drag", threshold: 3 }), [canEdit]);
  const resizeConfig = useMemo(() => ({ enabled: canEdit, handles: ["se", "e", "s"] as const }), [canEdit]);

  const colWidth = width ? (width - GRID.gutter * (cols - 1)) / cols : 0;
  const cssVars = {
    "--grid-cell-w": `${colWidth + GRID.gutter}px`,
    "--grid-cell-h": `${GRID.rowHeight + GRID.gutter}px`,
    "--grid-gutter": `${GRID.gutter}px`,
  } as CSSProperties;

  const measured = width !== null && tier !== null;

  let body: ReactNode = null;
  if (measured) {
    if (widgets.length === 0 && empty) body = empty;
    else if (tier === "stack") {
      body = (
        <MobileStack
          widgets={widgets}
          renderWidget={(w) => rendered.get(w.id) as WidgetRender}
          onOpen={onOpenConfig}
        />
      );
    } else {
      body = (
        <GridLayout
          width={width}
          layout={rgl}
          gridConfig={gridConfig}
          dragConfig={dragConfig}
          resizeConfig={resizeConfig}
          compactor={verticalCompactor}
          className="report-grid"
          onDragStop={onGridStop}
          onResizeStop={onGridStop}
        >
          {gridChildren}
        </GridLayout>
      );
    }
  }

  return (
    <div
      className={["report-canvas", className].filter(Boolean).join(" ")}
      data-editing={canEdit ? "true" : "false"}
      data-tier={tier ?? "pending"}
    >
      <div ref={wrapRef} className="report-grid-wrap" style={cssVars}>
        {body}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </div>
    </div>
  );
});
