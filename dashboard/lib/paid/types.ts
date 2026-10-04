/**
 * Shared row types for the Paid section.
 *
 * Each interface mirrors the column contract of one mart in
 * `infra/bigquery/240_paid_meta_marts.sql`, `242_gads_marts.sql` and
 * `243_ga4_sessions.sql`, with field names camelCased at the query boundary.
 * Query modules coerce with `num` / `isoDate` from `lib/coerce.ts`, so every
 * number is `number | null` and every date is an ISO `YYYY-MM-DD` string:
 * never a raw BigQuery value.
 *
 * Pure types, no imports of server code: client components may import this.
 *
 * ── Rules the types encode ──────────────────────────────────────────────────
 * - Only summable components live here. There is no CTR, CPC, ROAS or
 *   frequency column: every rate is `ratioOfSums` over rows (`lib/paid/math.ts`).
 * - `null` means "not measured" and renders "n/a". It is never zero.
 * - Money in `spend` / `revenue` style fields is in the AD ACCOUNT currency
 *   (`currency`). The `*ClientCcy` pair is the same money in the client's
 *   trading currency, null when a month has no FX rate.
 * - Ids are strings.
 */

/** The four tabs, in display order. */
export type PaidTabKey = "overview" | "meta" | "google" | "ga4";

/** Time bucket for a series: chosen from the range length by `bucketGrain`. */
export type Grain = "day" | "week" | "month";

/** Funnel stage derived from the campaign name (Meta). */
export type FunnelStage = "prospecting" | "retargeting" | "retention" | "unclassified";

/** Campaign brand class (Google). */
export type BrandClass = "brand" | "non_brand" | "shopping_pmax" | "other";

/** Money pair every ad-platform row carries. */
export interface MoneyCcy {
  /** Ad account currency (`meta_currency` or `gads_currency`). */
  currency: string | null;
  /** Client trading currency. */
  clientCurrency: string | null;
}

// ── Meta ────────────────────────────────────────────────────────────────────

/** `mart_meta_campaign_dim`: one row per (client, campaign). */
export interface MetaCampaignDim {
  clientId: string;
  campaignId: string;
  campaignName: string | null;
  firstDate: string | null;
  lastDate: string | null;
  funnelStage: FunnelStage;
  /** Upper-case market code, null when no rule matched ("Unknown" in the UI). */
  market: string | null;
  classifiedBy: "override" | "rule" | "none";
  marketClassifiedBy: "override" | "rule" | "none";
}

/**
 * `mart_meta_campaign_perf`: one row per (client, campaign, date).
 * The `*_per_day` columns of the mart are deliberately absent.
 */
export interface MetaCampaignDaily extends MoneyCcy {
  clientId: string;
  date: string;
  campaignId: string;
  campaignName: string | null;
  adAccountId: string | null;
  spend: number | null;
  /** Platform-attributed purchase value (`revenue` in the mart). */
  revenue: number | null;
  purchases: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  addToCart: number | null;
  initiateCheckout: number | null;
  landingPageViews: number | null;
  linkClicks: number | null;
  videoViews: number | null;
  viewContent: number | null;
  addPaymentInfo: number | null;
  funnelStage: FunnelStage;
  market: string | null;
  spendClientCcy: number | null;
  revenueClientCcy: number | null;
}

/**
 * `mart_meta_ad_perf`: one row per (client, ad, date).
 * The outbound and video quartile columns stay null until the ad-insights
 * ingest requests them: null is "not ingested" (hide the column), never zero.
 */
export interface MetaAdDaily {
  clientId: string;
  date: string;
  adId: string;
  adName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adAccountId: string | null;
  currency: string | null;
  spend: number | null;
  revenue: number | null;
  purchases: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  addToCart: number | null;
  initiateCheckout: number | null;
  landingPageViews: number | null;
  linkClicks: number | null;
  videoViews: number | null;
  /** Video plays: the numerator of hook rate. */
  videoPlayActions: number | null;
  /** ThruPlays: the numerator of hold rate. */
  videoThruplays: number | null;
  outboundClicks: number | null;
  uniqueOutboundClicks: number | null;
  videoP25Watched: number | null;
  videoP50Watched: number | null;
  videoP75Watched: number | null;
  videoP95Watched: number | null;
  videoP100Watched: number | null;
  video30sWatched: number | null;
  viewContent: number | null;
  addPaymentInfo: number | null;
}

// ── Google Ads ──────────────────────────────────────────────────────────────

/** `mart_gads_campaign_dim`: one row per (client, campaign), latest attributes. */
export interface GadsCampaignDim {
  clientId: string;
  campaignId: string;
  campaignName: string | null;
  channelType: string | null;
  channelSubType: string | null;
  status: string | null;
  servingStatus: string | null;
  biddingStrategyType: string | null;
  targetRoas: number | null;
  /** Daily budget in account currency. */
  budgetPerDay: number | null;
  budgetShared: boolean | null;
  brandClass: BrandClass;
  classifiedBy: "override" | "rule" | "none";
  market: string | null;
  currency: string | null;
}

