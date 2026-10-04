"use client";

/**
 * Widget config panel: the content of the config drawer (design 1.6). The
 * drawer chrome (360px on the right, a bottom sheet on mobile, focus trap,
 * open and close) belongs to the page; this is a controlled form.
 *
 *   Type     [KPI][Line][Bar][Table][Ranked][Scatter]
 *   Metrics  [MER x] [CAC x]  Search metrics            (scatter: X, Y, Size)
 *   Split    (By client)(Combined)(By vertical)
 *   Grain    (Day)(Week)(Month)(Total)                  (hidden for KPI)
 *   Filters  [x] Use report filters   -> clients, period, compare, currency
 *   Industry [ ]
 *   Title    [auto: MER, CAC]
 *   Ranked: Sort, Limit.  Bar: Stacked.
 *
 * Every change builds a complete `WidgetConfig`, checks it with the zod schema
 * and calls `onChange`; a config that would be invalid is never emitted. Which
 * edits need a refetch is decided by the caller from the config (title, sort,
 * limit and stacked live in `view`; the rest changes `query`).
 *
 * Rules the panel adds on top of the schema:
 * - Changing the type reshapes the config: ranked keeps one metric, scatter gets
 *   X and Y (a second metric is added when only one is selected), KPI, ranked
 *   and scatter use grain total, a line never uses total, and ranked and
 *   scatter never use the combined split (one row or one point is not a chart).
 * - "Use report filters" clears the overrides of clients, period, compare and
 *   currency. With it off, each of those controls edits its own override, and
 *   an override equal to the report value is removed again. Industry is its own
 *   row because the benchmark switch is allowed to differ per widget.
 *
 * Props, in short:
 *   config, onChange   the widget config (controlled)
 *   metrics            `PickerMetric[]`, built from the registry (see MetricPicker)
 *   clients            all active clients (`getReportClients()`)
 *   filters            the report's effective filters, URL overrides applied
 *   onClose            Esc and the close button
 *   autoFocusMetrics   focus the metric picker on mount (a widget was just added)
 *
 * Owner: RS8.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MetricId } from "@/lib/reports/registry/ids";
import type { ReportClient } from "@/lib/reports/registry/types";
import { MAX_RANKED_LIMIT, MAX_WIDGET_TITLE } from "@/lib/reports/limits";
import {
  COMPARE_MODES,
  REPORT_PRESETS,
  WidgetConfig,
  type ReportCurrency,
  type ReportFilters,
  type WidgetSplit,
  type WidgetType,
} from "@/lib/reports/types";
import { addDays, PRESET_LABELS, presetRange, todayUtc, type PresetKey } from "@/lib/period";
import { filtersEqual, type FilterKey } from "@/lib/reports/url";
import { ClientPicker, selectedClients } from "./ClientPicker";
import { MetricPicker, type PickerMetric } from "./MetricPicker";
import { WidgetTypePicker } from "./WidgetTypePicker";

// ---------------------------------------------------------------------------
// Config reshaping (pure, exported for the page and for tests)
// ---------------------------------------------------------------------------

type Grain = WidgetConfig["query"]["grain"];

function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

/** Change the widget type and fix everything the new type does not allow. */
export function changeWidgetType(config: WidgetConfig, type: WidgetType, pool: readonly PickerMetric[] = []): WidgetConfig {
  const prev = config.view;
  let metrics = [...config.query.metrics];
  let grain: Grain = config.query.grain;
  let split: WidgetSplit = config.query.split;
  const view: WidgetConfig["view"] = { type };
  if (prev.title) view.title = prev.title;

  // A KPI tile shows one figure: the first metric (it used to accept several
  // and draw only the first, under a title naming all of them).
  if (type === "kpi") metrics = metrics.slice(0, 1);
  if (type === "ranked") {
    metrics = metrics.slice(0, 1);
    view.sort = prev.sort ?? "desc";
    view.limit = prev.limit ?? 10;
  }
  if (type === "scatter") {
    if (metrics.length < 2) {
      const extra = pool.find((m) => !metrics.includes(m.id));
      if (extra) metrics.push(extra.id);
    }
    const [x, y = metrics[0], size] = metrics;
    metrics = unique([x, y, ...(size ? [size] : [])]);
    view.scatter = { x, y, ...(size ? { size } : {}) };
  }
  if (type === "bar" && prev.stacked !== undefined) view.stacked = prev.stacked;
  if (type === "table" && prev.sort) view.sort = prev.sort;

  if (type === "kpi" || type === "ranked" || type === "scatter") grain = "total";
  if (type === "line" && grain === "total") grain = "week";
  if ((type === "ranked" || type === "scatter") && split === "combined") split = "client";

  return { ...config, query: { ...config.query, metrics, grain, split }, view };
}

