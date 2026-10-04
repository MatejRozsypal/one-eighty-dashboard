/**
 * Paid > Google tab: queries over the Google Ads marts.
 *
 * ── What every function here follows ────────────────────────────────────────
 * - Only summable components leave the warehouse. There is no CTR, CPC, ROAS
 *   or impression-share column in any result: the page derives each rate from
 *   summed components (`lib/paid/math.ts`), so a rate over any set of rows is
 *   always SUM(numerator) / SUM(denominator).
 * - Impression share re-aggregates only through eligible-impression
 *   components (`isImpressions / eligibleImpressions`). Never averaged.
 * - Conversions are the purchase category (`purchases`, `purchase_value`) on
 *   the campaign mart. The ad group, search term, keyword and product marts
 *   carry the account's primary conversion definition only; both accounts count
 *   purchases alone today, so the figures agree.
 * - Money is in the Google Ads account currency. Data ends yesterday: the marts
 *   are bounded to `date < CURRENT_DATE()` and the picker clamps to yesterday.
 * - Every read is `client_id = @clientId AND date BETWEEN ...`, so the date
 *   filter prunes partitions.
 * - Current and comparison periods come from one query (`scanBounds` plus a
 *   CASE on the date), never two round trips.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import { scanBounds, type DateRange, type ResolvedPeriod } from "@/lib/period";
import { isDemo } from "@/lib/demo/client";
import type { BrandClass, ImpressionShareComponents } from "@/lib/paid/types";
import {
  demoAdGroups,
  demoCampaignAgg,
  demoCoverage,
  demoDevices,
  demoKeywords,
  demoLeakage,
  demoPmaxSplit,
  demoProducts,
  demoSearchTerms,
} from "@/lib/demo/paidGoogle";

const MART = `${PROJECT_ID}.mart`;

// ── Result shapes ───────────────────────────────────────────────────────────

/** Summed components for one campaign (or any set of campaigns) in one period. */
export interface GadsMetrics extends ImpressionShareComponents {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  /** Purchase-category conversions. */
  conversions: number | null;
  /** Purchase-category conversion value. */
  value: number | null;
  /** Days with spend above zero, for spend per day. */
  daysWithDelivery: number | null;
}

/** One campaign with its current and comparison period. */
export interface GadsCampaignAgg {
  campaignId: string;
  campaignName: string;
  channelType: string | null;
  brandClass: BrandClass;
  status: string | null;
  biddingStrategyType: string | null;
  targetRoas: number | null;
  /** Latest daily budget in account currency. */
  budgetPerDay: number | null;
  budgetShared: boolean | null;
  current: GadsMetrics | null;
  previous: GadsMetrics | null;
}

/** Brand search-term spend inside non-brand campaigns, for one period. */
export interface GadsLeakageParts {
  /** Spend on brand search terms in non-brand campaigns. */
  brandSpend: number | null;
  /** All search-term spend in non-brand campaigns. */
  totalSpend: number | null;
}

export interface GadsLeakage {
  current: GadsLeakageParts;
  previous: GadsLeakageParts | null;
}

/** One PMax campaign on one network. */
export interface GadsPmaxNetworkRow {
  campaignId: string;
  campaignName: string;
  /** Raw network type: SEARCH, YOUTUBE, CONTENT, DISCOVER, GMAIL, SEARCH_PARTNERS. */
  network: string;
  spend: number | null;
  value: number | null;
}

interface Totals {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  value: number | null;
}

export interface GadsAdGroupRow extends Totals {
  adGroupId: string;
  adGroupName: string;
}

export interface GadsDeviceRow extends Totals {
  /** Raw device: MOBILE, DESKTOP, TABLET, CONNECTED_TV, OTHER. */
  device: string;
}

export interface GadsTermRow extends Totals {
  searchTerm: string;
  campaignId: string;
  campaignName: string;
  matchType: string | null;
  /** ADDED, EXCLUDED or NONE, from the latest day in range. */
  status: string | null;
  isBrand: boolean;
}

export interface GadsKeywordRow extends Totals {
  keyword: string;
  matchType: string | null;
  campaignId: string;
  campaignName: string;
  /** Latest reported quality score in range. */
  qualityScore: number | null;
}

