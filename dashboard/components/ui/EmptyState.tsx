/**
 * The only empty states the app renders. One line each, by design: no hint,
 * no paragraph, no "widen the range", no pipeline explanation.
 *
 *   <NotConnected source="Meta" />  ->  "Meta not connected."   (registry says the source is off)
 *   <NoData />                      ->  "No data in this range." (source is on, the query returned nothing)
 *   <Value>{formatMoney(v, ccy)}</Value>  mutes the "n/a" glyph inline.
 *
 * Decide which one from `lib/capabilities.ts` first, the query result second.
 */

import { NO_VALUE } from "@/lib/format";

const BOX =
  "rounded-card border border-dashed border-hairline-strong bg-paper px-5 py-6 text-[13.5px] text-content-muted";

/** "{source} not connected." for a source the client does not have. */
export function NotConnected({ source }: { source: string }) {
  return (
    <div role="status" className={BOX}>
      {source} not connected.
    </div>
  );
}

/** "No data in this range." for a connected source with no rows. */
export function NoData() {
  return (
    <div role="status" className={BOX}>
      No data in this range.
    </div>
  );
}

/** The muted "n/a" glyph, for a cell or figure with no value. */
export function NoValue() {
  return <span className="text-content-muted">{NO_VALUE}</span>;
}

/** Renders a formatted value, muted when it is the "n/a" glyph. */
export function Value({ children }: { children: string }) {
  return children === NO_VALUE ? <NoValue /> : <>{children}</>;
}
