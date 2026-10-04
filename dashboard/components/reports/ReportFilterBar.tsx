"use client";

/**
 * Report filter bar (design 1.9): clients, period, compare, currency, industry.
 *
 *   [ 5 clients v ]  [ Jul 1, 2026 to Sep 30, 2026 ]  Compare (Prev period)(Prev year)(None)
 *   Currency (CZK)(EUR)(USD)(Native)   Industry [ ]   [dirty dot  Save default]
 *
 * The URL is the state. Every control writes its param (see `lib/reports/url.ts`)
 * and navigates inside the shared navigation transition, so the figures pulse
 * while the new numbers load, exactly like the other dashboard pages. The date
 * range and the compare control are the existing `DateRangeControl` and
 * `SegmentedControl`, unchanged; they write `preset`, `from`, `to` and `compare`.
 *
 * Props:
 *   filters   the effective filters: the report's saved filters with the URL
 *             overrides applied (`withOverrides` in lib/reports/url.ts)
 *   defaults  the saved filters. With it, a control that returns to the saved
 *             value drops its param (a clean URL), and the bar shows a dot when
 *             the view differs from the saved default
 *   clients   active clients, for the chip and the "Native" rule
 *   onSaveDefault   shows "Save default" when the view is dirty (Cmd/Ctrl+S is
 *             bound by the page, not here)
 *
 * Native currency is disabled with "Mixed currencies" unless every selected
 * client trades in one currency.
 *
 * Owner: RS8.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DateRangeControl } from "@/components/controls/DateRangeControl";
import type { Segment } from "@/components/controls/SegmentedControl";
import { useNavigation } from "@/components/shell/NavigationPending";
import { comparisonRange, presetRange, type DateRange, type PresetKey } from "@/lib/period";
import type { ReportClient } from "@/lib/reports/registry/types";
import type { ReportFilters } from "@/lib/reports/types";
import { filtersEqual, patchFilterParams, type FilterOverrides } from "@/lib/reports/url";
import { ClientPicker, selectedClients } from "./pickers/ClientPicker";

function fmtShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The range and preset key the date control shows for a period spec. */
export function periodRange(period: ReportFilters["period"]): { range: DateRange; presetKey: PresetKey | "custom" } {
  if (period.kind === "preset") return { range: presetRange(period.preset), presetKey: period.preset };
  return { range: { from: period.from, to: period.to }, presetKey: "custom" };
}

export interface ReportFilterBarProps {
  filters: ReportFilters;
  defaults?: ReportFilters;
  clients: readonly ReportClient[];
  onSaveDefault?: () => void;
}