export type GadsTermMode = "all" | "brand" | "nonbrand" | "waste";
export type GadsProductGroup = "item" | "type" | "brand" | "label0";

export interface GadsProductRow extends Totals {
  /** The group key: item id, product type, brand or custom label 0. Null is "not set". */
  key: string | null;
  /** Product type level 1, filled only when grouping by item. */
  productType: string | null;
  /** SHOPPING, PERFORMANCE_MAX or DEMAND_GEN. */
  channelType: string | null;
}

/** Numerators of the coverage chips. Denominators come from the campaign rows. */
export interface GadsCoverage {
  /** Search-term spend inside Search campaigns. */
  termSpend: number | null;
  /** Product-row spend inside Shopping and PMax campaigns. */
  productSpend: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Both periods in one scan: bounds plus the comparison range (the current range when there is none). */
function periodParams(period: ResolvedPeriod) {
  const bounds = scanBounds(period);
  const cmp = period.comparison ?? period.current;
  return {
    scanFrom: bounds.from,
    scanTo: bounds.to,
    from: period.current.from,
    to: period.current.to,
    cmpFrom: cmp.from,
    cmpTo: cmp.to,
  };
}

function totalsOf(row: Row): Totals {
  return {
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    conversions: num(row.conversions),
    value: num(row.value),
  };
}

function brandClassOf(value: unknown): BrandClass {
  return value === "brand" || value === "non_brand" || value === "shopping_pmax"
    ? value
    : "other";
}

function metricsOf(row: Row): GadsMetrics {
  return {
    ...totalsOf(row),
    daysWithDelivery: num(row.days_with_delivery),
    isImpressions: num(row.is_impressions),
    eligibleImpressions: num(row.eligible_impressions),
    lostBudgetImpressions: num(row.lost_budget_impressions),
    lostRankImpressions: num(row.lost_rank_impressions),
    topImpressions: num(row.top_impressions),
    topEligibleImpressions: num(row.top_eligible_impressions),
    absTopImpressions: num(row.abs_top_impressions),
    clickShareClicks: num(row.click_share_clicks),
    eligibleClicks: num(row.eligible_clicks),
  };
}

// ── Campaigns ───────────────────────────────────────────────────────────────

/**
 * One row per campaign with delivery in either period, each carrying its
 * current and comparison components. Totals, the brand split and the campaign
 * table are all derived from this one result, so they cannot disagree.
 *
 * Spend, value and conversions cover every network. Impression share
 * components are non-null only on rows where Google reports a share, so the
 * share sums skip Shopping-top, PMax and Search-partner rows on their own.
 */
export async function getGadsCampaignAgg(
  clientId: string,
  period: ResolvedPeriod
): Promise<GadsCampaignAgg[]> {
  if (isDemo(clientId)) return demoCampaignAgg(period);

  const rows = await query<Row>(
    `WITH f AS (
       SELECT
         campaign_id,
         IF(date BETWEEN @from AND @to, 'current', 'previous') AS part,
         SUM(spend) AS spend,
         SUM(impressions) AS impressions,
         SUM(clicks) AS clicks,
         SUM(purchases) AS conversions,
         SUM(purchase_value) AS value,
         COUNT(DISTINCT IF(spend > 0, date, NULL)) AS days_with_delivery,
         SUM(is_impressions) AS is_impressions,
         SUM(eligible_impressions) AS eligible_impressions,
         SUM(lost_budget_impressions) AS lost_budget_impressions,
         SUM(lost_rank_impressions) AS lost_rank_impressions,
         SUM(top_impressions) AS top_impressions,
         SUM(top_eligible_impressions) AS top_eligible_impressions,
         SUM(abs_top_impressions) AS abs_top_impressions,
         SUM(click_share_clicks) AS click_share_clicks,
         SUM(eligible_clicks) AS eligible_clicks
       FROM \`${MART}.mart_gads_campaign_daily\`
       WHERE client_id = @clientId
         AND date BETWEEN @scanFrom AND @scanTo
         AND (date BETWEEN @from AND @to OR date BETWEEN @cmpFrom AND @cmpTo)
       GROUP BY campaign_id, part
     )
     SELECT f.*, d.campaign_name, d.channel_type, d.brand_class, d.status,
            d.bidding_strategy_type, d.target_roas, d.budget_per_day, d.budget_shared
     FROM f
     LEFT JOIN \`${MART}.mart_gads_campaign_dim\` d
       ON d.client_id = @clientId AND d.campaign_id = f.campaign_id`,
    { clientId, ...periodParams(period) }
  );

  const byCampaign = new Map<string, GadsCampaignAgg>();
  for (const row of rows) {
    const id = String(row.campaign_id);
    let agg = byCampaign.get(id);
    if (!agg) {
      agg = {
        campaignId: id,
        campaignName: row.campaign_name ? String(row.campaign_name) : id,
        channelType: row.channel_type ? String(row.channel_type) : null,
        brandClass: brandClassOf(row.brand_class),
        status: row.status ? String(row.status) : null,
        biddingStrategyType: row.bidding_strategy_type ? String(row.bidding_strategy_type) : null,
        targetRoas: num(row.target_roas),
        budgetPerDay: num(row.budget_per_day),
        budgetShared: typeof row.budget_shared === "boolean" ? row.budget_shared : null,
        current: null,
        previous: null,
      };
      byCampaign.set(id, agg);
    }
    if (row.part === "current") agg.current = metricsOf(row);
    else agg.previous = metricsOf(row);
  }
  return [...byCampaign.values()];
}

/**
 * Brand leakage components for both periods: spend on brand search terms
 * inside non-brand campaigns, over all search-term spend in non-brand
 * campaigns. Only as good as the client's brand term list.
 */
export async function getGadsLeakage(
  clientId: string,
  period: ResolvedPeriod
): Promise<GadsLeakage> {
  if (isDemo(clientId)) return demoLeakage(period);

  const rows = await query<Row>(
    `SELECT
       IF(date BETWEEN @from AND @to, 'current', 'previous') AS part,
       SUM(IF(is_brand, spend, 0)) AS brand_spend,
       SUM(spend) AS total_spend
     FROM \`${MART}.mart_gads_search_terms_daily\`
     WHERE client_id = @clientId
       AND date BETWEEN @scanFrom AND @scanTo
       AND (date BETWEEN @from AND @to OR date BETWEEN @cmpFrom AND @cmpTo)
       AND campaign_brand_class = 'non_brand'
     GROUP BY part`,
    { clientId, ...periodParams(period) }
  );

  const parts = (part: string): GadsLeakageParts | null => {
    const row = rows.find((r) => r.part === part);
    return row ? { brandSpend: num(row.brand_spend), totalSpend: num(row.total_spend) } : null;
  };
  return {
    current: parts("current") ?? { brandSpend: null, totalSpend: null },
    previous: period.comparison ? parts("previous") : null,
  };
}

/** Spend and value per PMax campaign and network, for the channel split bars. */
export async function getGadsPmaxSplit(
  clientId: string,
  range: DateRange
): Promise<GadsPmaxNetworkRow[]> {
  if (isDemo(clientId)) return demoPmaxSplit(range);

  const rows = await query<Row>(
    `SELECT campaign_id, ANY_VALUE(campaign_name) AS campaign_name, ad_network_type AS network,
            SUM(spend) AS spend, SUM(purchase_value) AS value
     FROM \`${MART}.mart_gads_campaign_daily\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
       AND channel_type = 'PERFORMANCE_MAX'
     GROUP BY campaign_id, network
     HAVING SUM(spend) > 0 OR SUM(purchase_value) > 0`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    campaignId: String(r.campaign_id),
    campaignName: r.campaign_name ? String(r.campaign_name) : String(r.campaign_id),
    network: r.network ? String(r.network) : "OTHER",
    spend: num(r.spend),
    value: num(r.value),
  }));
}

