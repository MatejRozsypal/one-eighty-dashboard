/**
 * The control bar, ready to drop on any page whose queries take the range.
 *
 * `ControlBar` needs one thing a page doesn't otherwise fetch: whether FX rates
 * cover the selected range, which decides if the currency toggle is offered.
 * Repeating that query in every page was the reason the bar lived only on
 * Snapshot. This wraps it so adding controls to a page is one line.
 *
 * ── The selection follows you between pages ─────────────────────────────────
 * Nothing is stored. The range, comparison and currency live in the URL, and
 * every nav link carries the current query string, so walking Snapshot →
 * Orders → Paid keeps the period you chose. That is also why a view is
 * shareable: the link *is* the state.
 *
 * ── On every data page, and honest where the range does not apply ───────────
 * It used to be only on pages whose queries read the range, on the grounds
 * that a picker which changes nothing is worse than no picker. Half of that
 * was right and half was wrong: the picker is never inert, because the range
 * is global view state — set it on Customers and it is the period you land on
 * when you click Orders. What was wrong was leaving the reader to guess.
 *
 * So the bar is everywhere, and a page whose figures are not bounded by the
 * range passes `scope` and says so in the bar. Consistent chrome, no implied
 * filter. Admin, Settings, Chat and Data health take no bar at all — they are
 * not readings of a period in any sense.
 */

import { ControlBar } from "@/components/controls/ControlBar";
import { getConversionCoverage, ROLLUP_CURRENCY } from "@/lib/currency";
import { optional } from "@/lib/queries/errors";
import type { Client } from "@/lib/clients";
import type { ViewParams } from "@/lib/params";

export async function PageControls({
  client,
  params,
  scope,
}: {
  client: Client;
  params: ViewParams;
  /** What this page is really scoped to, when it is not the selected range. */
  scope?: string | null;
}) {
  const coverage =
    client.currency === ROLLUP_CURRENCY
      ? null
      : await optional(
          () =>
            getConversionCoverage(client.currency, ROLLUP_CURRENCY, params.range),
          null
        );

  return (
    <ControlBar
      range={params.range}
      presetKey={params.presetKey}
      comparison={params.period.comparison}
      comparisonMode={params.comparisonMode}
      nativeCurrency={client.currency}
      displayCurrency={params.displayCurrency}
      conversion={coverage}
      scope={scope}
    />
  );
}
