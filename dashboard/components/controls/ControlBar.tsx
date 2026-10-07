/**
 * The control bar: the period pill, plus Compare and Currency where the page
 * uses them. One row of soft grey pills, no labels (see `Pill`).
 *
 * Sticks directly beneath the header so the numbers below always carry the
 * period they cover.
 *
 * ── Opt-in controls ─────────────────────────────────────────────────────────
 * `compare` and `currency` default to false. A control that changes nothing on
 * the page is worse than no control, so a page turns one on only when its
 * queries read it (Compare: Snapshot, Products, Unit economics, Paid,
 * Creative; Currency: Snapshot, Paid). Beside Compare sits the "% | 123" delta
 * toggle, hidden when Compare is None.
 *
 * It is deliberately not an overflow-scroll container: the popovers are
 * absolutely positioned inside this element, and any `overflow` other than
 * visible would clip the calendar.
 */

import { DateRangeControl } from "@/components/controls/DateRangeControl";
import { ComparisonControl } from "@/components/controls/ComparisonControl";
import { CurrencyControl } from "@/components/controls/CurrencyControl";
import { DeltaModeToggle } from "@/components/controls/DeltaModeToggle";
import type { ComparisonMode, DateRange, PresetKey } from "@/lib/period";
import type { ConversionCoverage } from "@/lib/currency";
import { ROLLUP_CURRENCY } from "@/lib/currency";

export function ControlBar({
  range,
  presetKey,
  comparison,
  comparisonMode,
  nativeCurrency,
  displayCurrency,
  conversion,
  compare = false,
  currency = false,
}: {
  range: DateRange;
  presetKey: PresetKey | "custom";
  comparison: DateRange | null;
  comparisonMode: ComparisonMode;
  nativeCurrency: string;
  displayCurrency: string;
  conversion: ConversionCoverage | null;
  /** Show the Compare control. Only on pages whose queries read the comparison. */
  compare?: boolean;
  /** Show the Currency toggle (non-CZK clients only). Only on pages that honour it. */
  currency?: boolean;
  /** Deprecated and ignored: no scope label beside the picker. */
  scope?: string | null;
}) {
  // A client already trading in the rollup currency has nothing to convert.
  const showCurrency = currency && nativeCurrency !== ROLLUP_CURRENCY;

  // Conversion is offered only when rates actually cover the whole range.
  // Partial coverage is treated as none, a total built from some converted
  // months and some dropped ones is wrong, not merely smaller.
  const canConvert = conversion?.complete === true;

  const missing = conversion?.missingMonths ?? [];
  const convertReason =
    missing.length === 1
      ? `No ${ROLLUP_CURRENCY} rate for ${missing[0].slice(0, 7)}.`
      : `No ${ROLLUP_CURRENCY} rate for this range.`;

  return (
    /*
      Transparent and static on mobile: this is the first thing inside the
      rounded content surface, so a white bar with square corners would sit on
      top of the curve and cancel it. It also stops competing with the black
      bar directly above. Sticky and papered from `lg` up, where it sits under
      a light header and has a curve-free corner to occupy.
    */
    // Sticky bar spans the viewport; its controls ride the shared column so
    // they line up with the header above and the cards below.
    <div className="z-20 py-2 lg:sticky lg:top-[var(--header-h)] lg:border-b lg:border-hairline lg:bg-paper">
      <div className="page-frame flex flex-wrap items-center gap-2 px-5 lg:px-8">
        <DateRangeControl range={range} presetKey={presetKey} withToday />

        {compare && (
          <>
            <ComparisonControl
              range={range}
              mode={comparisonMode}
              comparison={comparison}
            />
            {/* Percent or absolute change. Nothing to show with Compare off. */}
            {comparisonMode !== "none" && <DeltaModeToggle />}
          </>
        )}

        {showCurrency && (
          <CurrencyControl
            nativeCurrency={nativeCurrency}
            rollupCurrency={ROLLUP_CURRENCY}
            displayCurrency={displayCurrency}
            canConvert={canConvert}
            convertReason={convertReason}
          />
        )}
      </div>
    </div>
  );
}
