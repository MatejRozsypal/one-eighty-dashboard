/**
 * The control bar — date range, comparison, currency, and freshness stamps.
 *
 * Sticks below the header so the numbers below always carry their context: you
 * can never scroll a figure into view without also seeing what period it covers
 * and how fresh the data behind it is.
 */

import { DateRangeControl } from "@/components/controls/DateRangeControl";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import type { ComparisonMode, DateRange, PresetKey } from "@/lib/period";
import type { ConversionCoverage } from "@/lib/currency";
import { ROLLUP_CURRENCY } from "@/lib/currency";

function fmtShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtStamp(date: string | null): string {
  return date ? fmtShort(date) : "—";
}

export function ControlBar({
  range,
  presetKey,
  comparison,
  comparisonMode,
  nativeCurrency,
  displayCurrency,
  conversion,
  shopThrough,
  adsThrough,
}: {
  range: DateRange;
  presetKey: PresetKey | "custom";
  comparison: DateRange | null;
  comparisonMode: ComparisonMode;
  nativeCurrency: string;
  displayCurrency: string;
  conversion: ConversionCoverage | null;
  shopThrough: string | null;
  adsThrough: string | null;
}) {
  const alreadyRollup = nativeCurrency === ROLLUP_CURRENCY;

  // Conversion is offered only when rates actually cover the whole range.
  // Partial coverage is treated as none — a total built from some converted
  // months and some dropped ones is wrong, not merely smaller.
  const canConvert = !alreadyRollup && conversion?.complete === true;

  const convertReason = alreadyRollup
    ? `Already reported in ${ROLLUP_CURRENCY} — nothing to convert.`
    : `${nativeCurrency} → ${ROLLUP_CURRENCY} exchange rates aren't in the warehouse yet, so conversion is disabled.`;

  return (
    <div className="sticky top-[71px] z-20 flex flex-wrap items-center gap-x-5 gap-y-3.5 border-b border-hairline bg-paper px-5 py-3 lg:px-8">
      <DateRangeControl range={range} presetKey={presetKey} />

      <span aria-hidden="true" className="hidden h-6 w-px bg-hairline lg:block" />

      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted sm:inline">
          Compare
        </span>
        <SegmentedControl
          param="compare"
          ariaLabel="Comparison period"
          active={comparisonMode}
          segments={[
            { value: "previous_period", label: "Prev period" },
            { value: "previous_year", label: "Prev year" },
            { value: "none", label: "None" },
          ]}
        />
        {comparison && (
          <span className="hidden font-mono text-[11.5px] tabular text-content-muted xl:inline">
            vs {fmtShort(comparison.from)} – {fmtShort(comparison.to)}
          </span>
        )}
      </div>

      <span aria-hidden="true" className="hidden h-6 w-px bg-hairline lg:block" />

      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted sm:inline">
          Currency
        </span>
        <SegmentedControl
          param="currency"
          ariaLabel="Display currency"
          active={displayCurrency}
          segments={[
            { value: "native", label: `Native (${nativeCurrency})` },
            {
              value: ROLLUP_CURRENCY,
              label: `${nativeCurrency} → ${ROLLUP_CURRENCY}`,
              disabled: !canConvert,
              disabledReason: convertReason,
            },
          ]}
        />
      </div>

      <div className="flex-1" />

      {/*
        Two stamps, not one. Shops report same-day; ad platforms are
        structurally D-1. A single "last updated" would make every ad platform
        look permanently late.
      */}
      <div className="flex items-center gap-3.5 rounded-control border border-hairline bg-gray-50 px-3 py-2">
        <span className="flex flex-col gap-[3px]">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-content-muted">
            Shop data through
          </span>
          <span className="font-mono text-[11.5px] tabular text-content-strong">
            {fmtStamp(shopThrough)}
          </span>
        </span>
        <span aria-hidden="true" className="h-[26px] w-px bg-hairline" />
        <span className="flex flex-col gap-[3px]">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-content-muted">
            Ad platforms through
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] tabular text-content-strong">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
            {fmtStamp(adsThrough)}
          </span>
        </span>
      </div>
    </div>
  );
}
