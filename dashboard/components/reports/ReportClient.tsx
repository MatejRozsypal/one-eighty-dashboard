"use client";

/**
 * The report page's client half (design 1.4, 1.10, 1.11, 3.3): canvas, widgets,
 * config drawer, filter bar, edit and view mode, and every write.
 *
 * ── State, in one place ─────────────────────────────────────────────────────
 * - The server page hands over the stored report once. From then on this
 *   component is the source of truth for what is on screen: widget configs by
 *   id (`entries`), the live layout list (`canvasWidgets`, mirrored from the
 *   canvas), the name, visibility and saved filters.
 * - The URL carries report-level filter overrides (`lib/reports/url.ts`). The
 *   effective filters are the saved ones with the overrides on top; "Save
 *   default" (Cmd/Ctrl+S) writes them and clears the params.
 *
 * ── Writes ──────────────────────────────────────────────────────────────────
 * Every server action goes through ONE queue, in order, each reading the latest
 * version token when it runs. That gives the guarantees the canvas relies on:
 *   - a widget added on screen exists server side before any layout save names
 *     it (the add is queued first, and the id is client chosen);
 *   - undo of a removal re-adds the widget under the same id with its config;
 *   - layout saves only name widgets the server has confirmed.
 * The canvas reports every committed change; `reconcile()` diffs its ids
 * against the ids the server will have (`planned`) and queues the adds and
 * removes. Layout geometry goes through the canvas autosave (800 ms), config
 * edits through their own 800 ms debounce per widget, filters on demand.
 *
 * ── Conflicts ───────────────────────────────────────────────────────────────
 * A version conflict drops everything still queued, refreshes the page data and,
 * when the new server copy arrives, replaces local state with it and remounts
 * the canvas: "Updated by JK, reloaded". Unsaved local edits lose, by design.
 *
 * Owner: RS9.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import {
  addWidget as addWidgetAction,
  deleteReport,
  duplicateReport,
  pinReport,
  refreshReportData,
  removeWidget as removeWidgetAction,
  renameReport,
  saveLayout,
  saveReportFilters,
  setVisibility as setVisibilityAction,
  touchOpened,
  updateWidget as updateWidgetAction,
} from "@/app/(app)/reports/actions";
import { ReportCanvas, type ReportCanvasHandle, type RenderContext } from "@/components/reports/canvas/ReportCanvas";
import type { CanvasWidget } from "@/components/reports/canvas/useGridKeyboard";
import { readingOrder } from "@/components/reports/canvas/useGridKeyboard";
import type { SaveOutcome, AutosaveStatus } from "@/components/reports/canvas/useAutosave";
import type { FrameMenuItem, WidgetRender } from "@/components/reports/canvas/WidgetFrame";
import type { PickerMetric } from "@/components/reports/pickers/MetricPicker";
import { autoTitle, hasFilterOverrides } from "@/components/reports/pickers/WidgetConfigPanel";
import { clientSelectionLabel } from "@/components/reports/pickers/ClientPicker";
import type { CaveatTexts, WidgetMetric } from "@/components/reports/widgets";
import type { ActionResult, ReportMeta, ReportPermissions, StoredWidget } from "@/lib/reports/contracts";
import { AUTOSAVE_DEBOUNCE_MS, MAX_WIDGETS_PER_REPORT } from "@/lib/reports/limits";
import type { MetricId } from "@/lib/reports/registry/ids";
import type { ReportClient as ReportClientT } from "@/lib/reports/registry/types";
import type { LayoutItem, ReportFilters, Visibility, WidgetConfig, WidgetType } from "@/lib/reports/types";
import { FILTER_PARAMS, filtersEqual, parseFilterParams, withOverrides } from "@/lib/reports/url";
import { defaultWidgetConfig, overrideChip } from "@/lib/reports/widgetHelpers";
import { DotsIcon, ICON_BUTTON, PopoverMenu, type MenuEntry } from "./Popover";
import { AddWidget, ConfigDrawer, FilterRegion, SaveStatus, WidgetCell, type SaveState } from "./ReportParts";
import { ReportTitleButton } from "./ReportSwitcher";
import { ShareMenu } from "./ShareMenu";
import { ShortcutSheet } from "./ShortcutSheet";
import { ToastRegion, useToasts } from "./Toasts";
import { ownerInitials } from "./listFormat";
import { useWidgetData, clearWidgetCache } from "./useWidgetData";

// ---------------------------------------------------------------------------
// Props and small helpers
// ---------------------------------------------------------------------------

export interface ReportClientProps {
  report: ReportMeta;
  widgets: StoredWidget[];
  permissions: ReportPermissions;
  pinned: boolean;
  clients: ReportClientT[];
  pickerMetrics: PickerMetric[];
  widgetMetrics: Partial<Record<MetricId, WidgetMetric>>;
  caveatTexts: CaveatTexts;
  /** `?edit=1`: open in edit mode (a report just created or duplicated). */
  initialEdit: boolean;
}

