/**
 * Cohort grid — retention and value by months since first order.
 *
 * Reads `mart.mart_customer_cohort_grid`, which carries counts and sums only.
 * Every metric is derived here rather than in SQL, for two reasons: the mart's
 * columns are already aggregates and re-aggregating them is what BigQuery
 * rejects once it inlines a view, and switching metric shouldn't cost a query
 * when the whole grid is ~1,500 rows.
 *
 * ── Markets are additive ────────────────────────────────────────────────────
 * A customer belongs to the market of their first order, for life, so cohort
 * sizes and active counts sum cleanly across markets. Filtering is a subset of
 * one fetch, not a re-query — and the market list always reflects *all* markets
 * so a filter can never hide the option to undo itself.
 *
 * ── The denominator is the whole cohort, not the survivors ──────────────────
 * Revenue per customer divides by everyone who ever joined the cohort, not by
 * whoever was still active that month. Dividing by survivors makes a cohort
 * look better the more of it churns, which inverts the thing you are measuring.
 * AOV is the exception and says so: it is per order, so its denominator is
 * orders placed.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, isoDate, safeDiv } from "@/lib/coerce";

export type CohortMetric =
  | "retention"
  | "activeCustomers"
  | "revenuePerCustomer"
  | "cumulativeRevenuePerCustomer"
  | "grossProfitPerCustomer"
  | "aov"
  | "ordersPerCustomer";

export type CellFormat = "percent" | "money" | "number" | "ratio";

export const COHORT_METRICS: Array<{
  value: CohortMetric;
  label: string;
  format: CellFormat;
  blurb: string;
  /** True when the value accumulates across offsets rather than standing alone. */
  cumulative?: boolean;
}> = [
  {
    value: "retention",
    label: "Retention rate",
    format: "percent",
    blurb: "Share of the cohort that ordered in that month.",
  },
  {
    value: "activeCustomers",
    label: "Active customers",
    format: "number",
    blurb: "How many of the cohort ordered in that month.",
  },
  {
    value: "revenuePerCustomer",
    label: "Revenue per customer",
    format: "money",
    blurb: "That month's revenue ÷ everyone who joined the cohort.",
  },
  {
    value: "cumulativeRevenuePerCustomer",
    label: "Cumulative LTV",
    format: "money",
    blurb: "Revenue per customer, accumulated — the LTV curve.",
    cumulative: true,
  },
  {
    value: "grossProfitPerCustomer",
    label: "Cumulative LTGP",
    format: "money",
    blurb: "Gross profit per customer, accumulated. Shopify has no equivalent.",
    cumulative: true,
  },
  {
    value: "aov",
    label: "Average order value",
    format: "money",
    blurb: "Revenue ÷ orders placed that month — per order, not per customer.",
  },
  {
    value: "ordersPerCustomer",
    label: "Orders per active customer",
    format: "ratio",
    blurb: "Orders ÷ the customers who actually ordered that month.",
  },
];

export function metricSpec(metric: CohortMetric) {
  return COHORT_METRICS.find((m) => m.value === metric) ?? COHORT_METRICS[0];
}

export interface MarketOption {
  code: string;
  customers: number;
}

export interface CohortRow {
  month: string;
  customers: number;
  /** Index = month offset. Null where the cohort hasn't lived that long. */
  cells: Array<number | null>;
}

export interface CohortGrid {
  /** "country" for Shopify, "currency" for Shoptet — the UI must say which. */
  marketKind: "country" | "currency";
  /** Every market, regardless of the current filter. */
  markets: MarketOption[];
  rows: CohortRow[];
  /** Weighted across every cohort — the summary row. */
  allCohorts: Array<number | null>;
  maxOffset: number;
  totalCustomers: number;
}

interface Cell {
  active: number;
  orders: number;
  revenue: number | null;
  grossProfit: number | null;
}

const empty = (): Cell => ({ active: 0, orders: 0, revenue: null, grossProfit: null });

function add(target: Cell, r: Record<string, unknown>): void {
  target.active += num(r.active_customers) ?? 0;
  target.orders += num(r.orders) ?? 0;
  const rev = num(r.revenue);
  if (rev !== null) target.revenue = (target.revenue ?? 0) + rev;
  const gp = num(r.gross_profit);
  if (gp !== null) target.grossProfit = (target.grossProfit ?? 0) + gp;
}

function valueOf(
  metric: CohortMetric,
  cell: Cell,
  cohortSize: number
): number | null {
  switch (metric) {
    case "retention":
      return safeDiv(cell.active, cohortSize);
    case "activeCustomers":
      return cell.active;
    case "revenuePerCustomer":
    case "cumulativeRevenuePerCustomer":
      return cell.revenue === null ? null : safeDiv(cell.revenue, cohortSize);
    case "grossProfitPerCustomer":
      return cell.grossProfit === null
        ? null
        : safeDiv(cell.grossProfit, cohortSize);
    case "aov":
      return cell.revenue === null ? null : safeDiv(cell.revenue, cell.orders);
    case "ordersPerCustomer":
      return safeDiv(cell.orders, cell.active);
  }
}