// ── Campaign detail ─────────────────────────────────────────────────────────

/** Ad groups of one campaign (PMax has none), by spend. */
export async function getGadsAdGroups(
  clientId: string,
  range: DateRange,
  campaignId: string
): Promise<GadsAdGroupRow[]> {
  if (isDemo(clientId)) return demoAdGroups(range, campaignId);

  const rows = await query<Row>(
    `SELECT ad_group_id, ANY_VALUE(ad_group_name) AS ad_group_name,
            SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(conversions) AS conversions, SUM(conversions_value) AS value
     FROM \`${MART}.mart_gads_adgroup_daily\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to AND campaign_id = @campaignId
     GROUP BY ad_group_id
     HAVING SUM(spend) > 0
     ORDER BY spend DESC
     LIMIT 100`,
    { clientId, from: range.from, to: range.to, campaignId }
  );
  return rows.map((r) => ({
    adGroupId: String(r.ad_group_id),
    adGroupName: r.ad_group_name ? String(r.ad_group_name) : String(r.ad_group_id),
    ...totalsOf(r),
  }));
}

/** Device split of one campaign. */
export async function getGadsDevices(
  clientId: string,
  range: DateRange,
  campaignId: string
): Promise<GadsDeviceRow[]> {
  if (isDemo(clientId)) return demoDevices(range, campaignId);

  const rows = await query<Row>(
    `SELECT device, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(conversions) AS conversions, SUM(conversions_value) AS value
     FROM \`${MART}.mart_gads_campaign_device_daily\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to AND campaign_id = @campaignId
     GROUP BY device
     HAVING SUM(spend) > 0
     ORDER BY spend DESC`,
    { clientId, from: range.from, to: range.to, campaignId }
  );
  return rows.map((r) => ({ device: r.device ? String(r.device) : "OTHER", ...totalsOf(r) }));
}

