/**
 * Links between the Paid tabs, and from Paid into Creative.
 *
 * Pure (type imports only), so the tab bar can run it in the browser. The view
 * state lives in the URL, so a link that drops a parameter silently changes
 * whose numbers you are looking at: every helper here carries it across.
 */

import type { ViewParams } from "@/lib/params";
import type { PaidTabKey } from "@/lib/paid/types";

/** Route of each tab. Overview is `/paid` itself. */
export const PAID_TAB_HREF: Record<PaidTabKey, string> = {
  overview: "/paid",
  meta: "/paid/meta",
  google: "/paid/google",
  ga4: "/paid/ga4",
};

type QueryLike = string | URLSearchParams | { toString(): string } | null | undefined;

/** Normalise a query string source (with or without a leading "?") to a URLSearchParams. */
function toParams(query: QueryLike): URLSearchParams {
  if (query === null || query === undefined) return new URLSearchParams();
  const text = typeof query === "string" ? query : query.toString();
  return new URLSearchParams(text.startsWith("?") ? text.slice(1) : text);
}

/**
 * The link to a tab, carrying the current query string (client, range,
 * comparison, currency). Pass `drop` for parameters that only mean something on
 * the tab you are leaving (a selected campaign, a table filter).
 *
 *     tabHref("meta", searchParams)  ->  "/paid/meta?client=a&preset=30d"
 */
export function tabHref(
  tab: PaidTabKey,
  query?: QueryLike,
  options: { drop?: readonly string[] } = {}
): string {
  const params = toParams(query);
  for (const key of options.drop ?? []) params.delete(key);
  const qs = params.toString();
  const path = PAID_TAB_HREF[tab];
  return qs ? `${path}?${qs}` : path;
}

/**
 * What Creative can be told to filter to. `adId` and `campaignId` are the two
 * Paid uses. Campaigns go by ID, never by name: a name can be missing or
 * spelled differently on the Creative side, an ID cannot.
 */
export interface CreativeFocus {
  field: "adId" | "campaignId";
  value: string;
}

/**
 * The link into Creative: the same client, range and comparison, optionally
 * filtered to one ad or one campaign (`?focus=adId&is=<id>`, `?focus=campaignId&is=<id>`).
 *
 * Takes the page's parsed view params rather than the raw query string, because
 * Creative defaults to the whole history where Paid defaults to 30 days. The
 * preset is therefore always written out, so the reader lands on the window
 * they were looking at. A custom range carries its two dates. Currency is not
 * carried: Creative does not read it.
 */
export function creativeHref(
  view: Pick<ViewParams, "clientId" | "presetKey" | "range" | "comparisonMode">,
  focus?: CreativeFocus
): string {
  const q = new URLSearchParams();
  if (view.clientId) q.set("client", view.clientId);
  q.set("preset", view.presetKey);
  if (view.presetKey === "custom") {
    q.set("from", view.range.from);
    q.set("to", view.range.to);
  }
  q.set("compare", view.comparisonMode);
  if (focus) {
    q.set("focus", focus.field);
    q.set("is", focus.value);
  }
  return `/creative?${q.toString()}`;
}
