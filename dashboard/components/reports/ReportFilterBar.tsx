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

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DateRangeControl } from "@/components/controls/DateRangeControl";
import { SegmentedControl, type Segment } from "@/components/controls/SegmentedControl";
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
  const { isPending, navigate } = useNavigation();

  const { range, presetKey } = periodRange(filters.period);
  const comparison = filters.compare === "none" ? null : comparisonRange(range, filters.compare);

  const chosen = useMemo(() => selectedClients(clients, filters.clients), [clients, filters.clients]);
  const currencies = new Set(chosen.map((c) => c.currency));
  const mixed = currencies.size > 1;
  const sharedCurrency = !mixed ? chosen[0]?.currency : undefined;

  function patch(p: FilterOverrides) {
    const qs = patchFilterParams(searchParams.toString(), p, defaults);
    navigate(qs === "" ? pathname : `${pathname}?${qs}`);
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
        <SegmentedControl
          param="compare"
          ariaLabel="Comparison period"
          active={filters.compare}
          segments={[
            { value: "previous_period", label: "Prev period" },
            { value: "previous_year", label: "Prev year" },
            { value: "none", label: "None" },
          ]}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted sm:inline">Currency</span>
        <SegmentedControl param="ccy" ariaLabel="Display currency" active={filters.currency} segments={currencySegments} />
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
          } ${isPending ? "animate-pulse" : ""}`}
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