interface Entry {
  type: WidgetType;
  config: WidgetConfig | null;
}

const fromStored = (stored: readonly StoredWidget[]): Record<string, Entry> =>
  Object.fromEntries(stored.map((w) => [w.id, { type: w.type, config: w.config }]));

const toCanvas = (stored: readonly StoredWidget[]): CanvasWidget[] => stored.map((w) => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h }));

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function subscribeDesktop(cb: () => void): () => void {
  const q = window.matchMedia("(min-width: 1200px)");
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/** True from 1200px up (the width editing starts at). False on the server. */
function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia("(min-width: 1200px)").matches,
    () => false,
  );
}

type Result = ActionResult<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportClient(props: ReportClientProps) {
  const { report, widgets: stored, permissions, clients, pickerMetrics, widgetMetrics, caveatTexts } = props;
  const reportId = report.id;
  const canEdit = permissions.canEdit;

  // `router` is for quiet refreshes after an optimistic edit (the screen already
  // shows the new state). Anything that moves the user, or reloads what they are
  // looking at, goes through the shared navigation so the page pulses at once.
  const router = useRouter();
  const { navigate, refresh: refreshPage } = useNavigation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toasts = useToasts();
  const pushToast = toasts.push;
  const desktop = useDesktop();

  // ---- identity and server copy -------------------------------------------
  const [name, setName] = useState(report.name);
  const [visibility, setVisibility] = useState<Visibility>(report.visibility);
  const [savedFilters, setSavedFilters] = useState<ReportFilters>(report.filters);
  const [pinned, setPinned] = useState(props.pinned);
  const [renaming, setRenaming] = useState(false);

  // ---- widgets ------------------------------------------------------------
  const [entries, setEntriesState] = useState<Record<string, Entry>>(() => fromStored(stored));
  const entriesRef = useRef(entries);
  const setEntries = useCallback((update: (prev: Record<string, Entry>) => Record<string, Entry>) => {
    entriesRef.current = update(entriesRef.current);
    setEntriesState(entriesRef.current);
  }, []);

  const [seed, setSeed] = useState<CanvasWidget[]>(() => toCanvas(stored));
  const [canvasWidgets, setCanvasWidgets] = useState<CanvasWidget[]>(seed);
  const canvasRef = useRef(canvasWidgets);
  canvasRef.current = canvasWidgets;
  const handle = useRef<ReportCanvasHandle>(null);
  const [epoch, setEpoch] = useState(0);

  // ---- view state ---------------------------------------------------------
  const [mode, setMode] = useState<"view" | "edit">(props.initialEdit && canEdit ? "edit" : "view");
  const editing = mode === "edit" && canEdit && desktop;
  const [drawer, setDrawer] = useState<{ id: string; added: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // ---- write queue --------------------------------------------------------
  const versionRef = useRef(report.version);
  const planned = useRef(new Set(stored.map((w) => w.id)));
  const persisted = useRef(new Set(stored.map((w) => w.id)));
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const [pending, setPending] = useState(0);
  const [canvasStatus, setCanvasStatus] = useState<AutosaveStatus>("idle");
  const [configTimers, setConfigTimers] = useState(0);
  const [opFailed, setOpFailed] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastErrorToast = useRef(0);
  const reload = useRef<{ minVersion: number } | null>(null);
  const silentRemove = useRef(new Set<string>());

  // ---- filters ------------------------------------------------------------
  const queryString = searchParams.toString();
  const overrides = useMemo(() => parseFilterParams(queryString).overrides, [queryString]);
  const effective = useMemo(() => withOverrides(savedFilters, overrides), [savedFilters, overrides]);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  // =========================================================================
  // Queue
  // =========================================================================

  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 2500);
  }, []);

  const startReload = useCallback(
    (serverVersion?: number) => {
      if (reload.current) return;
      reload.current = { minVersion: serverVersion ?? 0 };
      generation.current += 1;
      refreshPage();
    },
    [refreshPage],
  );

  const afterResult = useCallback(
    (res: Result) => {
      if (res.ok) {
        if (res.version > 0) versionRef.current = res.version;
        setOpFailed(false);
        flashSaved();
        return;
      }
      if (res.code === "conflict") {
        startReload(res.version);
        return;
      }
      setOpFailed(true);
      const now = Date.now();
      if (now - lastErrorToast.current > 4000) {
        lastErrorToast.current = now;
        pushToast({ text: res.code === "forbidden" ? "Read only" : "Could not save", tone: "error" });
      }
    },
    [flashSaved, startReload, pushToast],
  );

  const enqueue = useCallback(
    (op: () => Promise<Result>): Promise<Result | null> => {
      const gen = generation.current;
      setPending((n) => n + 1);
      const task: Promise<Result | null> = chain.current.then(async () => {
        if (gen !== generation.current) return null;
        try {
          const res = await op();
          afterResult(res);
          return res;
        } catch {
          // The gate threw (signed out, role revoked): the layout will redirect on refresh.
          setOpFailed(true);
          refreshPage();
          return { ok: false, code: "invalid" } as Result;
        }
      });
      chain.current = task.then(
        () => undefined,
        () => undefined,
      );
      void task.finally(() => setPending((n) => n - 1));
      return task;
    },
    [afterResult, refreshPage],
  );

  // =========================================================================
  // Widgets: add, remove, config
  // =========================================================================

  const queueAdd = useCallback(
    (w: CanvasWidget) => {
      void enqueue(async () => {
        const entry = entriesRef.current[w.id];
        if (!entry?.config) return { ok: false, code: "invalid" } as Result;
        const res = await addWidgetAction(reportId, versionRef.current, { id: w.id, type: entry.config.view.type, config: entry.config, x: w.x, y: w.y, w: w.w, h: w.h });
        if (res.ok) persisted.current.add(w.id);
        else if (res.code !== "conflict") {
          // The server refused this widget (limit, invalid): take it off the canvas again.
          planned.current.delete(w.id);
          silentRemove.current.add(w.id);
          handle.current?.remove(w.id);
        }
        return res as Result;
      });
    },
    [enqueue, reportId],
  );

  const queueRemove = useCallback(
    (id: string) => {
      void enqueue(async () => {
        if (!persisted.current.has(id)) return { ok: true, version: 0 } as Result;
        const res = await removeWidgetAction(reportId, versionRef.current, id);
        if (res.ok) persisted.current.delete(id);
        return res as Result;
      });
    },
    [enqueue, reportId],
  );

  /** The canvas committed a change: queue the adds and removes the server is missing. */
  const reconcile = useCallback(
    (next: CanvasWidget[]) => {
      setCanvasWidgets(next);
      if (!canEdit) return;
      const ids = new Set(next.map((w) => w.id));
      for (const w of next) {
        if (!planned.current.has(w.id)) {
          planned.current.add(w.id);
          queueAdd(w);
        }
      }
      for (const id of [...planned.current]) {
        if (!ids.has(id)) {
          planned.current.delete(id);
          queueRemove(id);
        }
      }
    },
    [canEdit, queueAdd, queueRemove],
  );

  // Per-widget config saves, debounced like the layout.
  const configTimer = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const syncTimerCount = useCallback(() => setConfigTimers(configTimer.current.size), []);

  const persistConfig = useCallback(
    (id: string) => {
      configTimer.current.delete(id);
      syncTimerCount();
      if (!planned.current.has(id)) return;
      void enqueue(async () => {
        const config = entriesRef.current[id]?.config;
        if (!config || !persisted.current.has(id)) return { ok: true, version: 0 } as Result;
        return (await updateWidgetAction(reportId, versionRef.current, id, config)) as Result;
      });
    },
    [enqueue, reportId, syncTimerCount],
  );

  const scheduleConfig = useCallback(
    (id: string) => {
      const existing = configTimer.current.get(id);
      if (existing) clearTimeout(existing);
      configTimer.current.set(id, setTimeout(() => persistConfig(id), AUTOSAVE_DEBOUNCE_MS));
      syncTimerCount();
    },
    [persistConfig, syncTimerCount],
  );

  const flushConfigs = useCallback(() => {
    for (const [id, t] of [...configTimer.current]) {
      clearTimeout(t);
      persistConfig(id);
    }
  }, [persistConfig]);

  const commitConfig = useCallback(
    (id: string, next: WidgetConfig) => {
      const prev = entriesRef.current[id];
      if (!prev) return;
      setEntries((all) => ({ ...all, [id]: { type: next.view.type, config: next } }));
      if (prev.type !== next.view.type) handle.current?.retype(id, next.view.type);
      if (canEdit) scheduleConfig(id);
    },
    [canEdit, scheduleConfig, setEntries],
  );

  // =========================================================================
  // Canvas wiring
  // =========================================================================

  const onSaveLayout = useCallback(
    async (items: LayoutItem[]): Promise<SaveOutcome> => {
      const res = await enqueue(async () => {
        const known = items.filter((i) => persisted.current.has(i.id));
        if (known.length === 0) return { ok: true, version: 0 } as Result;
        return (await saveLayout(reportId, versionRef.current, known)) as Result;
      });
      return { ok: res === null ? true : res.ok };
    },
    [enqueue, reportId],
  );

  const onDuplicate = useCallback(
    (sourceId: string, newId: string) => {
      setEntries((all) => (all[sourceId] ? { ...all, [newId]: { ...all[sourceId] } } : all));
    },
    [setEntries],
  );

  const onRemove = useCallback(
    (id: string) => {
      setDrawer((d) => (d?.id === id ? null : d));
      if (silentRemove.current.delete(id)) return;
      pushToast({ text: "Widget removed", action: { label: "Undo", run: () => handle.current?.undo() } });
    },
    [pushToast],
  );

  const openConfig = useCallback((id: string) => {
    if (!entriesRef.current[id]?.config) return;
    setAddOpen(false);
    setDrawer({ id, added: false });
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawer((d) => {
      if (d) requestAnimationFrame(() => handle.current?.focus(d.id));
      return null;
    });
  }, []);

  const addOfType = useCallback(
    (type: WidgetType) => {
      if (!canEdit) return;
      setAddOpen(false);
      if (canvasRef.current.length >= MAX_WIDGETS_PER_REPORT) {
        pushToast({ text: "Widget limit reached", tone: "error" });
        return;
      }
      const id = crypto.randomUUID();
      setEntries((all) => ({ ...all, [id]: { type, config: defaultWidgetConfig(type, pickerMetrics) } }));
      handle.current?.add(id, type);
      // The canvas focuses the new card a pass after it commits; open the drawer
      // just after, so focus ends in its metric picker rather than on the card.
      window.setTimeout(() => setDrawer({ id, added: true }), 80);
    },
    [canEdit, pickerMetrics, setEntries, pushToast],
  );

  const clearOverrides = useCallback(
    (id: string) => {
      const config = entriesRef.current[id]?.config;
      if (!config) return;
      const { clients: _c, period: _p, compare: _m, currency: _u, ...rest } = config.query.overrides;
      void _c;
      void _p;
      void _m;
      void _u;
      commitConfig(id, { ...config, query: { ...config.query, overrides: rest } });
    },
    [commitConfig],
  );

  const resetWidget = useCallback(
    (id: string) => {
      const entry = entriesRef.current[id];
      if (!entry) return;
      const config = defaultWidgetConfig(entry.type, pickerMetrics);
      setEntries((all) => ({ ...all, [id]: { type: config.view.type, config } }));
      if (entry.type !== config.view.type) handle.current?.retype(id, config.view.type);
      if (canEdit) {
        void enqueue(async () => {
          if (!persisted.current.has(id)) return { ok: true, version: 0 } as Result;
          return (await updateWidgetAction(reportId, versionRef.current, id, config)) as Result;
        });
      }
    },
    [canEdit, enqueue, pickerMetrics, reportId, setEntries],
  );

  // =========================================================================
  // Data
  // =========================================================================

  const dataWidgets = useMemo(
    () => readingOrder(canvasWidgets).map((w) => ({ id: w.id, config: entries[w.id]?.config ?? null })),
    [canvasWidgets, entries],
  );
  const { data, retry } = useWidgetData({ reportId, filters: effective, widgets: dataWidgets, refreshNonce });

  const clientsLabel = useCallback((sel: ReportFilters["clients"]) => clientSelectionLabel(clients, sel), [clients]);

  const renderWidget = (w: CanvasWidget, ctx: RenderContext): WidgetRender => {
    const config = entries[w.id]?.config ?? null;
    const menu: FrameMenuItem[] = [];
    if (config && ctx.editing && hasFilterOverrides(config)) {
      menu.push({ id: "use-report-filters", label: "Use report filters", onSelect: () => clearOverrides(w.id) });
    }
    return {
      title: config ? config.view.title?.trim() || autoTitle(config, pickerMetrics) : "Widget",
      chip: config ? overrideChip(config, clientsLabel) || undefined : undefined,
      menu,
      body: (
        <WidgetCell
          config={config}
          state={data[w.id]}
          widgetMetrics={widgetMetrics}
          caveatTexts={caveatTexts}
          canEdit={ctx.editing}
          refreshing={refreshing}
          onRetry={() => retry(w.id)}
          onRemove={() => handle.current?.remove(w.id)}
          onReset={() => resetWidget(w.id)}
        />
      ),
    };
  };

  // =========================================================================
  // Report-level actions
  // =========================================================================

  const saveDefault = useCallback(() => {
    if (!canEdit) return;
    const next = effectiveRef.current;
    if (filtersEqual(next, savedFilters)) return;
    void enqueue(() => saveReportFilters(reportId, versionRef.current, next) as Promise<Result>).then((res) => {
      if (!res?.ok) return;
      setSavedFilters(next);
      const params = new URLSearchParams(window.location.search);
      for (const key of FILTER_PARAMS) params.delete(key);
      const qs = params.toString();
      navigate(qs ? `${pathname}?${qs}` : pathname, { replace: true, scroll: false });
      refreshPage();
    });
  }, [canEdit, enqueue, navigate, pathname, refreshPage, reportId, savedFilters]);

  const rename = useCallback(
    (next: string) => {
      setRenaming(false);
      const value = next.trim();
      if (!value || value === name) return;
      setName(value);
      void enqueue(() => renameReport(reportId, value) as Promise<Result>).then((res) => res?.ok && router.refresh());
    },
    [enqueue, name, reportId, router],
  );

  const changeVisibility = useCallback(
    (next: Visibility) => {
      setVisibility(next);
      void enqueue(() => setVisibilityAction(reportId, next) as Promise<Result>).then((res) => res?.ok && router.refresh());
    },
    [enqueue, reportId, router],
  );

  const togglePin = useCallback(async () => {
    const next = !pinned;
    setPinned(next);
    const res = await pinReport(reportId, next);
    if (!res.ok) setPinned(!next);
    else router.refresh();
  }, [pinned, reportId, router]);

  const duplicate = useCallback(async () => {
    // A copy carries what is saved, so flush pending edits first.
    flushConfigs();
    await handle.current?.flush();
    const res = await duplicateReport(reportId);
    if (!res.ok) return pushToast({ text: "Could not save", tone: "error" });
    navigate(`/reports/${res.id}?edit=1`);
  }, [flushConfigs, navigate, reportId, pushToast]);

  const remove = useCallback(async () => {
    const res = await deleteReport(reportId);
    if (!res.ok) return pushToast({ text: "Could not delete", tone: "error" });
    navigate(`/reports?deleted=${reportId}`);
  }, [navigate, reportId, pushToast]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshReportData();
    } catch {
      /* Rate limited or refused: refetch anyway, it just may hit the cache. */
    }
    clearWidgetCache();
    setRefreshNonce((n) => n + 1);
    setRefreshing(false);
  }, []);

  // =========================================================================
  // Effects
  // =========================================================================

  // Opened: one audit row, once per mount.
  useEffect(() => {
    void touchOpened(reportId).catch(() => undefined);
  }, [reportId]);

  // The new server copy after a conflict.
  useEffect(() => {
    const r = reload.current;
    if (!r || report.version < r.minVersion) return;
    reload.current = null;
    for (const t of configTimer.current.values()) clearTimeout(t);
    configTimer.current.clear();
    setConfigTimers(0);
    versionRef.current = report.version;
    planned.current = new Set(stored.map((w) => w.id));
    persisted.current = new Set(stored.map((w) => w.id));
    const nextEntries = fromStored(stored);
    entriesRef.current = nextEntries;
    setEntriesState(nextEntries);
    const nextSeed = toCanvas(stored);
    setSeed(nextSeed);
    setCanvasWidgets(nextSeed);
    setName(report.name);
    setVisibility(report.visibility);
    setSavedFilters(report.filters);
    setDrawer(null);
    setOpFailed(false);
    setEpoch((n) => n + 1);
    pushToast({ text: `Updated by ${ownerInitials(report.updatedBy)}, reloaded` });
  }, [report, stored, pushToast]);

  // Flush config edits when the tab hides or the page goes away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushConfigs();
    };
    window.addEventListener("pagehide", flushConfigs);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushConfigs);
      document.removeEventListener("visibilitychange", onHide);
      flushConfigs();
    };
  }, [flushConfigs]);

  // Global keys (design 1.11). Cmd/Ctrl+K lives in ReportSwitcher, Cmd/Ctrl+Z and
  // widget keys in the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the drawer or the add popover wherever focus is. Overlays that
      // own their Esc (palette, menus, sheets) stop it before it gets here.
      if (e.key === "Escape" && !e.defaultPrevented && !shortcuts) {
        if (drawer) closeDrawer();
        else if (addOpen) setAddOpen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || shortcuts) return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcuts(true);
      } else if (e.key === "/" || e.key === "n" || e.key === "N") {
        if (!canEdit || !desktop) return;
        e.preventDefault();
        setMode("edit");
        setAddOpen(true);
      } else if (e.key === "e" || e.key === "E") {
        if (!canEdit || !desktop) return;
        e.preventDefault();
        setMode((m) => (m === "edit" ? "view" : "edit"));
        setAddOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen, canEdit, closeDrawer, desktop, drawer, saveDefault, shortcuts]);

  // =========================================================================
  // Render
  // =========================================================================

  const saveState: SaveState = opFailed || canvasStatus === "error"
    ? "error"
    : pending > 0 || configTimers > 0 || canvasStatus === "dirty" || canvasStatus === "saving"
      ? "saving"
      : justSaved
        ? "saved"
        : "idle";

  const drawerEntry = drawer ? entries[drawer.id] : undefined;
  const drawerOpen = Boolean(drawer && drawerEntry?.config);

  const menuEntries: MenuEntry[] = [
    { kind: "item", id: "duplicate", label: "Duplicate", onSelect: () => void duplicate() },
    { kind: "item", id: "rename", label: "Rename", disabled: !canEdit, hint: canEdit ? undefined : "Read only", onSelect: () => setRenaming(true) },
    { kind: "item", id: "pin", label: pinned ? "Unpin" : "Pin", onSelect: () => void togglePin() },
    ...(permissions.isOwner ? ([{ kind: "separator" }, { kind: "item", id: "delete", label: "Delete", danger: true, onSelect: () => void remove() }] as MenuEntry[]) : []),
  ];

  return (
    <>
      <header className="flex min-h-[var(--header-h)] flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-paper px-5 py-2 lg:sticky lg:top-0 lg:z-30 lg:flex-nowrap lg:px-8 lg:pr-[var(--account-reserve)] lg:pt-[calc(0.5rem+var(--safe-top))]">
        <div className="w-full min-w-0 lg:w-auto lg:max-w-[40%] lg:shrink">
          {renaming ? (
            <TitleInput initial={name} onDone={rename} onCancel={() => setRenaming(false)} />
          ) : (
            <ReportTitleButton name={name} />
          )}
        </div>
        <SaveStatus state={saveState} />
        {!canEdit && <span className="flex-none whitespace-nowrap text-[12px] text-content-muted">Read only</span>}

        <div className="ml-auto flex flex-none items-center gap-2">
          {canEdit && desktop && (
            <div role="group" aria-label="Mode" className="inline-flex rounded-pill border border-hairline-strong bg-paper p-0.5">
              {(["view", "edit"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setAddOpen(false);
                  }}
                  className={`rounded-pill px-3 py-1 text-[12.5px] transition-colors duration-fast ${
                    mode === m ? "bg-ink-900 text-content-inverse" : "text-content-body hover:bg-gray-100"
                  }`}
                >
                  {m === "view" ? "View" : "Edit"}
                </button>
              ))}
            </div>
          )}
          <ShareMenu visibility={visibility} isOwner={permissions.isOwner} onChange={changeVisibility} />
          <button
            type="button"
            onClick={() => void refresh()}
            aria-busy={refreshing}
            disabled={refreshing}
            className={`rounded-control border border-hairline-strong bg-paper px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50 ${refreshing ? "oe-pulse" : ""}`}
          >
            Refresh
          </button>
          <PopoverMenu label="Report actions" align="right" buttonClassName={ICON_BUTTON} button={<DotsIcon />} entries={menuEntries} />
        </div>
      </header>

      <div className={`z-20 border-b border-hairline bg-paper px-5 py-2 transition-[padding] duration-base lg:sticky lg:top-[var(--header-h)] lg:px-8 ${drawerOpen ? "lg:pr-[392px]" : ""}`}>
        <FilterRegion filters={effective} defaults={savedFilters} clients={clients} onSaveDefault={canEdit ? saveDefault : undefined} />
      </div>

      <main className={`min-w-0 px-5 pb-14 pt-5 transition-[padding] duration-base lg:px-8 ${drawerOpen ? "lg:pr-[392px]" : ""}`}>
        <ReportCanvas
          key={`${reportId}:${epoch}`}
          ref={handle}
          widgets={seed}
          mode={editing ? "edit" : "view"}
          renderWidget={renderWidget}
          onSave={canEdit ? onSaveLayout : undefined}
          onSaveStatus={setCanvasStatus}
          onWidgetsChange={reconcile}
          onOpenConfig={openConfig}
          onDuplicate={canEdit ? onDuplicate : undefined}
          onRemove={onRemove}
          empty={<p className="py-6 text-[13.5px] text-content-muted">No widgets.</p>}
        />
        {editing && <AddWidget open={addOpen} onToggle={() => setAddOpen((o) => !o)} onPick={addOfType} onClose={() => setAddOpen(false)} />}
      </main>

      {drawer && drawerEntry?.config && (
        <ConfigDrawer
          key={drawer.id}
          config={drawerEntry.config}
          readOnly={!editing}
          autoFocusMetrics={drawer.added}
          pickerMetrics={pickerMetrics}
          clients={clients}
          filters={effective}
          onChange={(next) => commitConfig(drawer.id, next)}
          onClose={closeDrawer}
        />
      )}

      <ShortcutSheet open={shortcuts} onClose={() => setShortcuts(false)} />
      <ToastRegion toasts={toasts} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Title rename
// ---------------------------------------------------------------------------

function TitleInput({ initial, onDone, onCancel }: { initial: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      maxLength={120}
      aria-label="Report name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="w-full min-w-[200px] rounded-control border border-ink-900 bg-paper px-2 py-1 text-[17px] font-bold tracking-heading text-content-strong outline-none"
    />
  );
}