// ── Search terms and keywords ───────────────────────────────────────────────

/** HAVING clause per mode. A whitelist: the mode never reaches the SQL as text. */
const TERM_HAVING: Record<GadsTermMode, string> = {
  all: "TRUE",
  brand: "LOGICAL_OR(s.is_brand)",
  nonbrand: "NOT LOGICAL_OR(s.is_brand)",
  waste: "SUM(s.spend) > 0 AND SUM(s.conversions) = 0",
};

/**
 * Top 200 search terms by spend in range, per term, campaign and match type.
 * `waste` is spend above zero with no conversions. Terms cover only part of
 * Search spend (privacy threshold): see `getGadsCoverage`.
 */
export async function getGadsSearchTerms(
  clientId: string,
  range: DateRange,
  mode: GadsTermMode
): Promise<GadsTermRow[]> {
  if (isDemo(clientId)) return demoSearchTerms(range, mode);

  const rows = await query<Row>(
    `SELECT s.search_term, s.campaign_id, ANY_VALUE(d.campaign_name) AS campaign_name, s.match_type,
            LOGICAL_OR(s.is_brand) AS is_brand,
            ARRAY_AGG(s.term_status ORDER BY s.date DESC LIMIT 1)[OFFSET(0)] AS status,
            SUM(s.spend) AS spend, SUM(s.impressions) AS impressions, SUM(s.clicks) AS clicks,
            SUM(s.conversions) AS conversions, SUM(s.conversions_value) AS value
     FROM \`${MART}.mart_gads_search_terms_daily\` s
     LEFT JOIN \`${MART}.mart_gads_campaign_dim\` d
       ON d.client_id = s.client_id AND d.campaign_id = s.campaign_id
     WHERE s.client_id = @clientId AND s.date BETWEEN @from AND @to
     GROUP BY s.search_term, s.campaign_id, s.match_type
     HAVING ${TERM_HAVING[mode]}
     ORDER BY spend DESC
     LIMIT 200`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    searchTerm: r.search_term ? String(r.search_term) : "",
    campaignId: String(r.campaign_id),
    campaignName: r.campaign_name ? String(r.campaign_name) : String(r.campaign_id),
    matchType: r.match_type ? String(r.match_type) : null,
    status: r.status ? String(r.status) : null,
    isBrand: r.is_brand === true,
    ...totalsOf(r),
  }));
}

