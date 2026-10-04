"use client";

/**
 * Metric picker: a keyboard-complete combobox (design 1.7).
 *
 *   [ MER x ] [ CAC x ]  Search metrics...
 *   ACQUISITION
 *     MER         x   I
 *   GOOGLE
 *     Google ROAS x   I   2 of 5 clients
 *
 * Metadata comes in as a prop (`metrics`) so this file does not import the
 * registry: the page builds the array from `METRICS` (see `PickerMetric`).
 * Row glyphs: `x` ratio, `$` money, `%` percent, `#` count; `I` marks a metric
 * with an industry benchmark. "N of M clients" is the capability coverage of
 * `clients` (the clients the widget will query); it is hidden when every client
 * can compute the metric and the row is greyed, with the reason on hover, when
 * none can. A greyed row stays selectable: the selection can change later and
 * the widget then shows "Not connected" for it.
 *
 * Keyboard (the whole map):
 *   type            filter by label, id or alias
 *   Up / Down       move through the rows (Home, End jump); opens the list
 *   Enter           toggle the highlighted row (single mode: pick it and close)
 *   Backspace       on an empty search, remove the last chip (not below `min`)
 *   Esc             close the list (the event stops there; a second Esc reaches the drawer)
 *   Tab             leave the field, closing the list
 *
 * ARIA: the input is `role="combobox"` with `aria-expanded`, `aria-controls` and
 * `aria-activedescendant`; the list is a `listbox` of `option`s in labelled
 * `group`s, `aria-multiselectable` in multi mode.
 *
 * Owner: RS8.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MetricId } from "@/lib/reports/registry/ids";
import {
  METRIC_GROUP_ORDER,
  type CapExpr,
  type Capability,
  type MetricGroup,
  type ReportClient,
  type Unit,
} from "@/lib/reports/registry/types";
import { MAX_METRICS_PER_WIDGET } from "@/lib/reports/limits";

/**
 * What the picker needs to know about one metric. Build it from the registry:
 *
 *   Object.values(METRICS).filter((m) => isMetricId(m.id)).map((m) => ({
 *     id: m.id, label: m.label, group: m.group, unit: m.unit,
 *     benchmarkable: m.benchmarkable, requires: m.meta.requires,
 *     description: m.description, aliases: m.aliases,
 *   }))
 */
export interface PickerMetric {
  /** Queryable id only (phase 1). */
  id: MetricId;
  label: string;
  group: MetricGroup;
  unit: Unit;
  benchmarkable: boolean;
  /**
   * The full requirement: components AND metric.requires (`meta.requires`).
   * Undefined means every client can compute it.
   */
  requires?: CapExpr;
  /** One line shown on hover. */
  description?: string;
  /** Extra search terms ("margin" finds CM1 %). */
  aliases?: readonly string[];
}

const GROUP_LABEL: Record<MetricGroup, string> = {
  profitability: "Profitability",
  acquisition: "Acquisition",
  retention: "Retention",
  meta: "Meta",
  google: "Google",
  email: "Email",
};

const UNIT_GLYPH: Record<Unit, string> = { money: "$", count: "#", ratio: "x", percent: "%" };
const UNIT_NAME: Record<Unit, string> = { money: "Money", count: "Count", ratio: "Ratio", percent: "Percent" };

const CAP_NAME: Record<Capability, string> = {
  shopify: "Shopify",
  shoptet: "Shoptet",
  woocommerce: "WooCommerce",
  meta: "Meta",
  googleAds: "Google Ads",
  klaviyo: "Klaviyo",
  ecomail: "Ecomail",
  ga4: "GA4",
  shop: "a connected shop",
  email: "an email platform",
};

// ---------------------------------------------------------------------------
// Capability coverage (mirrors evalCapExpr of registry/capabilities.ts, which
// RS1 owns; this copy exists so the picker has no build-time dependency on it)
// ---------------------------------------------------------------------------

function holds(expr: CapExpr, client: ReportClient): boolean {
  if (typeof expr === "string") return client.capabilities[expr] === true;
  if ("all" in expr) return expr.all.every((e) => holds(e, client));
  return expr.any.some((e) => holds(e, client));
}

function leaves(expr: CapExpr, out: Set<Capability> = new Set()): Set<Capability> {
  if (typeof expr === "string") out.add(expr);
  else for (const e of "all" in expr ? expr.all : expr.any) leaves(e, out);
  return out;
}

