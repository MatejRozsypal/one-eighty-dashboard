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
  /** Neutral clarification, not a warning. Rendered plain. */
  note?: string;
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
    note: "Ex-shipping and ex-tax. AOV incl. shipping is a different number.",
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
    note: "Merchandise only, ex-shipping.",
  },
  Payback: {
    title: "Customer payback",
    formula: "90-day gross profit per new customer / CAC",
    source: "Warehouse",
    note:
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
    note:
      "n/a means no target was set. Open months are judged against an even pace, closed months on the final figure.",
  },
  Growth: {
    title: "Growth",
    formula: "Revenue change vs previous month",
    source: "Warehouse",
    note:
      "Averages cover closed months in the range only. The current month is partial and excluded.",
  },

  // ── Paid section ─────────────────────────────────────────────────────────
  // Keys are the tile labels the Paid tabs print (pass as KpiTile `metricKey`).
  // Every figure is a sum over the range divided by a sum, never an average of
  // daily rates. Each tooltip stays at 40 words or fewer in total.
  nCAC: {
    title: "New-customer CAC",
    formula: "Paid spend / new customers",
    source: "Warehouse",
    limitation: "Paid spend only. Organic and email acquisition are not counted.",
  },
  "CAC (blended)": {
    title: "Blended CAC",
    formula: "Paid spend / all orders",
    source: "Warehouse",
    note: "Orders from returning customers count too, so it reads lower than new-customer CAC.",
  },
  "Link CTR": {
    title: "Link click-through rate",
    formula: "Link clicks / impressions",
    source: "Meta",
    note: "Only clicks to a destination count, not reactions or comments.",
  },
  "Cost / LPV": {
    title: "Cost per landing page view",
    formula: "Spend / landing page views",
    source: "Meta",
    note: "A view counts only once the page has loaded, so it runs below link clicks.",
  },
  "Cost / ATC": {
    title: "Cost per add to cart",
    formula: "Spend / add-to-cart events",
    source: "Meta",
    limitation: "Depends on the pixel firing. A tracking gap inflates it.",
  },
  "ATC to purchase": {
    title: "Add to cart to purchase",
    formula: "Purchases / add-to-cart events",
    source: "Meta",
    limitation: "Both counts are platform-reported, inside the platform's attribution window.",
  },
  "Hook rate": {
    title: "Hook rate",
    formula: "Video plays / impressions",
    source: "Meta",
    note: "Video ads only. Hold rate uses the same impressions.",
  },
  "Hold rate": {
    title: "Hold rate",
    formula: "ThruPlays / impressions",
    source: "Meta",
    note: "Video ads only. A ThruPlay is 15 seconds watched, or the whole video if shorter.",
  },
  "Avg daily frequency": {
    title: "Average daily frequency",
    formula: "Impressions / reach, summed over daily rows",
    source: "Meta",
    limitation: "The same person is counted again on each day, so this is below true period frequency.",
  },
  "Search IS": {
    title: "Search impression share",
    formula: "Impressions / eligible impressions",
    source: "Google Ads",
    note: "Search network only. Rows with no reported share are left out.",
  },
  "Lost IS (budget)": {
    title: "Lost impression share, budget",
    formula: "Impressions lost to budget / eligible impressions",
    source: "Google Ads",
    note: "Search network only.",
  },
  "Lost IS (rank)": {
    title: "Lost impression share, rank",
    formula: "Impressions lost to ad rank / eligible impressions",
    source: "Google Ads",
    note: "Search network only.",
  },
  "Brand share": {
    title: "Brand share of spend",
    formula: "Brand campaign spend / total spend",
    source: "Google Ads",
    note: "Campaigns are classed brand or non-brand by name and the client's brand terms.",
  },
  "Brand leakage": {
    title: "Brand leakage",
    formula: "Brand search-term spend in non-brand campaigns / search-term spend in non-brand campaigns",
    source: "Google Ads",
    limitation: "Needs the client's brand terms. A spelling not listed reads as non-brand.",
  },
  "Non-brand ROAS": {
    title: "Non-brand ROAS",
    formula: "Conversion value / spend, non-brand and Shopping or PMax campaigns",
    source: "Google Ads",
    note: "Leaves brand search out, which flatters blended ROAS.",
  },
  "Over-claim": {
    title: "Platform over-claim",
    formula: "Platform-reported value / GA4 revenue",
    source: "Platform and GA4",
    limitation: "Above 1.00x the platform claims more than GA4 sees. Attribution rules differ, so some gap is normal.",
  },
  "Tracking coverage": {
    title: "Tracking coverage",
    formula: "GA4 revenue / shop revenue",
    source: "GA4 and shop platform",
    limitation: "Shop revenue may include tax where GA4 does not, which lowers coverage.",
  },
};
