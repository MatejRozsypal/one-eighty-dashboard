"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.num = num;
exports.num0 = num0;
exports.isoDate = isoDate;
exports.safeDiv = safeDiv;
/**
 * Coerce a BigQuery numeric to a JS number.
 *
 * Returns null for NULL/undefined/unparseable rather than 0 — the distinction
 * matters. A client with no Google Ads has google_spend = NULL, and rendering
 * that as "0" would claim we spent nothing when the truth is we don't know.
 * Let the formatter decide how to show a null (we render "—").
 */
function num(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean")
        return null;
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
function num0(value) {
    return num(value) ?? 0;
}
/** Coerce a BigQuery DATE to an ISO `YYYY-MM-DD` string. */
function isoDate(value) {
    if (value === null || value === undefined)
        return null;
    return typeof value === "string" ? value : value.value;
}
/**
 * Divide, returning null when the result would be meaningless.
 *
 * Mirrors BigQuery's SAFE_DIVIDE. Used for every rate and ratio we compute in
 * TypeScript rather than SQL. A null denominator must not become Infinity — MER
 * with zero ad spend is undefined, not infinitely good.
 */
function safeDiv(numerator, denominator) {
    if (numerator === null || denominator === null)
        return null;
    if (denominator === 0)
        return null;
    const result = numerator / denominator;
    return Number.isFinite(result) ? result : null;
}
