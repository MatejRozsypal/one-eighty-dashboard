/**
 * Markets: the shapes that cross from the query layer to the page.
 *
 * Pure (types and constants only), so client components can import it.
 *
 * The raw shapes mirror the build contract
 * (docs/sessions/2026-10-15/markets/CONTRACT.md) table by table:
 *
 *   DailySums    `mk_market_daily` summed over a date range, per market
 *   OrderExtras  `mk_market_orders` over the same range (order-grain figures
 *                the daily table cannot give: first-order GP, discount depth,
 *                full-price share, refunded orders, local currency, payments)
 *   Allocation   `mk_market_spend_daily` summed by allocation rule
 *   CohortRow    `mk_market_cohorts`, one row per first-order market x month
 *   ForecastRow  `mk_market_forecast`, latest run only
 *
 * Every money figure is in the client's base currency, ex VAT. A null is "not
 * measured" (the platform does not send it, or it is not ingested), never zero.
 * The demo fixture (lib/demo/markets.ts) produces exactly these shapes, so the
 * page derives its figures through the same code in demo and in production.
 */

/** Market code for orders with no country the data can place. */
export const MARKET_OTHER = "OTHER";
/** Spend the allocation rules could not place in any market (contract F3). */
export const MARKET_UNALLOCATED = "UNALLOCATED";

/** Cohort ages the warehouse reads, in days since the first order. */
export const COHORT_AGES = [30, 60, 90, 180, 365] as const;
export type CohortAge = (typeof COHORT_AGES)[number];
/** The ages the matrix and the verdict read. */
export const LIFETIME_AGES = [90, 180, 365] as const;
export type LifetimeAge = (typeof LIFETIME_AGES)[number];

export interface DailySums {
  orders: number;
  newCustomers: number;
  returningOrders: number;
  /** Null when the platform sends no list price (Shoptet). */
  grossSales: number | null;
  /** Null when discount amounts are not ingested (Shoptet). */
  discounts: number | null;
  /** Null when refund amounts are not ingested (Shopify before the payload fix, Shoptet). */
  refunds: number | null;
  netSales: number;
  netRevenue: number;
  newCustomerRevenue: number;
  returningRevenue: number;
  /** Net sales of first and repeat orders: the AOV base (contract amendment). Null on an old source. */
  newCustomerNetSales: number | null;
  returningNetSales: number | null;
  /** Gross profit and count of costed first orders: first-order GP per new customer. */
  newCustomerGrossProfit: number | null;
  newCustomerCostedOrders: number | null;
  /** Net sales of costed orders only: the COGS % base. */
  costedNetSales: number | null;
  /** Null when no order in the range is costed. */
  cogs: number | null;
  grossProfit: number | null;
  costedOrders: number;
  discountedOrders: number | null;
  codOrders: number | null;
  zeroShippingOrders: number | null;
  /** Null when the platform folds shipping into the order total (Shoptet). */
  shippingCharged: number | null;
  spend: number;
}

export interface PaymentShare {
  method: string;
  orders: number;
}

export interface OrderExtras {
  /** Gross profit of new-customer orders (first orders). Null when none is costed. */
  firstOrderGrossProfit: number | null;
  /** New-customer orders with COGS, the denominator of first-order GP per customer. */
  firstOrderCosted: number;
  /** Gross sales and discounts of discounted orders only (average depth). */
  discountedGross: number | null;
  discountedDiscounts: number | null;
  /** Net revenue of orders with no discount at all. */
  fullPriceRevenue: number | null;
  newGross: number | null;
  newDiscounts: number | null;
  returningGross: number | null;
  returningDiscounts: number | null;
  refundedOrders: number | null;
  /** SUM(net_revenue / fx_local_to_base): the period's net revenue in local currency. */
  localRevenue: number | null;
  /** The one local currency of the market's orders; null when it spans several. */
  localCurrency: string | null;
  /** Up to five payment methods by order count. */
  paymentMix: PaymentShare[];
}

export interface MarketPeriodRaw {
  market: string;
  sums: DailySums;
  extras: OrderExtras | null;
  /**
   * Order counts per day, the base a cost card is applied to (a card change
   * inside the range splits it). Absent: the period sums are used with the
   * card in effect on the last day of the range.
   */
  costDays?: CostDay[] | null;
}

/**
 * A market cost card: what one order in one market costs beyond COGS, typed by
 * the owner in Settings > Market costs (Postgres `market_cost_cards`, see
 * lib/markets/costStore.ts). A new `effectiveFrom` adds a card and keeps the
 * old one, so a range before the change is costed with the old rates.
 *
 * Every field is nullable: empty means "not stated", never zero. Money is in
 * the client's base currency, ex VAT.
 */
