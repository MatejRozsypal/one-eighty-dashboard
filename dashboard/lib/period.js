"use strict";
/**
 * Date ranges and period-over-period comparison.
 *
 * Every KPI in this dashboard is shown twice: the selected range, and a
 * comparison range, with a delta between them. That pattern lives here so the
 * comparison arithmetic is defined once rather than re-derived per page.
 *
 * All dates are plain `YYYY-MM-DD` strings, never `Date` objects. The warehouse
 * stores order dates in UTC (see METRICS.md "Time / dates"), and routing a date
 * through a JS `Date` invites the browser's local timezone to shift it by a day.
 * Strings in, strings out, arithmetic on UTC-anchored values only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESET_LABELS = void 0;
exports.daysInRange = daysInRange;
exports.addDays = addDays;
exports.todayUtc = todayUtc;
exports.comparisonRange = comparisonRange;
exports.resolvePeriod = resolvePeriod;
exports.scanBounds = scanBounds;
exports.delta = delta;
exports.presetRange = presetRange;
exports.includesToday = includesToday;
const MS_PER_DAY = 86_400_000;
/** Parse `YYYY-MM-DD` into epoch ms at UTC midnight. */
function toUtcMs(date) {
    const [y, m, d] = date.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
}
/** Format epoch ms back to `YYYY-MM-DD` (UTC). */
function fromUtcMs(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
/** Inclusive day count: a single-day range is 1, not 0. */
function daysInRange(range) {
    return (toUtcMs(range.to) - toUtcMs(range.from)) / MS_PER_DAY + 1;
}
/** Shift a date by N days, staying in UTC. */
function addDays(date, days) {
    return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}
/**
 * Today in the warehouse's terms.
 *
 * mart dates are UTC, so "today" must be UTC too — otherwise someone in Prague
 * loading the dashboard at 01:00 CEST asks for a date the warehouse considers
 * tomorrow and gets an empty last row.
 */
function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}
/**
 * Build the comparison range for a given current range.
 *
 * - `previous_period` — the same number of days, ending the day before `from`.
 *   A 30-day range compares against the 30 days before it.
 * - `previous_year` — the same calendar span shifted back 364 days, not 365.
 *   364 is exactly 52 weeks, so weekday alignment is preserved. Ecommerce
 *   revenue is strongly weekday-seasonal; comparing a Monday against a Sunday
 *   produces a delta that is an artifact of the calendar, not the business.
 */
function comparisonRange(current, mode) {
    if (mode === "none")
        return null;
    if (mode === "previous_year") {
        return { from: addDays(current.from, -364), to: addDays(current.to, -364) };
    }
    const span = daysInRange(current);
    return {
        from: addDays(current.from, -span),
        to: addDays(current.from, -1),
    };
}
function resolvePeriod(current, mode = "previous_period") {
    return { current, comparison: comparisonRange(current, mode), mode };
}
/**
 * The outer bounds a query must scan to cover both ranges in one pass.
 *
 * Both periods are fetched in a single query and bucketed in SQL rather than
 * issued as two round trips. mart_daily_kpis is a view over 36 months of orders
 * and scans ~1.5 MB per day of range, so halving the number of scans is a
 * direct halving of both cost and page latency.
 *
 * For `previous_year` the two ranges are far apart and this span covers the gap
 * between them too. That's still cheaper than two queries for typical ranges,
 * and the date column is partitioned so the gap is pruned, not read.
 */
function scanBounds(period) {
    if (!period.comparison)
        return period.current;
    return {
        from: period.comparison.from < period.current.from
            ? period.comparison.from
            : period.current.from,
        to: period.comparison.to > period.current.to
            ? period.comparison.to
            : period.current.to,
    };
}
/** Relative change, as a fraction. Null when there's no meaningful baseline. */
function delta(current, previous) {
    if (current === null || previous === null)
        return null;
    // Growth from zero is undefined, not infinite. The UI shows "new" instead.
    if (previous === 0)
        return null;
    return (current - previous) / Math.abs(previous);
}
/**
 * Named ranges for the date picker.
 *
 * All of them end **yesterday**, not today. Today is always a partial day, and
 * a partial day dragged into a comparison makes every metric look like it fell
 * off a cliff. Paid-media data is D-1 anyway (Google Ads structurally so — see
 * the "Google Ads always queries WHERE date < CURRENT_DATE()" rule in README),
 * so today's row could never be complete across sources regardless.
 */
function presetRange(preset, today = todayUtc()) {
    const yesterday = addDays(today, -1);
    switch (preset) {
        // The one preset that deliberately breaks the yesterday rule below. Shops
        // report same-day, so today's revenue and orders are real — but every ad
        // platform is structurally D-1, so spend, ROAS and CAC will read as zero or
        // near it. `isPartialRange` flags this so the UI can say so rather than
        // letting someone read a 0.0x ROAS as a catastrophe.
        case "today":
            return { from: today, to: today };
        case "7d":
            return { from: addDays(yesterday, -6), to: yesterday };
        case "28d":
            return { from: addDays(yesterday, -27), to: yesterday };
        case "30d":
            return { from: addDays(yesterday, -29), to: yesterday };
        case "90d":
            return { from: addDays(yesterday, -89), to: yesterday };
        case "mtd":
            return { from: `${yesterday.slice(0, 7)}-01`, to: yesterday };
        case "ytd":
            return { from: `${yesterday.slice(0, 4)}-01-01`, to: yesterday };
        case "12m":
            return { from: addDays(yesterday, -364), to: yesterday };
    }
}
/**
 * True when the range includes today, whose ad-platform figures cannot be
 * complete. Kept next to `presetRange` so the two can't drift.
 */
function includesToday(range, today = todayUtc()) {
    return range.to >= today;
}
exports.PRESET_LABELS = {
    today: "Today",
    "7d": "Last 7 days",
    "28d": "Last 28 days",
    "30d": "Last 30 days",
    "90d": "Last 90 days",
    mtd: "Month to date",
    ytd: "Year to date",
    "12m": "Last 12 months",
};
