"use client";

/**
 * The visual pieces of the report page that carry no page state of their own:
 * the widget cell (data, loading, error, outdated), the config drawer, the
 * filter region (desktop bar or mobile chip and sheet), the save status and the
 * add-widget button. `ReportClient` owns every decision; these render it.
 *
 * Owner: RS9.
 */

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { WidgetBody } from "@/components/reports/widgets";
import { nameSingleClientRollups } from "@/components/reports/widgets/format";
import type { CaveatTexts, WidgetMetric } from "@/components/reports/widgets";
import { WidgetConfigPanel } from "@/components/reports/pickers/WidgetConfigPanel";
import type { PickerMetric } from "@/components/reports/pickers/MetricPicker";
import { clientSelectionLabel } from "@/components/reports/pickers/ClientPicker";
import { WidgetTypePicker } from "@/components/reports/pickers/WidgetTypePicker";
import { ReportFilterBar } from "@/components/reports/ReportFilterBar";
import type { MetricId } from "@/lib/reports/registry/ids";
import type { ReportClient } from "@/lib/reports/registry/types";
import type { ReportFilters, WidgetConfig, WidgetType } from "@/lib/reports/types";
import type { WidgetState } from "./useWidgetData";

// ---------------------------------------------------------------------------
// Widget cell
// ---------------------------------------------------------------------------

const CHART_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>(["line", "bar", "scatter"]);

export interface WidgetCellProps {
  config: WidgetConfig | null;
  state: WidgetState | undefined;
  widgetMetrics: Partial<Record<MetricId, WidgetMetric>>;
  caveatTexts: CaveatTexts;
  canEdit: boolean;
  /** Refresh was pressed and the new numbers are not requested yet: pulse now. */
  refreshing?: boolean;
  /** Names for a rollup that covers one client (QA N-03). Optional: without it the evaluator's label stands. */
  clients?: ReadonlyArray<{ id: string; name: string }>;
  onRetry(): void;
  onRemove(): void;
  onReset(): void;
}

