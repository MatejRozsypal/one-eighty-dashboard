"use strict";
/**
 * Currency display and FX conversion.
 *
 * Warehouse policy is native-currency-at-rest: Manami is CZK end to end, Dobias
 * is USD end to end, and no mart view converts anything. That is deliberate —
 * converting at ingest destroys the ability to reconcile against Shopify or
 * Shoptet, which report in the shop's own currency.
 *
 * So conversion is a *display* concern and lives here. The dashboard defaults to
 * native and offers a single agency-wide rollup currency, letting you ask "what
 * did we do in total this month" across a CZK client and a USD one.
 *
 * ── Conversion is done at monthly grain, before aggregation ──────────────────
 * A range spanning several months cannot be converted by multiplying the total
 * by one rate; that silently assumes the rate held all along. Instead each daily
 * row is multiplied by its own month's rate inside SQL, and only then summed.
 * `ref.fx_rates` is monthly (`month_start`), which is why the join is on
 * DATE_TRUNC(date, MONTH).
 *
 * ── The rate table expires ──────────────────────────────────────────────────
 * `ref.fx_rates` is hand-fed, not derived. USD→CZK now covers 2022-06 onward
 * from ČNB's published monthly averages (migration 013), which is what unlocked
 * this toggle — before that the table held only CAD→USD and conversion was
 * impossible.
 *
 * But a table seeded through July is broken in August. ČNB publishes a month's
 * average only once the month closes, so the current month carries a
 * month-to-date mean tagged `source LIKE 'cnb_mtd_avg%'`, and **somebody has to
 * add next month's row**. `getConversionCoverage` treats partial coverage as no
 * coverage, so a single missing month disables the toggle outright rather than
 * quietly returning a total assembled from converted and unconverted months.
 * That is the right failure, but it is a silent one — it looks like a padlock,
 * not an error. Refresh procedure: runbooks/23_fx_rates_refresh.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLLUP_CURRENCY = void 0;
exports.getConversionCoverage = getConversionCoverage;
exports.fxSql = fxSql;
exports.fxParams = fxParams;
exports.getSupportedPairs = getSupportedPairs;
exports.formatMoney = formatMoney;
exports.formatNumber = formatNumber;
exports.formatPercent = formatPercent;
exports.formatRatio = formatRatio;
const bigquery_1 = require("@/lib/bigquery");
const coerce_1 = require("@/lib/coerce");
exports.ROLLUP_CURRENCY = "CZK";
/**
 * Can we convert `from` → `to` across every month of this range?
 *
 * Partial coverage is treated as no coverage. A total assembled from some
 * converted months and some dropped ones is not a smaller number, it is a wrong
 * one, and nothing in the UI would reveal which months went missing.
 */
async function getConversionCoverage(from, to, range) {
    if (from === to) {
        return { from, to, complete: true, missingMonths: [] };
    }
    const rows = await (0, bigquery_1.query)(`WITH wanted AS (
       SELECT month_start
       FROM UNNEST(GENERATE_DATE_ARRAY(
              DATE_TRUNC(@from, MONTH), DATE_TRUNC(@to, MONTH), INTERVAL 1 MONTH
            )) AS month_start
     )
     SELECT w.month_start AS missing_month
     FROM wanted w
     LEFT JOIN \`${bigquery_1.PROJECT_ID}.ref.fx_rates\` fx
       ON fx.month_start   = w.month_start
      AND fx.from_currency = @fromCurrency
      AND fx.to_currency   = @toCurrency
     WHERE fx.rate IS NULL
     ORDER BY w.month_start`, { from: range.from, to: range.to, fromCurrency: from, toCurrency: to });
    const missingMonths = rows
        .map((r) => r.missing_month?.value)
        .filter((m) => Boolean(m));
    return { from, to, complete: missingMonths.length === 0, missingMonths };
}
function fxSql(target, tableAlias = "k") {
    if (target === "native") {
        return { join: "", wrap: (c) => c, resultCurrency: null };
    }
    return {
        // LEFT JOIN, not INNER: an inner join would silently drop rows whose month
        // has no rate, quietly shrinking the total. The COALESCE below turns a
        // missing rate into NULL instead, which propagates visibly to the metric.
        join: `
      LEFT JOIN \`${bigquery_1.PROJECT_ID}.ref.fx_rates\` fx
        ON fx.month_start   = DATE_TRUNC(${tableAlias}.date, MONTH)
       AND fx.from_currency = ${tableAlias}.currency
       AND fx.to_currency   = @displayCurrency`,
        // Rows already in the target currency need no rate and must not be dropped
        // for lacking one — hence the identity branch.
        wrap: (column) => `(${column} * IF(${tableAlias}.currency = @displayCurrency, 1, fx.rate))`,
        resultCurrency: target,
    };
}
/** Params every fx-aware query must bind. Merge into the query's own params. */
function fxParams(target) {
    return target === "native" ? {} : { displayCurrency: target };
}
/**
 * Which conversions are possible at all, for building the toggle's options.
 */
async function getSupportedPairs() {
    const rows = await (0, bigquery_1.query)(`SELECT from_currency, to_currency,
            COUNT(*) AS months, MAX(month_start) AS last_month
     FROM \`${bigquery_1.PROJECT_ID}.ref.fx_rates\`
     GROUP BY from_currency, to_currency`);
    return rows.map((r) => ({
        from: r.from_currency,
        to: r.to_currency,
        months: (0, coerce_1.num)(r.months) ?? 0,
        lastMonth: r.last_month?.value ?? null,
    }));
}
// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
/**
 * Format money. UI copy is English throughout, so `en-US` grouping is used for
 * every currency — the symbol changes, the separators don't.
 */
function formatMoney(value, currency, { compact = false } = {}) {
    if (value === null)
        return "—";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 1 : 0,
    }).format(value);
}
function formatNumber(value, { compact = false, decimals = 0 } = {}) {
    if (value === null)
        return "—";
    return new Intl.NumberFormat("en-US", {
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: decimals,
    }).format(value);
}
/** Percentages arrive as fractions (0.35), render as "35.0%". */
function formatPercent(value, { decimals = 1 } = {}) {
    if (value === null)
        return "—";
    return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
    }).format(value);
}
/** Ratios like MER / aMER: "4.2×". */
function formatRatio(value, { decimals = 2 } = {}) {
    if (value === null)
        return "—";
    return `${value.toFixed(decimals)}×`;
}
