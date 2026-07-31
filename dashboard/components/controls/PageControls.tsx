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
 * ── Deliberately not on every page ──────────────────────────────────────────
 * Only pages whose queries actually read the range get this. Customers,
 * Cohorts and Time-between-orders are lifetime or cohort-grained and ignore
 * dates entirely; Channels has no data source connected at all. A date picker
 * there would be a control that changes nothing, which is worse than no
 * control — it invites you to trust a filter that was never applied. Those
 * pages carry a line of copy saying what scope they are on instead.
 */

import { ControlBar } from "@/components/controls/ControlBar";
import { getConversionCoverage, ROLLUP_CURRENCY } from "@/lib/currency";
import { optional } from "@/lib/queries/errors";
import type { Client } from "@/lib/clients";
import type { ViewParams } from "@/lib/params";

export async function PageControls({
  client,
  params,
}: {
  client: Client;
  params: ViewParams;
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
    />
  );
}
