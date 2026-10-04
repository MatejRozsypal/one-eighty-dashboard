/**
 * Links inside the Meta tab. The URL is the state, so every link rebuilds the
 * current query string and changes only what it means to.
 */

export type SearchState = Record<string, string | string[] | undefined>;

const PATH = "/paid/meta";

/** First value of a search param. */
export function pick(search: SearchState, key: string): string | undefined {
  const v = search[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The tab's own URL with some params changed. A value of `null` removes the
 * param. `hash` jumps to a block on the page.
 */
export function metaHref(
  search: SearchState,
  patch: Record<string, string | null>,
  hash?: string
): string {
  const q = new URLSearchParams();
  for (const key of Object.keys(search)) {
    const v = pick(search, key);
    if (v !== undefined) q.set(key, v);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) q.delete(key);
    else q.set(key, value);
  }
  const qs = q.toString();
  return `${PATH}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