/** Top 200 keywords by spend in range, per keyword text, match type and campaign. */
export async function getGadsKeywords(
  clientId: string,
  range: DateRange
): Promise<GadsKeywordRow[]> {
  if (isDemo(clientId)) return demoKeywords(range);

  const rows = await query<Row>(
    `SELECT k.keyword_text, k.match_type, k.campaign_id, ANY_VALUE(d.campaign_name) AS campaign_name,
            ARRAY_AGG(k.quality_score IGNORE NULLS ORDER BY k.date DESC LIMIT 1)[SAFE_OFFSET(0)] AS quality_score,
            SUM(k.spend) AS spend, SUM(k.impressions) AS impressions, SUM(k.clicks) AS clicks,
            SUM(k.conversions) AS conversions, SUM(k.conversions_value) AS value
     FROM \`${MART}.mart_gads_keywords_daily\` k
     LEFT JOIN \`${MART}.mart_gads_campaign_dim\` d
       ON d.client_id = k.client_id AND d.campaign_id = k.campaign_id
     WHERE k.client_id = @clientId AND k.date BETWEEN @from AND @to
     GROUP BY k.keyword_text, k.match_type, k.campaign_id
     HAVING SUM(k.spend) > 0
     ORDER BY spend DESC
     LIMIT 200`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    keyword: r.keyword_text ? String(r.keyword_text) : "",
    matchType: r.match_type ? String(r.match_type) : null,
    campaignId: String(r.campaign_id),
    campaignName: r.campaign_name ? String(r.campaign_name) : String(r.campaign_id),
    qualityScore: num(r.quality_score),
    ...totalsOf(r),
  }));
}

// ── Products ────────────────────────────────────────────────────────────────

/** Group expression per option. A whitelist, like the term modes. */
const PRODUCT_KEY: Record<GadsProductGroup, string> = {
  item: "item_id",
  type: "product_type_l1",
  brand: "brand",
  label0: "custom_label_0",
};

/**
 * Top 200 product groups by spend in range, split by campaign type. Without a
 * Merchant Center link a product is its item id plus product type level 1.
 * `zeroOnly` keeps groups that spent without converting.
 */
export async function getGadsProducts(
  clientId: string,
  range: DateRange,
  group: GadsProductGroup,
  zeroOnly: boolean
): Promise<GadsProductRow[]> {
  if (isDemo(clientId)) return demoProducts(range, group, zeroOnly);

  const rows = await query<Row>(
    `SELECT ${PRODUCT_KEY[group]} AS grp, channel_type,
            MAX(product_type_l1) AS product_type,
            SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(conversions) AS conversions, SUM(conversions_value) AS value
     FROM \`${MART}.mart_gads_products_daily\`
     WHERE client_id = @clientId AND date BETWEEN @from AND @to
     GROUP BY grp, channel_type
     HAVING SUM(spend) > 0 ${zeroOnly ? "AND SUM(conversions) = 0" : ""}
     ORDER BY spend DESC
     LIMIT 200`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    key: r.grp === null || r.grp === undefined || r.grp === "" ? null : String(r.grp),
    productType: group === "item" && r.product_type ? String(r.product_type) : null,
    channelType: r.channel_type ? String(r.channel_type) : null,
    ...totalsOf(r),
  }));
}

/**
 * Numerators for the "Covers N% of spend" chips. Terms are counted only inside
 * Search campaigns and products only inside Shopping and PMax campaigns, so
 * each one reads against the campaign spend it can cover.
 */
export async function getGadsCoverage(
  clientId: string,
  range: DateRange
): Promise<GadsCoverage> {
  if (isDemo(clientId)) return demoCoverage(range);

  const [row] = await query<Row>(
    `SELECT
       (SELECT SUM(s.spend)
          FROM \`${MART}.mart_gads_search_terms_daily\` s
          JOIN \`${MART}.mart_gads_campaign_dim\` d
            ON d.client_id = s.client_id AND d.campaign_id = s.campaign_id
         WHERE s.client_id = @clientId AND s.date BETWEEN @from AND @to
           AND d.channel_type = 'SEARCH') AS term_spend,
       (SELECT SUM(spend)
          FROM \`${MART}.mart_gads_products_daily\`
         WHERE client_id = @clientId AND date BETWEEN @from AND @to
           AND channel_type IN ('SHOPPING', 'PERFORMANCE_MAX')) AS product_spend`,
    { clientId, from: range.from, to: range.to }
  );
  return { termSpend: num(row?.term_spend), productSpend: num(row?.product_spend) };
}