/** Title shown as the placeholder: the metric labels. */
export function autoTitle(config: WidgetConfig, pool: readonly PickerMetric[]): string {
  const label = (id: MetricId) => pool.find((m) => m.id === id)?.label ?? id;
  const s = config.view.scatter;
  const ids =
    config.view.type === "scatter" && s
      ? unique([s.x, s.y, ...(s.size ? [s.size] : [])])
      : config.view.type === "kpi"
        ? config.query.metrics.slice(0, 1)
        : config.query.metrics;
  return ids.map(label).join(", ");
}

/** True when any of clients, period, compare or currency is overridden. */
export function hasFilterOverrides(config: WidgetConfig): boolean {
  const o = config.query.overrides;
  return o.clients !== undefined || o.period !== undefined || o.compare !== undefined || o.currency !== undefined;
}

// ---------------------------------------------------------------------------
// Small form pieces
// ---------------------------------------------------------------------------

const INPUT =
  "rounded-control border border-hairline-strong bg-paper px-2.5 py-[7px] text-[13px] text-content-strong outline-none focus:border-ink-900 disabled:cursor-not-allowed disabled:opacity-50";

function Field({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

interface PillOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  hint?: string;
}

function Pills<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly PillOption<T>[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-pill bg-gray-100 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-pill px-2 py-1.5 font-mono text-[11px] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
            o.value === value ? "bg-paper text-content-strong shadow-sm" : "text-content-muted hover:text-content-body"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={hint}
      onClick={() => onChange(!checked)}
      className={`relative h-[20px] w-[36px] shrink-0 rounded-pill transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-gray-200"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-paper shadow-sm transition-all duration-fast ${
          checked ? "left-[18px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

/** One overridable filter row: label, the control, and a reset when it is overridden. */
function OverrideRow({
  label,
  overridden,
  onReset,
  children,
}: {
  label: string;
  overridden: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[12px] text-content-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        aria-label={`Use report ${label.toLowerCase()}`}
        title="Use report value"
        disabled={!overridden}
        onClick={onReset}
        className="rounded-full px-1.5 text-content-muted transition-colors duration-fast hover:text-content-strong disabled:invisible"
      >
        <span aria-hidden="true">{"×"}</span>
      </button>
    </div>
  );
}

function PeriodControl({
  value,
  onChange,
}: {
  value: ReportFilters["period"];
  onChange: (next: ReportFilters["period"]) => void;
}) {
  const yesterday = addDays(todayUtc(), -1);
  const seed = value.kind === "custom" ? value : presetRange(value.preset);
  const [from, setFrom] = useState(seed.from);
  const [to, setTo] = useState(seed.to);
  useEffect(() => {
    if (value.kind === "custom") {
      setFrom(value.from);
      setTo(value.to);
    }
  }, [value]);

  function tryCustom(f: string, t: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t) && f <= t) {
      onChange({ kind: "custom", from: f, to: t });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="Period"
        value={value.kind === "custom" ? "custom" : value.preset}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") tryCustom(from, to);
          else onChange({ kind: "preset", preset: v as (typeof REPORT_PRESETS)[number] });
        }}
        className={INPUT}
      >
        {REPORT_PRESETS.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABELS[p as PresetKey]}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>
      {value.kind === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="From"
            value={from}
            max={yesterday}
            onChange={(e) => {
              setFrom(e.target.value);
              tryCustom(e.target.value, to);
            }}
            className={`${INPUT} min-w-0 flex-1 font-mono text-[12px]`}
          />
          <span aria-hidden="true" className="text-content-muted">
            to
          </span>
          <input
            type="date"
            aria-label="To"
            value={to}
            max={yesterday}
            onChange={(e) => {
              setTo(e.target.value);
              tryCustom(from, e.target.value);
            }}
            className={`${INPUT} min-w-0 flex-1 font-mono text-[12px]`}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const SPLITS: ReadonlyArray<PillOption<WidgetSplit>> = [
  { value: "client", label: "By client" },
  { value: "combined", label: "Combined" },
  { value: "vertical", label: "By vertical" },
];

const GRAINS: ReadonlyArray<PillOption<Grain>> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "total", label: "Total" },
];

const COMPARE_LABEL: Record<(typeof COMPARE_MODES)[number], string> = {
  previous_period: "Prev period",
  previous_year: "Prev year",
  none: "None",
};

export interface WidgetConfigPanelProps {
  config: WidgetConfig;
  onChange: (next: WidgetConfig) => void;
  onClose?: () => void;
  metrics: readonly PickerMetric[];
  clients: readonly ReportClient[];
  /** The report's effective filters, URL overrides applied. */
  filters: ReportFilters;
  autoFocusMetrics?: boolean;
}

export function WidgetConfigPanel({ config, onChange, onClose, metrics, clients, filters, autoFocusMetrics = false }: WidgetConfigPanelProps) {
  const baseId = useId();
  const { query, view } = config;
  const type = view.type;
  const overrides = query.overrides;
  const firstType = useRef(type);

  const [customizing, setCustomizing] = useState(() => hasFilterOverrides(config));
  const [limitText, setLimitText] = useState(String(view.limit ?? 10));
  useEffect(() => setLimitText(String(view.limit ?? 10)), [view.limit]);

  function emit(next: WidgetConfig) {
    const parsed = WidgetConfig.safeParse(next);
    if (parsed.success) onChange(parsed.data);
  }

  function setQuery(patch: Partial<WidgetConfig["query"]>) {
    emit({ ...config, query: { ...query, ...patch } });
  }
  function setView(patch: Partial<WidgetConfig["view"]>) {
    const next = { ...view, ...patch };
    for (const k of Object.keys(next) as Array<keyof typeof next>) if (next[k] === undefined) delete next[k];
    emit({ ...config, view: next });
  }

  /** Set or clear one override. A value equal to the report's is cleared. */
  function setOverride<K extends FilterKey>(key: K, value: ReportFilters[K] | undefined) {
    const next = { ...overrides };
    if (value === undefined || filtersEqual({ [key]: value }, { [key]: filters[key] })) delete next[key];
    else next[key] = value;
    setQuery({ overrides: next });
  }

  // The clients the widget will query: its own override, else the report's.
  const effectiveClients = useMemo(
    () => selectedClients(clients, overrides.clients ?? filters.clients),
    [clients, overrides.clients, filters.clients]
  );
  const mixedCurrencies = new Set(effectiveClients.map((c) => c.currency)).size > 1;
  const sharedCurrency = effectiveClients[0]?.currency;

  const scatter = view.scatter;
  const metricIds: MetricId[] = type === "scatter" && scatter ? unique([scatter.x, scatter.y, ...(scatter.size ? [scatter.size] : [])]) : query.metrics;
  const anyBenchmarkable = metricIds.some((id) => metrics.find((m) => m.id === id)?.benchmarkable);
  const benchmarkOn = overrides.benchmark ?? filters.benchmark;

  function setScatterSlot(slot: "x" | "y" | "size", id: MetricId | undefined) {
    const cur = scatter ?? { x: query.metrics[0], y: query.metrics[1] ?? query.metrics[0] };
    const next = { ...cur, [slot]: id };
    if (next.size === undefined) delete next.size;
    emit({
      ...config,
      query: { ...query, metrics: unique([next.x, next.y, ...(next.size ? [next.size] : [])]) },
      view: { ...view, scatter: next },
    });
  }

  const splitOptions = SPLITS.map((o) =>
    o.value === "combined" && (type === "ranked" || type === "scatter")
      ? { ...o, disabled: true, hint: "Needs more than one row" }
      : o
  );
  const grainOptions = GRAINS.map((o) =>
    o.value === "total" && type === "line" ? { ...o, disabled: true, hint: "Needs a time grain" } : o
  );

  const currencyOptions: ReadonlyArray<PillOption<ReportCurrency>> = [
    { value: "CZK", label: "CZK" },
    { value: "EUR", label: "EUR" },
    { value: "USD", label: "USD" },
    {
      value: "native",
      label: "Native",
      disabled: mixedCurrencies,
      hint: mixedCurrencies ? "Mixed currencies" : sharedCurrency,
    },
  ];

  return (
    <section
      aria-label="Widget settings"
      onKeyDown={(e) => {
        // The metric list closes itself and lets this press through, so one Esc
        // closes the list and the inspector together.
        if (e.key === "Escape" && onClose) {
          e.preventDefault();
          onClose();
        }
      }}
      className="flex flex-col gap-4 p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-content-strong">Widget</h2>
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full px-2 py-0.5 text-[16px] text-content-muted transition-colors duration-fast hover:text-content-strong"
          >
            <span aria-hidden="true">{"×"}</span>
          </button>
        )}
      </div>

      <Field label="Type">
        <WidgetTypePicker
          layout="row"
          value={type}
          onPick={(t) => {
            if (t !== type) emit(changeWidgetType(config, t, metrics));
          }}
        />
      </Field>

      {type === "scatter" ? (
        <>
          <Field label="X">
            <MetricPicker
              mode="single"
              label="X metric"
              metrics={metrics}
              clients={effectiveClients}
              selected={scatter ? [scatter.x] : []}
              onChange={([id]) => id && setScatterSlot("x", id)}
              autoFocus={autoFocusMetrics}
            />
          </Field>
          <Field label="Y">
            <MetricPicker
              mode="single"
              label="Y metric"
              metrics={metrics}
              clients={effectiveClients}
              selected={scatter ? [scatter.y] : []}
              onChange={([id]) => id && setScatterSlot("y", id)}
            />
          </Field>
          <Field label="Size">
            <MetricPicker
              mode="single"
              clearable
              label="Size metric"
              placeholder="Optional"
              metrics={metrics}
              clients={effectiveClients}
              selected={scatter?.size ? [scatter.size] : []}
              onChange={([id]) => setScatterSlot("size", id)}
            />
          </Field>
        </>
      ) : (
        <Field label="Metrics">
          <MetricPicker
            // A new type starts with an empty search box.
            key={type}
            mode={type === "ranked" || type === "kpi" ? "single" : "multi"}
            min={1}
            label="Metrics"
            metrics={metrics}
            clients={effectiveClients}
            selected={query.metrics}
            onChange={(ids) => ids.length > 0 && setQuery({ metrics: ids })}
            autoFocus={autoFocusMetrics && type === firstType.current}
          />
        </Field>
      )}

      <Field label="Split">
        <Pills label="Split" value={query.split} options={splitOptions} onChange={(split) => setQuery({ split })} />
      </Field>

      {type !== "kpi" && (
        <Field label="Grain">
          <Pills label="Grain" value={query.grain} options={grainOptions} onChange={(grain) => setQuery({ grain })} />
        </Field>
      )}

      <Field label="Filters">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-content-strong">
          <input
            type="checkbox"
            checked={!customizing}
            onChange={(e) => {
              if (e.target.checked) {
                setCustomizing(false);
                const next = { ...overrides };
                delete next.clients;
                delete next.period;
                delete next.compare;
                delete next.currency;
                setQuery({ overrides: next });
              } else {
                setCustomizing(true);
              }
            }}
            className="h-[14px] w-[14px] accent-[var(--accent)]"
          />
          Use report filters
        </label>

        {customizing && (
          <div className="mt-1 flex flex-col gap-2.5 rounded-md bg-gray-50 p-2.5">
            <OverrideRow label="Clients" overridden={overrides.clients !== undefined} onReset={() => setOverride("clients", undefined)}>
              <ClientPicker
                clients={clients}
                value={overrides.clients ?? filters.clients}
                onChange={(v) => setOverride("clients", v)}
              />
            </OverrideRow>
            <OverrideRow label="Period" overridden={overrides.period !== undefined} onReset={() => setOverride("period", undefined)}>
              <PeriodControl value={overrides.period ?? filters.period} onChange={(v) => setOverride("period", v)} />
            </OverrideRow>
            <OverrideRow label="Compare" overridden={overrides.compare !== undefined} onReset={() => setOverride("compare", undefined)}>
              <Pills
                label="Compare"
                value={overrides.compare ?? filters.compare}
                options={COMPARE_MODES.map((m) => ({ value: m, label: COMPARE_LABEL[m] }))}
                onChange={(v) => setOverride("compare", v)}
              />
            </OverrideRow>
            <OverrideRow label="Currency" overridden={overrides.currency !== undefined} onReset={() => setOverride("currency", undefined)}>
              <Pills
                label="Currency"
                value={overrides.currency ?? filters.currency}
                options={currencyOptions}
                onChange={(v) => setOverride("currency", v)}
              />
            </OverrideRow>
          </div>
        )}
      </Field>

      <Field label="Industry">
        <Switch
          label="Industry benchmark"
          checked={benchmarkOn}
          disabled={!anyBenchmarkable}
          hint={anyBenchmarkable ? undefined : "No benchmark for these metrics"}
          onChange={(v) => setOverride("benchmark", v)}
        />
      </Field>

      {type === "ranked" && (
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Sort">
              <Pills
                label="Sort"
                value={view.sort ?? "desc"}
                options={[
                  { value: "desc", label: "High first" },
                  { value: "asc", label: "Low first" },
                ]}
                onChange={(sort) => setView({ sort })}
              />
            </Field>
          </div>
          <div className="w-[84px]">
            <Field label="Limit">
              <input
                type="number"
                inputMode="numeric"
                aria-label="Limit"
                min={1}
                max={MAX_RANKED_LIMIT}
                value={limitText}
                onChange={(e) => {
                  setLimitText(e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n <= MAX_RANKED_LIMIT) setView({ limit: n });
                }}
                className={`${INPUT} font-mono`}
              />
            </Field>
          </div>
        </div>
      )}

      {type === "bar" && (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-content-strong">
          <input
            type="checkbox"
            checked={view.stacked ?? false}
            onChange={(e) => setView({ stacked: e.target.checked ? true : undefined })}
            className="h-[14px] w-[14px] accent-[var(--accent)]"
          />
          Stacked
        </label>
      )}

      <Field label="Title" id={`${baseId}-title`}>
        <input
          type="text"
          aria-labelledby={`${baseId}-title`}
          maxLength={MAX_WIDGET_TITLE}
          value={view.title ?? ""}
          placeholder={autoTitle(config, metrics)}
          onChange={(e) => setView({ title: e.target.value === "" ? undefined : e.target.value })}
          className={INPUT}
        />
      </Field>
    </section>
  );
}