/**
 * Impression share components. Stored as impression counts so any set of rows
 * re-aggregates correctly: Search IS = sum(isImpressions) / sum(eligibleImpressions).
 * Null on rows where the share is not reported (not zero).
 */
export interface ImpressionShareComponents {
  isImpressions: number | null;
  eligibleImpressions: number | null;
  lostBudgetImpressions: number | null;
  lostRankImpressions: number | null;
  topImpressions: number | null;
  /** Denominator of top IS: Shopping rows are excluded from both sums. */
  topEligibleImpressions: number | null;
  absTopImpressions: number | null;
  clickShareClicks: number | null;
  eligibleClicks: number | null;
}

/** `mart_gads_campaign_daily`: campaign x date x network (device summed away). */
export interface GadsCampaignDaily extends ImpressionShareComponents {
  clientId: string;
  date: string;
  campaignId: string;
  adNetworkType: string | null;
  campaignName: string | null;
  channelType: string | null;
  brandClass: BrandClass | null;
  market: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  /** The account's primary-conversion definition. */
  conversions: number | null;
  conversionsValue: number | null;
  viewThroughConversions: number | null;
  /** Purchase-category conversions only. */
  purchases: number | null;
  purchaseValue: number | null;
  spendClientCcy: number | null;
  conversionsValueClientCcy: number | null;
  purchaseValueClientCcy: number | null;
  currency: string | null;
  clientCurrency: string | null;
}

/** `mart_gads_campaign_device_daily`: campaign x date x device. */
export interface GadsCampaignDeviceDaily {
  clientId: string;
  date: string;
  campaignId: string;
  device: string | null;
  campaignName: string | null;
  channelType: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionsValue: number | null;
  spendClientCcy: number | null;
  conversionsValueClientCcy: number | null;
  currency: string | null;
  clientCurrency: string | null;
}

/** `mart_gads_adgroup_daily`: campaign x ad group x date. */
export interface GadsAdGroupDaily {
  clientId: string;
  date: string;
  campaignId: string;
  adGroupId: string;
  adGroupName: string | null;
  adGroupType: string | null;
  adGroupStatus: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionsValue: number | null;
}

/** `mart_gads_search_terms_daily`. Brand leakage is derived from `isBrand` and `campaignBrandClass`. */
export interface GadsSearchTermDaily {
  clientId: string;
  date: string;
  campaignId: string;
  adGroupId: string;
  searchTerm: string | null;
  matchType: string | null;
  termStatus: string | null;
  keywordCriterion: string | null;
  isBrand: boolean;
  campaignBrandClass: BrandClass | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionsValue: number | null;
}

/** `mart_gads_keywords_daily`. Impressions come from URL-click rows only (see the mart header). */
export interface GadsKeywordDaily {
  clientId: string;
  date: string;
  campaignId: string;
  adGroupId: string;
  criterionId: string;
  keywordText: string | null;
  matchType: string | null;
  qualityScore: number | null;
  predictedCtr: string | null;
  creativeQuality: string | null;
  landingPageQuality: string | null;
  isBrand: boolean;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionsValue: number | null;
}

/** `mart_gads_products_daily`: campaign x date x shopping item. */
export interface GadsProductDaily {
  clientId: string;
  date: string;
  campaignId: string;
  itemId: string | null;
  channelType: string | null;
  brand: string | null;
  productTypeL1: string | null;
  productTypeL2: string | null;
  categoryL1: string | null;
  categoryL2: string | null;
  customLabel0: string | null;
  customLabel1: string | null;
  customLabel2: string | null;
  productCountry: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversionsValue: number | null;
}

// ── GA4 ─────────────────────────────────────────────────────────────────────

/** Who the session is attributed to. `unattributed` rows carry purchases but never sessions. */
export type Ga4Platform = "meta" | "google" | "other_paid" | "non_paid" | "unattributed";

/**
 * `mart_ga4_sessions_daily`. Money is already in the client currency.
 * `sessionsFxMissing` counts purchase sessions whose revenue is null for lack
 * of an FX rate: when it is above zero the revenue figure is partial.
 */
export interface Ga4SessionsDaily {
  clientId: string;
  date: string;
  channelGroup: string;
  platform: Ga4Platform;
  source: string | null;
  medium: string | null;
  campaignName: string | null;
  landingPath: string | null;
  device: string | null;
  sessions: number | null;
  engagedSessions: number | null;
  sessionsViewItem: number | null;
  sessionsAtc: number | null;
  sessionsCheckout: number | null;
  sessionsPurchase: number | null;
  purchases: number | null;
  revenue: number | null;
  sessionsFxMissing: number | null;
  currency: string | null;
}

// ── UI-level shapes ─────────────────────────────────────────────────────────

/** One summed numerator and denominator pair, kept so a parent can re-aggregate. */
export interface RatioParts {
  numerator: number | null;
  denominator: number | null;
}
