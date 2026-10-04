/**
 * Metric definitions: the content behind every (i) tooltip.
 *
 * Sourced from METRICS.md. The `limitation` field is the important one: it is
 * what stops someone quoting a figure that carries a known gap. A dashboard
 * that shows where it is wrong is more trustworthy than one that does not.
 *
 * Copy policy: tenant-neutral (no client names, no client figures), no table
 * or column names, at most 40 words per tooltip, no dashes. Pages look a
 * definition up by the metric's label (MetricCard does it automatically) or
 * pass one to `MetricTooltip` directly.
 *
 * Keep this in sync with METRICS.md. If a formula changes there, it changes here.
 */

export interface MetricDefinition {
  /** Full name, spelled out. */
  title: string;
  /** The formula, in plain words. */
  formula: string;
  /** Where the number comes from. */
  source: string;
  /** Known caveat. Rendered with a warning marker when present. */
  limitation?: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  Revenue: {
    title: "Revenue",
    formula: "Net sales + shipping",
    source: "Shop platform, ex-tax",
    limitation: "Refunds are not netted on every platform, so revenue can be slightly high.",
  },
  "Net sales": {
    title: "Net sales",
    formula: "Merchandise after discounts",
    source: "Shop platform",
    limitation: "Ex-shipping and ex-tax. Reconciles against the shop platform.",
  },
  CM1: {
    title: "Contribution margin 1",
    formula: "Revenue - COGS - other CM1 costs",
    source: "Warehouse",
    limitation:
      "Other CM1 costs use the per-order rate set in Settings. Until it is set, none are deducted.",
  },
  CM2: {
    title: "Contribution margin 2",
    formula: "CM1 - fulfilment",
    source: "Warehouse",
    limitation:
      "Fulfilment uses the per-order rate set in Settings. Until it is set, CM2 equals CM1.",
  },
  CM3: {
    title: "Contribution margin 3",
    formula: "Revenue - COGS - fulfilment - paid spend",
    source: "Warehouse",
    limitation:
      "Excludes fixed costs, salaries and platform fees. Spend is platform-reported, revenue is shop-reported.",
  },
  "CM3 %": {
    title: "CM3 margin",
    formula: "CM3 / revenue",
    source: "Warehouse",
    limitation: "Shoptet revenue includes VAT, so CM% is not comparable to ex-tax shops.",
  },
  "Paid spend": {
    title: "Paid media spend",
    formula: "Meta + Google spend",
    source: "Platform-reported",
    limitation: "Revenue is shop-reported, so this is not a platform ROAS.",
  },
  MER: {
    title: "Marketing efficiency ratio",
    formula: "Revenue / paid spend",
    source: "Warehouse",
    limitation: "Blended. It moves with the returning-customer base, not just acquisition.",
  },
  aMER: {
    title: "Acquisition MER",
    formula: "New customer revenue / paid spend",
    source: "Warehouse",
    limitation: "New vs returning is derived from a 60-month window, not lifetime history.",
  },
  CAC: {
    title: "Customer acquisition cost",
    formula: "Paid spend / new customers",
    source: "Warehouse",
    limitation: "Paid spend only. Organic and email acquisition are not counted.",
  },
  "AOV (net)": {
    title: "Average order value (net)",
    formula: "Net sales / orders",
    source: "Shop platform",
    limitation: "Ex-shipping and ex-tax. AOV incl. shipping is a different number.",
  },
  "AOV incl. shipping": {
    title: "AOV including shipping",
    formula: "Revenue / orders",
    source: "Shop platform",
  },
  "New / Ret. orders": {
    title: "New vs returning orders",
    formula: "Orders split by customer type",
    source: "Warehouse",
    limitation: "Customers whose first order predates the 60-month window read as new.",
  },
  LTV: {
    title: "Lifetime value",
    formula: "Average lifetime revenue per customer",
    source: "Warehouse",
    limitation: "60-month window, not all-time. Older first orders read as new.",
  },
  LTGP: {
    title: "Lifetime gross profit",
    formula: "Average lifetime revenue - COGS per customer",
    source: "Warehouse",
    limitation: "Same 60-month window as LTV.",
  },
  EBITDA: {
    title: "EBITDA (estimated)",
    formula: "CM3 - revenue x stated OpEx rate",
    source: "Warehouse + Settings",
    limitation: "The OpEx rate is set in Settings, not measured. The trend is more reliable than the level.",
  },
  "Gross margin": {
    title: "Gross margin",
    formula: "(Net sales - COGS) / net sales",
    source: "Warehouse",
    limitation: "Merchandise only, ex-shipping.",
  },
  Payback: {
    title: "Customer payback",
    formula: "90-day gross profit per new customer / CAC",
    source: "Warehouse",
    limitation:
      "Uses customers whose 90 days have closed, over 12 months. Blended CAC covers the same 12 months, so it differs from the CAC card.",
  },
  Fulfilment: {
    title: "Fulfilment",
    formula: "Orders x per-order rate",
    source: "Settings",
    limitation: "Outbound shipping and warehousing are not measured. Set a rate in Settings to fill this step.",
  },
  Attainment: {
    title: "Attainment",
    formula: "Actual / target",
    source: "Targets in Settings",
    limitation:
      "n/a means no target was set. Open months are judged against an even pace, closed months on the final figure.",
  },
  Growth: {
    title: "Growth",
    formula: "Revenue change vs previous month",
    source: "Warehouse",
    limitation:
      "Averages cover closed months in the range only. The current month is partial and excluded.",
  },
};

/**
 * Warehouse-wide caveats, listed on the Data Health screen.
 *
 * Kept only because Data Health still imports it; the sprint removes that
 * list and this export with it. Tenant-neutral, no figures.
 */
export const KNOWN_CAVEATS: Array<{ title: string; body: string }> = [
  {
    title: "Refunds are not netted from revenue",
    body: "Revenue is overstated by the refunded share on platforms that do not net returns, and that carries into CM1, CM2 and CM3.",
  },
  {
    title: "COGS uses current cost",
    body: "Cost is taken from the latest product costs, not the cost at order time, so it drifts as supplier prices move.",
  },
  {
    title: "Order dates are UTC",
    body: "Dates use UTC, not the shop timezone, so a day can differ slightly from the shop's own dashboard.",
  },
  {
    title: "Shoptet revenue includes VAT",
    body: "Shoptet does not split VAT out, so its margin percentages are not comparable to ex-tax shops.",
  },
  {
    title: "New vs returning uses a 60-month window",
    body: "A customer whose first order predates the window is flagged as new on their first in-window order.",
  },
  {
    title: "Cost lines come from Settings",
    body: "Other CM1 costs and fulfilment are per-order rates set in Settings. Until set, CM1 and CM2 do not include them.",
  },
];
