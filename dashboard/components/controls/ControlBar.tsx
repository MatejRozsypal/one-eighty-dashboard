/**
 * The control bar — date range, comparison, and currency.
 *
 * Sticks directly beneath the header so the numbers below always carry the
 * period they cover: you can never scroll a figure into view without also
 * seeing what range produced it.
 *
 * ── One row, not two ────────────────────────────────────────────────────────
 * This used to also carry two freshness stamps ("shop data through" / "ad
 * platforms through"). They pushed the bar into a second wrapped row, and
 * header plus bar then occupied over 150px before a single number appeared.
 * Freshness is per-source, judged against per-source expectations, and the
 * Data Health page already does that properly — a pair of dates bolted to the
 * corner of every screen was the worse home for it.
 *
 * It is deliberately not an overflow-scroll container: the date picker's
 * popover is absolutely positioned inside this element, and any `overflow`
 * other than visible would clip the calendar.
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

export function ControlBar({
  range,
  presetKey,
  comparison,
  comparisonMode,
  nativeCurrency,
  displayCurrency,
  conversion,
}: {
  range: DateRange;
  presetKey: PresetKey | "custom";
  comparison: DateRange | null;
  comparisonMode: ComparisonMode;
  nativeCurrency: string;
  displayCurrency: string;
  conversion: ConversionCoverage | null;
}) {
  // A client already trading in the rollup currency has nothing to convert, so
  // the control is omitted rather than shown reading "CZK → CZK 🔒", which is
  // a padlock guarding nothing and costs a fifth of the bar's width.
  const showCurrency = nativeCurrency !== ROLLUP_CURRENCY;

  // Conversion is offered only when rates actually cover the whole range.
  // Partial coverage is treated as none — a total built from some converted
  // months and some dropped ones is wrong, not merely smaller.
  const canConvert = conversion?.complete === true;

  const missing = conversion?.missingMonths ?? [];
  const convertReason =
    missing.length > 0
      ? `No ${nativeCurrency} → ${ROLLUP_CURRENCY} rate for ${missing.length === 1 ? missing[0].slice(0, 7) : `${missing.length} months in this range`}. See runbooks/23_fx_rates_refresh.md.`
      : `${nativeCurrency} → ${ROLLUP_CURRENCY} conversion is unavailable for this range.`;

  return (
    /*
      Transparent and static on mobile: this is the first thing inside the
      rounded content surface, so a white bar with square corners would sit on
      top of the curve and cancel it. It also stops competing with the black
      bar directly above. Sticky and papered from `lg` up, where it sits under
      a light header and has a curve-free corner to occupy.
    */
    <div className="z-20 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2 lg:sticky lg:top-[var(--header-h)] lg:border-b lg:border-hairline lg:bg-paper lg:px-8">
      <DateRangeControl range={range} presetKey={presetKey} />

      <span aria-hidden="true" className="hidden h-5 w-px bg-hairline lg:block" />

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

      {showCurrency && (
        <>
          <span
            aria-hidden="true"
            className="hidden h-5 w-px bg-hairline lg:block"
          />
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
        </>
      )}
    </div>
  );
}
