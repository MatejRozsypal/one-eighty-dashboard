/**
 * The control bar, ready to drop on any page whose queries take the range.
 *
 *     <PageControls client={client} params={params} />                 date range only
 *     <PageControls client={client} params={params} compare />         + Compare
 *     <PageControls client={client} params={params} compare currency /> + Currency (non-CZK clients)
 *
 * Turn a control on only when the page's queries read it. The FX coverage
 * query runs only when `currency` is on.
 *
 * Nothing is stored: range, comparison and currency live in the URL, and every
 * nav link carries the current query string, so the selection follows you
 * between pages. Admin, Settings, Chat and Data health take no bar at all.
 */

import { ControlBar } from "@/components/controls/ControlBar";
import { getConversionCoverage, ROLLUP_CURRENCY } from "@/lib/currency";
import { optional } from "@/lib/queries/errors";
import type { Client } from "@/lib/clients";
import type { ViewParams } from "@/lib/params";

export async function PageControls({
  client,
  params,
  compare = false,
  currency = false,
}: {
  client: Client;
  params: ViewParams;
  /** Show the Compare control. Default false. */
  compare?: boolean;
  /** Show the Currency toggle (non-CZK clients only). Default false. */
  currency?: boolean;
  /** Deprecated and ignored. Pages drop it in wave 2. */
  scope?: string | null;
}) {
  const coverage =
    !currency || client.currency === ROLLUP_CURRENCY
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
      compare={compare}
      currency={currency}
    />
  );
}