export function ReportFilterBar({ filters, defaults, clients, onSaveDefault }: ReportFilterBarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, pendingHref, navigate } = useNavigation();

  const { range, presetKey } = periodRange(filters.period);
  const comparison = filters.compare === "none" ? null : comparisonRange(range, filters.compare);

  const chosen = useMemo(() => selectedClients(clients, filters.clients), [clients, filters.clients]);
  const currencies = new Set(chosen.map((c) => c.currency));
  const mixed = currencies.size > 1;
  const sharedCurrency = !mixed ? chosen[0]?.currency : undefined;

  // Each control change merges onto the newest URL, not onto the one the
  // router has committed: `searchParams` is a snapshot of the last commit, so
  // two changes inside one load (Industry, then a currency) would otherwise
  // both start from the same old URL and the second would erase the first.
  // `latest` holds what the previous change navigated to until the router
  // catches up.
  const latest = useRef<string | null>(null);
  useEffect(() => {
    if (!isPending) latest.current = null;
  }, [isPending]);

  function patch(p: FilterOverrides) {
    const base = latest.current ?? pendingHref;
    const current = base !== null ? base.slice(base.indexOf("?") === -1 ? base.length : base.indexOf("?") + 1) : searchParams.toString();
    const qs = patchFilterParams(current, p, defaults);
    const href = qs === "" ? pathname : `${pathname}?${qs}`;
    latest.current = href;
    navigate(href);
  }

  // The switch answers on click, not on response (same rule as SegmentedControl).
  const [benchOptimistic, setBenchOptimistic] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isPending) setBenchOptimistic(null);
  }, [isPending]);
  const benchOn = benchOptimistic ?? filters.benchmark;

  const dirty = defaults !== undefined && !filtersEqual(filters, defaults);

  const currencySegments: Segment[] = [
    { value: "CZK", label: "CZK" },
    { value: "EUR", label: "EUR" },
    { value: "USD", label: "USD" },
    {
      value: "native",
      label: sharedCurrency ? `Native ${sharedCurrency}` : "Native",
      disabled: mixed,
      disabledReason: "Mixed currencies",
    },
  ];

  return (
    <div role="toolbar" aria-label="Report filters" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ClientPicker
        clients={clients}
        value={filters.clients}
        commit="close"
        onChange={(clientsValue) => patch({ clients: clientsValue })}
      />

      <DateRangeControl range={range} presetKey={presetKey} />

      <div className="flex items-center gap-2" title={comparison ? `${fmtShort(comparison.from)} to ${fmtShort(comparison.to)}` : undefined}>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted sm:inline">Compare</span>
        <FilterSegments
          ariaLabel="Comparison period"
          active={filters.compare}
          onSelect={(value) => patch({ compare: value as ReportFilters["compare"] })}
          segments={[
            { value: "previous_period", label: "Prev period" },
            { value: "previous_year", label: "Prev year" },
            { value: "none", label: "None" },
          ]}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted sm:inline">Currency</span>
        <FilterSegments
          ariaLabel="Display currency"
          active={filters.currency}
          onSelect={(value) => patch({ currency: value as ReportFilters["currency"] })}
          segments={currencySegments}
        />
      </div>

      <div className="flex items-center gap-2">
        <span id="report-industry-label" className="font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">
          Industry
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={benchOn}
          aria-labelledby="report-industry-label"
          aria-busy={isPending}
          onClick={() => {
            const next = !benchOn;
            setBenchOptimistic(next);
            patch({ benchmark: next });
          }}
          className={`relative h-[20px] w-[36px] shrink-0 rounded-pill transition-colors duration-fast ${
            benchOn ? "bg-accent" : "bg-gray-200"
          } ${isPending ? "oe-pulse" : ""}`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-paper shadow-sm transition-all duration-fast ${
              benchOn ? "left-[18px]" : "left-[2px]"
            }`}
          />
        </button>
      </div>

      {dirty && (
        <div className="flex items-center gap-2">
          <span role="img" aria-label="Unsaved filters" title="Differs from the saved default" className="h-[7px] w-[7px] rounded-full bg-accent" />
          {onSaveDefault && (
            <button
              type="button"
              onClick={onSaveDefault}
              className="rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50"
            >
              Save default
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The compare and currency pills. Same look and behaviour as the shared
 * `SegmentedControl` (the selected segment moves on click, the server catches
 * up), but the change goes through the bar's `patch`, so it merges onto the
 * newest URL instead of the last committed one.
 */
function FilterSegments({
  segments,
  active,
  ariaLabel,
  onSelect,
}: {
  segments: Segment[];
  active: string;
  ariaLabel: string;
  onSelect(value: string): void;
}) {
  const { isPending } = useNavigation();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);
  const shown = optimistic ?? active;

  return (
    <div role="group" aria-label={ariaLabel} aria-busy={isPending} className="flex gap-0.5 rounded-pill bg-gray-100 p-[3px]">
      {segments.map((seg) => {
        if (seg.disabled) {
          return (
            <span
              key={seg.value}
              title={seg.disabledReason}
              className="inline-flex cursor-not-allowed items-center gap-[5px] whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] text-gray-250"
            >
              {seg.label}
              <svg aria-hidden="true" width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2" y="5.5" width="8" height="5" rx="1" />
                <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
              </svg>
            </span>
          );
        }
        const isActive = seg.value === shown;
        return (
          <button
            key={seg.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              if (seg.value === shown) return;
              setOptimistic(seg.value);
              onSelect(seg.value);
            }}
            className={`whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
              isActive ? `bg-paper text-content-strong shadow-sm ${isPending ? "oe-pulse" : ""}` : "text-content-muted hover:text-content-body"
            }`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
