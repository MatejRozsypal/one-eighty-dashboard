/**
 * Metric definitions — the content behind every ⓘ tooltip.
 *
 * Sourced from METRICS.md. The `limitation` field is the important one: it's
 * what stops someone quoting a figure to a client that's 3% overstated because
 * refunds aren't netted yet. A dashboard that shows where it's wrong is more
 * trustworthy than one that doesn't, so limitations are surfaced, not buried.
 *
 * Keep this in sync with METRICS.md. If a formula changes there, it changes here.
 */

export interface MetricDefinition {
  /** Full name, spelled out. */
  title: string;
  /** The formula, in warehouse column names. */
  formula: string;
  /** Where the number comes from. */
  source: string;
  /** Known caveat. Rendered with a warning marker when present. */
  limitation?: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  Revenue: {
    title: "Revenue",
    formula: "net_sales + shipping_revenue",
    source: "Shop platform, ex-tax",
    limitation:
      "Refunds are not netted yet — overstated by roughly 3% (~$6k/month on Dobias).",
  },
  CM1: {
    title: "Contribution margin 1",
    formula: "revenue − COGS − other CM1 costs",
    source: "Warehouse · mart_daily_kpis",
    limitation:
      "Other CM1 costs (inbound freight, duties, packaging, payment fees) are hardcoded to zero.",
  },
  CM2: {
    title: "Contribution margin 2",
    formula: "cm1 − fulfilment_cost",
    source: "Warehouse · mart_daily_kpis",
    limitation:
      "Fulfilment is hardcoded to zero, so CM2 is identical to CM1 today.",
  },
  CM3: {
    title: "Contribution margin 3",
    formula: "revenue − COGS − fulfilment − paid spend",
    source: "Warehouse · mart_daily_kpis",
    limitation:
      "Fulfilment and other CM1 costs are hardcoded to zero, so CM3 is currently optimistic.",
  },
  "CM3 %": {
    title: "CM3 margin",
    formula: "cm3 / revenue",
    source: "Warehouse",
    limitation:
      "Manami's revenue includes VAT (Shoptet does not split it cleanly), so its CM% is not comparable to Dobias's.",
  },
  "Paid spend": {
    title: "Paid media spend",
    formula: "meta_spend + google_spend",
    source: "Platform-reported",
    limitation:
      "Platform truth for spend; revenue is shop-reported, so this is not the platforms' own ROAS.",
  },
  MER: {
    title: "Marketing efficiency ratio",
    formula: "revenue / paid_spend",
    source: "Warehouse",
    limitation:
      "Blended — it moves with the returning-customer base, not just with acquisition.",
  },
  aMER: {
    title: "Acquisition MER",
    formula: "new_customer_revenue / paid_spend",
    source: "Warehouse",
    limitation:
      "New vs returning is derived from a 36-month window, not lifetime history.",
  },
  CAC: {
    title: "Customer acquisition cost",
    formula: "paid_spend / new_customer_orders",
    source: "Warehouse",
    limitation:
      "Counts paid spend only — organic and email acquisition are not in the denominator.",
  },
  "AOV (net)": {
    title: "Average order value (net)",
    formula: "net_sales / orders",
    source: "Shop platform",
    limitation:
      "Ex-shipping, ex-tax — this is the version that reconciles against Shopify. AOV incl. shipping is a different number and lives on Orders.",
  },
  "New / Ret. orders": {
    title: "New vs returning orders",
    formula: "orders split by is_returning_customer",
    source: "Warehouse",
    limitation:
      "Derived from a 36-month window — customers whose first order predates it are misclassified as new.",
  },
  LTV: {
    title: "Lifetime value",
    formula: "AVG(lifetime_revenue) per customer",
    source: "Warehouse · mart_customer_lifetime",
    limitation:
      "36-month window, not true all-time. Customers who first ordered before the window read as new.",
  },
  LTGP: {
    title: "Lifetime gross profit",
    formula: "AVG(lifetime_revenue − lifetime COGS) per customer",
    source: "Warehouse · mart_customer_lifetime",
    limitation: "Same 36-month window limit as LTV.",
  },
  EBITDA: {
    title: "EBITDA (estimated)",
    formula: "cm3 − revenue × 0.30",
    source: "Warehouse + assumption",
    limitation:
      "The 30% OpEx figure is hardcoded, not measured. Treat the level as indicative and the trend as meaningful.",
  },
};

/**
 * Assumed operating expense ratio used for the EBITDA estimate.
 *
 * Lives here rather than in SQL because it is an assumption, not data. When
 * `ref.clients.opex_pct` lands (it's on the roadmap), this constant goes away
 * and the value comes from the registry per client.
 */
export const ASSUMED_OPEX_RATE = 0.3;

/**
 * Warehouse-wide caveats, shown in full on the Data Health screen.
 *
 * Each also appears in the tooltip of the metric it affects — this list is the
 * single place they're maintained.
 */
export const KNOWN_CAVEATS: Array<{ title: string; body: string }> = [
  {
    title: "Refunds are not netted from revenue",
    body: "Shopify nets returns from net sales; the warehouse does not yet. Net sales is overstated by roughly 3% (~$6k/month on Dobias), and that cascades into CM1, CM2 and CM3 by the same amount.",
  },
  {
    title: "COGS uses current cost, not cost at order time",
    body: "Shopify snapshots an item's cost when the order is placed. The warehouse re-costs from the latest products table, which drifts about $4–5k/month on Dobias as supplier prices move.",
  },
  {
    title: "Order dates are UTC, not shop timezone",
    body: "Shopify's own dashboard uses the shop's timezone. Comparing like-for-like date ranges shows roughly 14 orders of drift per month.",
  },
  {
    title: "Manami's revenue includes VAT",
    body: "Shoptet doesn't expose a clean shipping and tax breakdown, so Manami's revenue is gross of VAT. Its contribution margin percentages are therefore not directly comparable to Dobias's.",
  },
  {
    title: "New vs returning uses a 36-month window",
    body: "A customer whose first-ever order predates the window is flagged as new on their first in-window order. This understates returning customers and, with them, the true repeat rate.",
  },
  {
    title: "Two cost lines are placeholders",
    body: "Other CM1 costs (inbound freight, duties, packaging, payment fees) and fulfilment (shipping, warehousing, returns) are both hardcoded to zero. CM1 and CM2 are identical until they're wired.",
  },
];