export async function getCohortGrid(
  clientId: string,
  currency: string,
  {
    metric = "retention",
    markets,
    maxOffset = 24,
    monthsBack = 12,
  }: {
    metric?: CohortMetric;
    markets?: string[];
    maxOffset?: number;
    /** Cohort months to include, counting back from this one. 0 = everything. */
    monthsBack?: number;
  } = {}
): Promise<CohortGrid> {
  const rows = await query<Record<string, unknown>>(
    `SELECT cohort_month, market, market_kind, month_offset,
            cohort_customers, active_customers, orders, revenue, gross_profit
     FROM \`${PROJECT_ID}.mart.mart_customer_cohort_grid\`
     WHERE client_id = @clientId AND currency = @currency
       AND month_offset <= @maxOffset
       AND is_elapsed
       AND (@monthsBack = 0 OR cohort_month >= DATE_TRUNC(
             DATE_SUB(CURRENT_DATE(), INTERVAL @monthsBack MONTH), MONTH))
     ORDER BY cohort_month, month_offset`,
    { clientId, currency, maxOffset, monthsBack }
  );

  let marketKind: "country" | "currency" = "country";
  const selected = markets && markets.length > 0 ? new Set(markets) : null;

  // Cohort size is per (cohort, market) and repeats on every offset row, so it
  // is banked once per pair rather than summed.
  const sizeSeen = new Set<string>();
  const marketTotals = new Map<string, number>();
  const cohortSize = new Map<string, number>();
  const grid = new Map<string, Map<number, Cell>>();
  const totals = new Map<number, Cell>();

  for (const r of rows) {
    const month = isoDate(r.cohort_month as never) ?? "";
    const market = String(r.market ?? "");
    const offset = Number(r.month_offset);
    marketKind = (String(r.market_kind) as "country" | "currency") || "country";

    const pair = `${month}|${market}`;
    if (!sizeSeen.has(pair)) {
      sizeSeen.add(pair);
      const size = num(r.cohort_customers) ?? 0;
      // Market totals cover everything, so the filter UI keeps every option.
      marketTotals.set(market, (marketTotals.get(market) ?? 0) + size);
      if (!selected || selected.has(market)) {
        cohortSize.set(month, (cohortSize.get(month) ?? 0) + size);
      }
    }

    if (selected && !selected.has(market)) continue;

    if (!grid.has(month)) grid.set(month, new Map());
    const row = grid.get(month)!;
    if (!row.has(offset)) row.set(offset, empty());
    add(row.get(offset)!, r);

    if (!totals.has(offset)) totals.set(offset, empty());
    add(totals.get(offset)!, r);
  }

  const spec = metricSpec(metric);

  const cohortRows: CohortRow[] = [...grid.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((month) => {
      const size = cohortSize.get(month) ?? 0;
      const row = grid.get(month)!;
      const lastElapsed = Math.max(...row.keys());

      let running = 0;
      const cells: Array<number | null> = [];
      for (let offset = 0; offset <= maxOffset; offset++) {
        // Beyond the cohort's own lifetime there is no cell at all — a zero
        // there would read as total churn rather than as "not yet".
        if (offset > lastElapsed) {
          cells.push(null);
          continue;
        }
        const cell = row.get(offset) ?? empty();
        const v = valueOf(metric, cell, size);
        if (spec.cumulative) {
          running += v ?? 0;
          cells.push(running);
        } else {
          cells.push(v);
        }
      }
      return { month, customers: size, cells };
    });

  const totalCustomers = [...cohortSize.values()].reduce((a, b) => a + b, 0);

  let runningAll = 0;
  const allCohorts: Array<number | null> = [];
  for (let offset = 0; offset <= maxOffset; offset++) {
    const cell = totals.get(offset);
    if (!cell) {
      allCohorts.push(null);
      continue;
    }
    // Weighted by the cohorts that have actually reached this offset — using
    // every cohort would divide by customers who cannot possibly have appeared.
    const eligible = cohortRows
      .filter((r) => r.cells[offset] !== null)
      .reduce((sum, r) => sum + r.customers, 0);
    const v = valueOf(metric, cell, eligible);
    if (spec.cumulative) {
      runningAll += v ?? 0;
      allCohorts.push(runningAll);
    } else {
      allCohorts.push(v);
    }
  }

  return {
    marketKind,
    markets: [...marketTotals.entries()]
      .map(([code, customers]) => ({ code, customers }))
      .sort((a, b) => b.customers - a.customers),
    rows: cohortRows,
    allCohorts,
    maxOffset,
    totalCustomers,
  };
}