/** How many of `clients` can compute the metric. */
export function coverageOf(metric: Pick<PickerMetric, "requires">, clients: readonly ReportClient[]): number {
  const req = metric.requires;
  if (req === undefined) return clients.length;
  return clients.filter((c) => holds(req, c)).length;
}

/** "No selected client has Google Ads". Used when coverage is 0 of N. */
export function noCoverageReason(metric: Pick<PickerMetric, "requires">, clients: readonly ReportClient[]): string {
  const req = metric.requires;
  if (req === undefined) return "No selected client can compute it";
  const absent = [...leaves(req)].filter((cap) => clients.every((c) => c.capabilities[cap] !== true));
  if (absent.length === 0) return "No selected client can compute it";
  return `No selected client has ${absent.map((cap) => CAP_NAME[cap]).join(" or ")}`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function haystack(m: PickerMetric): string {
  return [m.label, m.id.replace(/_/g, " "), m.id, ...(m.aliases ?? [])].join(" ").toLowerCase();
}

/** Every whitespace-separated term must appear in the label, id or an alias. */
export function filterMetrics(metrics: readonly PickerMetric[], query: string): PickerMetric[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...metrics];
  return metrics.filter((m) => {
    const h = haystack(m);
    return terms.every((t) => h.includes(t));
  });
}

interface Row {
  metric: PickerMetric;
  /** Position in the flat, visible order. */
  index: number;
}