export function WidgetCell({ config, state, widgetMetrics, caveatTexts, canEdit, refreshing = false, clients, onRetry, onRemove, onReset }: WidgetCellProps) {
  if (!config) {
    return (
      <div role="status" className="flex h-full flex-col items-start justify-center gap-2 text-[13px] text-content-muted">
        <span>Widget outdated</span>
        {canEdit && (
          <span className="flex gap-2">
            <button type="button" onClick={onReset} className="rounded-control border border-hairline-strong px-2.5 py-1 text-[12.5px] text-content-body hover:bg-gray-50">
              Reset
            </button>
            <button type="button" onClick={onRemove} className="rounded-control border border-hairline-strong px-2.5 py-1 text-[12.5px] text-negative-700 hover:bg-negative/10">
              Remove
            </button>
          </span>
        )}
      </div>
    );
  }

  // Returns the same object unless a label changes, so memoised widgets below keep their identity.
  const rawResult = state?.result ?? null;
  const result = rawResult && clients ? nameSingleClientRollups(rawResult, clients) : rawResult;
  const loading = (state?.loading ?? true) || refreshing;
  const error = state?.error ?? null;

  if (error) {
    return (
      <div role="status" className="flex h-full flex-col items-start justify-center gap-1 text-[13px]">
        <span className="text-content-body">{error.message}</span>
        {error.suggestion && <span className="text-[12px] text-content-muted">{error.suggestion}</span>}
        {error.retryable && (
          <button type="button" onClick={onRetry} className="mt-1 rounded-control border border-hairline-strong px-2.5 py-1 text-[12.5px] text-content-body hover:bg-gray-50">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!result) {
    return (
      <div aria-busy="true" aria-label="Loading" className="h-full w-full">
        <Skeleton className="h-full w-full rounded-md" />
      </div>
    );
  }

  const metrics = config.query.metrics.map((id) => widgetMetrics[id]).filter((m): m is WidgetMetric => m !== undefined);

  // A metric was added (or the query changed) and the result on screen predates
  // it: the missing cells are pending, not empty. Tables, KPIs and ranked lists
  // draw a skeleton per cell; a chart has no cell to hold one, so it draws the
  // whole-widget skeleton until the new result lands.
  const awaitingMetric = loading && metrics.some((m) => result.series.some((s) => s.cells[m.id] === undefined));
  if (awaitingMetric && CHART_TYPES.has(config.view.type)) {
    return (
      <div aria-busy="true" aria-label="Loading" className="h-full w-full">
        <Skeleton className="h-full w-full rounded-md" />
      </div>
    );
  }

  // What is on screen answers an older request: dim it harder than a plain
  // refresh so it cannot be read as current while another widget has updated.
  return (
    <div aria-busy={loading} className={`h-full ${loading ? "oe-pulse" : ""} ${loading ? "oe-pulse-stale" : ""}`}>
      <WidgetBody result={result} metrics={metrics} caveatTexts={caveatTexts} view={config.view} pending={loading} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config drawer
// ---------------------------------------------------------------------------

export interface ConfigDrawerProps {
  config: WidgetConfig;
  readOnly: boolean;
  autoFocusMetrics: boolean;
  pickerMetrics: readonly PickerMetric[];
  clients: readonly ReportClient[];
  filters: ReportFilters;
  onChange(next: WidgetConfig): void;
  onClose(): void;
}

/** 360px on the right at lg and up, a bottom sheet below. Not modal at lg: the page stays usable. */
export function ConfigDrawer({ config, readOnly, autoFocusMetrics, pickerMetrics, clients, filters, onChange, onClose }: ConfigDrawerProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!autoFocusMetrics) ref.current?.focus({ preventScroll: true });
  }, [autoFocusMetrics]);

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[79] bg-ink-900/30 lg:hidden" />
      <aside
        ref={ref}
        tabIndex={-1}
        aria-label="Widget"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="fixed inset-x-0 bottom-0 z-[80] flex max-h-[82vh] flex-col overflow-hidden rounded-t-xl border-t border-hairline bg-paper pb-[var(--safe-bottom)] shadow-lg outline-none lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-[var(--header-h)] lg:h-[calc(100vh-var(--header-h))] lg:max-h-none lg:w-[360px] lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-none"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <fieldset disabled={readOnly} className={`m-0 min-w-0 border-0 p-0 ${readOnly ? "opacity-60" : ""}`}>
            <WidgetConfigPanel
              config={config}
              onChange={onChange}
              onClose={onClose}
              metrics={pickerMetrics}
              clients={clients}
              filters={filters}
              autoFocusMetrics={autoFocusMetrics}
            />
          </fieldset>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Filter region
// ---------------------------------------------------------------------------

function subscribeWide(cb: () => void): () => void {
  const q = window.matchMedia("(min-width: 768px)");
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/** Null on the server and during hydration, then true from 768px up. */
function useWide(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeWide,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => null,
  );
}

/** "5 clients, 90d, vs PY, CZK" (design 1.12). */
export function filterSummary(filters: ReportFilters, clients: readonly ReportClient[]): string {
  const period = filters.period.kind === "preset" ? filters.period.preset : "Custom";
  const compare = filters.compare === "previous_year" ? "vs PY" : filters.compare === "previous_period" ? "vs prev" : "No compare";
  const currency = filters.currency === "native" ? "Native" : filters.currency;
  return [clientSelectionLabel(clients, filters.clients), period, compare, currency].join(", ");
}

export interface FilterRegionProps {
  filters: ReportFilters;
  defaults: ReportFilters;
  clients: readonly ReportClient[];
  onSaveDefault?: () => void;
}

/**
 * The filter bar from 768px up; below, one chip that opens a bottom sheet with
 * the same bar. The bar uses `useSearchParams`, so it sits in a Suspense
 * boundary. The shared navigation pending state comes from the app layout's
 * NavigationPendingProvider, which already wraps every page.
 */
export function FilterRegion({ filters, defaults, clients, onSaveDefault }: FilterRegionProps) {
  const wide = useWide();
  const [open, setOpen] = useState(false);

  if (wide === null) return <div className="min-h-[34px]" aria-hidden="true" />;

  const bar = (
    <Suspense fallback={<div className="min-h-[34px]" aria-hidden="true" />}>
      <ReportFilterBar filters={filters} defaults={defaults} clients={clients} onSaveDefault={onSaveDefault} />
    </Suspense>
  );

  if (wide) return bar;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex max-w-full items-center gap-2 rounded-pill border border-hairline-strong bg-paper px-3.5 py-2 text-[12.5px] text-content-strong"
      >
        <span className="truncate">{filterSummary(filters, clients)}</span>
        <span aria-hidden="true" className="text-[9px] text-content-muted">
          ▾
        </span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end bg-ink-900/40" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            className="max-h-[82vh] w-full overflow-y-auto rounded-t-xl bg-paper p-4 pb-[calc(1rem+var(--safe-bottom))] shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-[14px] font-bold tracking-heading text-content-strong">Filters</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] text-content-body">
                Done
              </button>
            </div>
            {bar}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Save status
// ---------------------------------------------------------------------------

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Two words at most, in a live region. */
export function SaveStatus({ state }: { state: SaveState }) {
  const text = state === "saving" ? "Saving" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : "";
  return (
    <span role="status" aria-live="polite" className={`flex-none whitespace-nowrap text-[12px] ${state === "error" ? "text-negative-text" : "text-content-muted"}`}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add widget
// ---------------------------------------------------------------------------

export function AddWidget({ open, onToggle, onPick, onClose }: { open: boolean; onToggle(): void; onPick(type: WidgetType): void; onClose(): void }) {
  return (
    <div className="relative mt-6 flex justify-center">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Add widget"
        title="Add widget (/)"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline-strong bg-paper text-content-body transition-colors duration-fast hover:bg-gray-50"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M7 2v10M2 7h10" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Add widget" className="absolute bottom-[calc(100%+8px)] left-1/2 z-[90] -translate-x-1/2 rounded-lg border border-hairline bg-paper p-2 shadow-lg">
          <WidgetTypePicker autoFocus onPick={onPick} onClose={onClose} label="Widget type" />
        </div>
      )}
    </div>
  );
}

/** A framed message for a page-level state (report not found, nothing to show). */
export function PageNote({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-[13.5px] text-content-muted lg:px-8">{children}</p>;
}
