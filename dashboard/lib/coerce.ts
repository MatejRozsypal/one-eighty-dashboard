/**
 * BigQuery value coercion.
 *
 * The BQ Node client doesn't hand back plain JS primitives for every type:
 *   - NUMERIC / BIGNUMERIC  → a Big-like object (has .toString(), loses precision if you +)
 *   - DATE / DATETIME       → { value: "2026-07-30" }
 *   - INT64                 → number, unless it exceeds Number.MAX_SAFE_INTEGER
 *
 * Every mart column we read is money, a count, or a date, so two helpers cover
 * the whole surface. Use them at the query boundary — never let a raw BQ value
 * reach a component, or you get "[object Object]" in the UI and NaN in the math.
 */

/**
 * Anything BigQuery might hand back for a date column.
 *
 * Numerics are typed `unknown` at the call sites instead of a union: the client
 * returns Big-like wrapper objects whose exact class varies by column type and
 * client version, so narrowing at runtime is more honest than promising a shape
 * TypeScript can't actually verify.
 */
type BqDate = string | { value: string } | null | undefined;

/**
 * Coerce a BigQuery numeric to a JS number.
 *
 * Returns null for NULL/undefined/unparseable rather than 0 — the distinction
 * matters. A client with no Google Ads has google_spend = NULL, and rendering
 * that as "0" would claim we spent nothing when the truth is we don't know.
 * Let the formatter decide how to show a null (we render "—").
 */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return null;

  // Strings and Big-like wrappers both round-trip correctly through String().
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Coerce a BigQuery numeric to a number, treating NULL as zero.
 *
 * Only for cases where absent genuinely means zero — e.g. summing spend across
 * channels where a missing channel contributes nothing. Don't reach for this by
 * default; `num` is the honest one.
 */
export function num0(value: unknown): number {
  return num(value) ?? 0;
}

/** Coerce a BigQuery DATE to an ISO `YYYY-MM-DD` string. */
export function isoDate(value: BqDate): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : value.value;
}

/**
 * Divide, returning null when the result would be meaningless.
 *
 * Mirrors BigQuery's SAFE_DIVIDE. Used for every rate and ratio we compute in
 * TypeScript rather than SQL. A null denominator must not become Infinity — MER
 * with zero ad spend is undefined, not infinitely good.
 */
export function safeDiv(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}