function groupRows(metrics: readonly PickerMetric[]): Array<{ group: MetricGroup; rows: Row[] }> {
  const out: Array<{ group: MetricGroup; rows: Row[] }> = [];
  let index = 0;
  for (const group of METRIC_GROUP_ORDER) {
    const inGroup = metrics.filter((m) => m.group === group);
    if (inGroup.length === 0) continue;
    out.push({ group, rows: inGroup.map((metric) => ({ metric, index: index++ })) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MetricPickerProps {
  /** Every selectable metric (see `PickerMetric`). */
  metrics: readonly PickerMetric[];
  /** Selected ids, in display order. */
  selected: readonly MetricId[];
  onChange: (next: MetricId[]) => void;
  /** The clients the widget will query, for the coverage hint. Empty hides hints. */
  clients: readonly ReportClient[];
  /** "multi" toggles; "single" holds one value and closes on pick. Default "multi". */
  mode?: "multi" | "single";
  /** Single mode only: allow removing the value (chip x, Backspace). Default false. */
  clearable?: boolean;
  /** Multi mode cap. Default MAX_METRICS_PER_WIDGET. */
  max?: number;
  /** Multi mode floor: the last chip(s) cannot be removed below it. Default 0; a widget uses 1. */
  min?: number;
  /** Accessible name. Default "Metrics". */
  label?: string;
  /** Focus the input and open the list on mount (a widget was just added). */
  autoFocus?: boolean;
  /** Shown while nothing is selected. */
  placeholder?: string;
}

export function MetricPicker({
  metrics,
  selected,
  onChange,
  clients,
  mode = "multi",
  clearable = false,
  max = MAX_METRICS_PER_WIDGET,
  min = 0,
  label = "Metrics",
  autoFocus = false,
  placeholder = "Search metrics",
}: MetricPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(autoFocus);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (id: string) => `${baseId}-opt-${id}`;

  const multi = mode === "multi";
  const byId = useMemo(() => new Map(metrics.map((m) => [m.id, m])), [metrics]);
  const visible = useMemo(() => filterMetrics(metrics, query), [metrics, query]);
  const groups = useMemo(() => groupRows(visible), [visible]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const atMax = multi && selected.length >= max;
  const canRemove = (multi && selected.length > min) || (!multi && clearable);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The highlighted row stays inside the list.
  useEffect(() => {
    if (!open) return;
    const id = flat[active]?.metric.id;
    if (!id) return;
    document.getElementById(optionId(id))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from baseId, stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, flat]);

  // A shorter result list can leave the highlight past the end.
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function commit(id: MetricId) {
    const isOn = selected.includes(id);
    if (!multi) {
      if (!isOn) onChange([id]);
      setOpen(false);
      setQuery("");
      return;
    }
    if (isOn) {
      if (selected.length > min) onChange(selected.filter((s) => s !== id));
    } else if (!atMax) onChange([...selected, id]);
  }

  function remove(id: MetricId) {
    if (!canRemove) return;
    onChange(selected.filter((s) => s !== id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (flat.length === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => (a + step + flat.length) % flat.length);
        return;
      }
      case "Home":
      case "End":
        if (!open || flat.length === 0) return;
        e.preventDefault();
        setActive(e.key === "Home" ? 0 : flat.length - 1);
        return;
      case "Enter": {
        // Never submit an enclosing form; only act on an open list.
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const row = flat[active];
        if (row) commit(row.metric.id);
        return;
      }
      case "Backspace":
        if (query === "" && canRemove && selected.length > 0) {
          e.preventDefault();
          remove(selected[selected.length - 1]);
        }
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  const activeId = open && flat[active] ? optionId(flat[active].metric.id) : undefined;
  const showPlaceholder = selected.length === 0 || (multi && query === "" && selected.length < max);

  return (
    <div ref={wrapRef} className="relative">
      <div
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        className="flex min-h-[38px] cursor-text flex-wrap items-center gap-1.5 rounded-control border border-hairline-strong bg-paper px-2 py-1.5 focus-within:border-accent focus-within:shadow-[0_0_0_2px_var(--focus-ring)]"
      >
        {selected.map((id) => {
          const m = byId.get(id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-pill bg-gray-100 py-[3px] pl-2.5 pr-1.5 text-[12px] font-medium text-content-strong"
            >
              {m?.label ?? id}
              {canRemove && (
                <button
                  type="button"
                  aria-label={`Remove ${m?.label ?? id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(id);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full px-1 text-content-muted transition-colors duration-fast hover:text-content-strong"
                >
                  <span aria-hidden="true">{"×"}</span>
                </button>
              )}
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={showPlaceholder ? placeholder : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-[96px] flex-1 bg-transparent py-0.5 text-[13px] text-content-strong outline-none focus-visible:outline-none placeholder:text-content-muted"
        />
      </div>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multi || undefined}
          // Keep focus in the input while the pointer works the list.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-[90] mt-1 max-h-[320px] overflow-y-auto rounded-lg border border-hairline bg-paper py-1 shadow-lg"
        >
          {flat.length === 0 && <div className="px-3 py-2.5 text-[12.5px] text-content-muted">No match</div>}
          {groups.map(({ group, rows }) => (
            <div key={group} role="group" aria-labelledby={`${baseId}-g-${group}`}>
              <div
                id={`${baseId}-g-${group}`}
                className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted"
              >
                {GROUP_LABEL[group]}
              </div>
              {rows.map(({ metric, index }) => {
                const isOn = selected.includes(metric.id);
                const covered = coverageOf(metric, clients);
                const none = clients.length > 0 && covered === 0;
                const partial = clients.length > 0 && covered > 0 && covered < clients.length;
                const blocked = !isOn && atMax;
                const hover = none
                  ? noCoverageReason(metric, clients)
                  : blocked
                    ? `Up to ${max} metrics`
                    : metric.description;
                return (
                  <div
                    key={metric.id}
                    id={optionId(metric.id)}
                    role="option"
                    aria-selected={isOn}
                    aria-disabled={blocked || undefined}
                    title={hover}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => commit(metric.id)}
                    className={`flex cursor-pointer items-center gap-2.5 px-3 py-[7px] text-[13px] ${
                      index === active ? "bg-gray-50" : ""
                    } ${none || blocked ? "text-content-muted" : "text-content-strong"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-xs border text-[10px] leading-none ${
                        isOn ? "border-transparent bg-ink-900 text-content-inverse" : "border-hairline-strong"
                      }`}
                    >
                      {isOn ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{metric.label}</span>
                    {partial || none ? (
                      <span className="font-mono text-[10.5px] text-content-muted">
                        {covered} of {clients.length} clients
                      </span>
                    ) : null}
                    <span
                      title={UNIT_NAME[metric.unit]}
                      className="w-3 text-center font-mono text-[11px] text-content-muted"
                    >
                      {UNIT_GLYPH[metric.unit]}
                    </span>
                    <span
                      title={metric.benchmarkable ? "Industry benchmark" : undefined}
                      aria-label={metric.benchmarkable ? "Industry benchmark" : undefined}
                      className="w-3 text-center font-mono text-[11px] text-content-muted"
                    >
                      {metric.benchmarkable ? "I" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