export interface CostCard {
  /** ISO-2 of a sold market, or OTHER for every country pooled into Other. */
  market: string;
  /** YYYY-MM-DD. The card applies from this day until the next card. */
  effectiveFrom: string;
  /** Carrier, packaging and pick-and-pack per order. */
  shipCostPerOrder: number | null;
  /** Payment processing as a share of net revenue (0.029 = 2.9 %). */
  payFeePct: number | null;
  /** Extra fee per cash-on-delivery order. */
  codFee: number | null;
  /** Handling per refunded order (return label, restocking). */
  returnCost: number | null;
  /** Fixed cost of running the market per month (local warehouse, support). */
  fixedMonthly: number | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** One day of one market: the counts a cost card multiplies. */
export interface CostDay {
  date: string;
  orders: number;
  /** Null when the payment method is not ingested. */
  codOrders: number | null;
  /** Null when refund amounts are not ingested. */
  refundedOrders: number | null;
  netRevenue: number;
}

/** `none` marks the UNALLOCATED rows (contract amendment). */
export type AllocationRule = "geo" | "campaign_name" | "client_default" | "pro_rata" | "none";
export type Allocation = Partial<Record<AllocationRule, number>>;

export interface MarketLifetimeRaw {
  firstOrderDate: string;
  orders: number;
}

export interface CohortRow {
  market: string;
  /** First day of the cohort month, YYYY-MM-01. */
  cohortMonth: string;
  customers: number;
  /**
   * Customers whose orders within 365 d are all costed. `gp` and `firstOrderGp`
   * are sums over these only, so GP per customer divides by this, never by
   * `customers` (contract amendment). Repeat, revenue and CAC use `customers`.
   */
  costedCustomers: number;
  /** Cumulative per cohort; null where the cohort has not reached the age yet. */
  repeatCustomers: Partial<Record<CohortAge, number | null>>;
  revenue: Partial<Record<CohortAge, number | null>>;
  gp: Partial<Record<CohortAge, number | null>>;
  /** Market spend inside the cohort month; null where spend history does not reach. */
  cohortSpend: number | null;
  firstOrderGp: number | null;
}

export type ForecastMethod = "multiplier_monthly" | "multiplier_quarterly" | "none";

export interface ForecastRow {
  market: string;
  /** For quarterly rows, the first month of the quarter. */
  cohortMonth: string;
  /** Costed customers the per-customer values use (null on an old source). */
  customers: number | null;
  asOfAgeDays: number;
  actualGpPerCustomer: number | null;
  forecastGp365PerCustomer: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  multiplier: number | null;
  nReferenceCohorts: number | null;
  method: ForecastMethod;
  reasonIfNone: string | null;
  runDate: string;
}

/** Orders pooled into OTHER, split back by country for Scouting. */
export interface CountryOrders {
  iso: string;
  orders: number;
  newCustomers: number;
  netRevenue: number;
  newCustomerNetSales: number;
}

/**
 * One row of `mart.market_scouting_signals` (migration 297): a country the
 * client does not sell to, with fixed windows (orders 365 d, GA4 90 d, latest
 * search snapshot). GA4 fields are null when the client has no GA4 at all
 * (`ga4Days90` null); search fields are null until core terms are confirmed.
 */
export interface ScoutSignalRow {
  iso: string;
  orders365: number;
  newCustomers365: number;
  /** Base currency, ex VAT. */
  netRevenue365: number;
  aovNew365: number | null;
  /** Days in the 90-day window with any GA4 data for the client; null = no GA4. */
  ga4Days90: number | null;
  sessions90: number | null;
  engagedSessions90: number | null;
  unpaidEngagedSessions90: number | null;
  addToCartSessions90: number | null;
  ga4Purchases90: number | null;
  /** Sum of the monthly volume of the confirmed core terms. */
  searchVolumeCore: number | null;
  searchTermsCore: number | null;
  searchAsOf: string | null;
}

/** One Meta CPM benchmark for one country (`ref.industry_benchmarks`, metric `meta_cpm`). */
export interface CpmBenchmark {
  /** ISO-2 country the benchmark is for. */
  iso: string;
  vertical: string;
  /** Per 1000 impressions, in `currency`. */
  value: number;
  currency: string | null;
  source: string;
  asOf: string;
}

/** Inputs of the opportunity index, read for one client. */
export interface ScoutingSignalsRaw {
  rows: ScoutSignalRow[];
  /** GA4 day coverage of the client in the 90-day window; null when GA4 is not connected. */
  ga4Days90: number | null;
  /** `ref.client_verticals` vertical; null when the client has none. */
  vertical: string | null;
  /** Meta CPM rows for the client's vertical and the fallback; null when no Meta CPM benchmark is loaded at all. */
  cpm: CpmBenchmark[] | null;
}

/** Where the page's numbers came from. */
export type MarketsSource = "demo" | "mart_qa" | "mart";

export interface MarketsRaw {
  source: MarketsSource;
  baseCurrency: string;
  /** Shop platform ("shopify" | "woocommerce" | "shoptet"), for the n/a reasons. */
  platform: string | null;
  /** The client's home market (ISO-2), the reference for "vs home" rules. */
  homeMarket: string | null;
  /** Last complete day in the data; cohorts and maturity are read as of it. */
  lastCompleteDay: string;
  range: { from: string; to: string };
  compareRange: { from: string; to: string } | null;
  current: MarketPeriodRaw[];
  previous: MarketPeriodRaw[] | null;
  /** Allocation of the current period's spend, per market. */
  allocation: Record<string, Allocation>;
  lifetime: Record<string, MarketLifetimeRaw>;
  /**
   * The client's configured markets (`mk_client_markets`): the sold set. Null
   * when no config exists; then sold = spend in the trailing 365 days, the
   * home market, or at least 5% of net revenue.
   */
  configuredMarkets: string[] | null;
  /** Local currency per configured market. */
  localCurrencyOf: Record<string, string>;
  /** Markets with paid spend in the trailing 365 days. */
  spendMarkets365: string[];
  /** Days in each range with no spend data at all for the client (ad history not started). */
  spendGapDays: { current: number; previous: number | null };
  /** Countries inside OTHER, current range (empty when the source has no country column). */
  otherCountries: CountryOrders[];
  cohorts: CohortRow[];
  forecast: ForecastRow[];
  /** Opportunity index inputs; null when the signals view cannot be read. */
  scoutingSignals: ScoutingSignalsRaw | null;
  /**
   * Every cost card of the client, all markets, all effective dates. Empty or
   * absent: CM2 and CM3 are n/a and the verdicts run on CM1.
   */
  costCards?: CostCard[];
}
