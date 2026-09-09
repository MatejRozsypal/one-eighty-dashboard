import "server-only";

/**
 * Warehouse reads for the Creative Engine.
 *
 * ── The range default, and why it is not 30 days ───────────────────────────
 * These screens take the same date control as the rest of the dashboard —
 * presets, a custom range, and a comparison period — but they open on ALL TIME
 * rather than the dashboard-wide thirty days.
 *
 * The reason is arithmetic. A persona tested across five months may reach 80
 * purchases even though no single month reaches 20, and 20 purchases carries a
 * ±51% interval while 80 carries ±26%. Accumulation is how a small account buys
 * statistical power, and defaulting to a month would throw it away every month.
 * A shorter range is still one click away, and every interval on screen widens
 * when it is chosen — which is the honest depiction of what was given up.
 *
 * ── What is missing is said, not shown as zero ─────────────────────────────
 * None of these views exist in the warehouse yet. Every query is wrapped so a
 * missing object renders an honest "not ingested yet" state — but only a
 * missing object. A permission failure is re-thrown, because a dashboard that
 * says "no data" when it means "I was not allowed to look" is worse than one
 * that crashes: the crash gets fixed, the false empty state gets believed.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import {
  ZERO,
  type AdRow,
  type AdsetRow,
  type Components,
  type MonthlySpend,
  type Tags,
} from "@/lib/creative/model";
import type { Candidate } from "@/lib/creative/matching";
import type { DateRange } from "@/lib/period";

/**
 * Kept as a type alias only so nothing downstream has to care that the screens
 * used to have a two-position toggle. The window is a `DateRange` now, chosen
 * with the same control every other page in the dashboard uses.
 */
export type CreativeWindow = DateRange;

/** Everything one screen needs, fetched together. */
export interface CreativeData {
  ads: AdRow[];
  adsets: AdsetRow[];
  /** False when the warehouse objects have not been created yet. */
  available: boolean;
  /** Set when `available` is false, for the empty state to quote. */
  missing: string | null;
  currency: string | null;
  through: string | null;
}

const n0 = (v: unknown): number => num(v) ?? 0;

function componentsFrom(r: Record<string, unknown>): Components {
  return {
    ...ZERO,
    spend: n0(r.spend),
    revenue: n0(r.revenue),
    purchases: n0(r.purchases),
    impressions: n0(r.impressions),
    clicks: n0(r.clicks),
    reach: n0(r.reach),
    addToCart: n0(r.add_to_cart),
    initiateCheckout: n0(r.initiate_checkout),
    landingPageViews: n0(r.landing_page_views),
    linkClicks: n0(r.link_clicks),
    outboundClicks: n0(r.outbound_clicks),
    uniqueOutboundClicks: n0(r.unique_outbound_clicks),
    videoViews: n0(r.video_views),
    videoPlays: n0(r.video_play_actions),
    videoThruplays: n0(r.video_thruplays),
    videoP25: n0(r.video_p25),
    videoP50: n0(r.video_p50),
    videoP75: n0(r.video_p75),
    videoP95: n0(r.video_p95),
    videoP100: n0(r.video_p100),
    video30s: n0(r.video_30s),
  };
}

function tagsFrom(r: Record<string, unknown>): Tags {
  const s = (k: string) => (r[k] === null || r[k] === undefined ? null : String(r[k]));
  return {
    clickupTaskId: s("clickup_task_id"),
    clickupUrl: s("clickup_url"),
    conceptId: s("concept_id"),
    conceptCode: s("concept_code"),
    conceptName: s("concept_name"),
    personaId: s("persona_id"),
    personaName: s("persona_name"),
    angle: s("angle"),
    offer: s("offer"),
    stage: s("stage"),
    productionType: s("production_type"),
    format: s("format"),
    bodyCode: s("body_code"),
    hookCode: s("hook_code"),
    productionMethod: s("production_method"),
    creatorId: s("creator_id"),
    creatorName: s("creator_name"),
    creatorType: s("creator_type"),
    productionCost: num(r.production_cost),
    productionCostSource: s("production_cost_source"),
    briefUrl: s("brief_url"),
    market: s("market"),
    launchedAt: isoDate(r.launched_at as never),
    matchMethod: s("match_method"),
    matchConfidence: num(r.match_confidence),
  };
}

/**
 * `WHERE` fragment for the selected range.
 *
 * Parameterised rather than interpolated: the dates come from the URL, and a
 * hand-edited `?from=` has no business reaching the SQL text. It is also what
 * lets BigQuery serve a repeated view from its own result cache.
 */
const RANGE_CLAUSE = "date BETWEEN @from AND @to";

const EMPTY: CreativeData = {
  ads: [], adsets: [], available: false, missing: null, currency: null, through: null,
};

/**
 * Ads with their tags, aggregated over the window, plus monthly spend.
 *
 * Two queries rather than one. Monthly spend cannot be derived from a windowed
 * total, and a single query with GROUPING SETS would return two differently
 * shaped row types that the caller would then have to sort back out — cheaper
 * in BigQuery, more expensive in every future read of this file.
 */
export async function getCreativeAds(
  clientId: string,
  range: DateRange
): Promise<CreativeData> {
  if (isDemo(clientId)) {
    const { demoCreative } = await import("@/lib/demo/creative");
    return demoCreative(range);
  }

  const bounds = { clientId, from: range.from, to: range.to };

  try {
    const [totals, monthly, adsets] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT
           ad_id,
           ANY_VALUE(ad_name)      AS ad_name,
           ANY_VALUE(adset_id)     AS adset_id,
           ANY_VALUE(campaign_id)  AS campaign_id,
           ANY_VALUE(currency)     AS currency,
           MAX(date)               AS through,
           -- Tags are constant per ad, so ANY_VALUE is exact here rather than
           -- an approximation. They come off ref.creative_tags, which holds one
           -- row per (client_id, ad_id).
           ANY_VALUE(clickup_task_id) AS clickup_task_id,
           ANY_VALUE(clickup_url)  AS clickup_url,
           ANY_VALUE(concept_id)   AS concept_id,
           ANY_VALUE(concept_code) AS concept_code,
           ANY_VALUE(concept_name) AS concept_name,
           ANY_VALUE(persona_id)   AS persona_id,
           ANY_VALUE(persona_name) AS persona_name,
           ANY_VALUE(angle)        AS angle,
           ANY_VALUE(offer)        AS offer,
           ANY_VALUE(stage)        AS stage,
           ANY_VALUE(production_type) AS production_type,
           ANY_VALUE(format)       AS format,
           ANY_VALUE(body_code)    AS body_code,
           ANY_VALUE(hook_code)    AS hook_code,
           ANY_VALUE(production_method) AS production_method,
           ANY_VALUE(creator_id)   AS creator_id,
           ANY_VALUE(creator_name) AS creator_name,
           ANY_VALUE(creator_type) AS creator_type,
           ANY_VALUE(production_cost) AS production_cost,
           ANY_VALUE(production_cost_source) AS production_cost_source,
           ANY_VALUE(brief_url)    AS brief_url,
           ANY_VALUE(market)       AS market,
           ANY_VALUE(launched_at)  AS launched_at,
           ANY_VALUE(match_method) AS match_method,
           ANY_VALUE(match_confidence) AS match_confidence,
           -- Summable components only. Every rate is recomputed in TypeScript
           -- after aggregation; nothing pre-divided crosses this boundary.
           SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
           SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(reach) AS reach,
           SUM(add_to_cart) AS add_to_cart, SUM(initiate_checkout) AS initiate_checkout,
           SUM(landing_page_views) AS landing_page_views, SUM(link_clicks) AS link_clicks,
           SUM(outbound_clicks) AS outbound_clicks,
           SUM(unique_outbound_clicks) AS unique_outbound_clicks,
           SUM(video_views) AS video_views,
           SUM(video_play_actions) AS video_play_actions,
           SUM(video_thruplays) AS video_thruplays,
           SUM(video_p25_watched) AS video_p25, SUM(video_p50_watched) AS video_p50,
           SUM(video_p75_watched) AS video_p75, SUM(video_p95_watched) AS video_p95,
           SUM(video_p100_watched) AS video_p100, SUM(video_30s_watched) AS video_30s
         FROM \`${PROJECT_ID}.mart.mart_creative_perf\`
         WHERE client_id = @clientId AND ${RANGE_CLAUSE}
         GROUP BY ad_id
         -- The bare alias, NOT SUM(spend). BigQuery resolves a plain name in
         -- HAVING against the SELECT aliases first, and this query aliases
         -- SUM(spend) AS spend -- so writing HAVING SUM(spend) expands to
         -- SUM(SUM(spend)) and the page 500s with "Aggregations of
         -- aggregations are not allowed". The alias already is the sum.
         -- (Backticks are deliberately absent: this is inside a template
         -- literal, and one would end the string.)
         HAVING spend > 0
         ORDER BY spend DESC`,
        bounds
      ),
      query<Record<string, unknown>>(
        `SELECT ad_id, FORMAT_DATE('%Y-%m', date) AS month, SUM(spend) AS spend
         FROM \`${PROJECT_ID}.mart.mart_creative_perf\`
         WHERE client_id = @clientId
           AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
         GROUP BY ad_id, month
         ORDER BY month`,
        { clientId }
      ),
      query<Record<string, unknown>>(
        `SELECT
           adset_id,
           ANY_VALUE(adset_name)     AS adset_name,
           ANY_VALUE(campaign_id)    AS campaign_id,
           ANY_VALUE(campaign_name)  AS campaign_name,
           MIN(date) AS first_date, MAX(date) AS last_date,
           DATE_DIFF(CURRENT_DATE(), MIN(date), DAY) AS age_days,
           -- Frequency is NOT summable and NOT averageable across days: reach
           -- double-counts a person seen on two days. The most recent day's
           -- value is the only honest single number available without a
           -- separate period-scoped API call. METRICS.md says so at length.
           ARRAY_AGG(frequency_per_day IGNORE NULLS ORDER BY date DESC LIMIT 1)[SAFE_OFFSET(0)] AS frequency_latest,
           SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
           SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(reach) AS reach,
           SUM(add_to_cart) AS add_to_cart, SUM(initiate_checkout) AS initiate_checkout,
           SUM(landing_page_views) AS landing_page_views, SUM(link_clicks) AS link_clicks,
           SUM(outbound_clicks) AS outbound_clicks
         FROM \`${PROJECT_ID}.mart.mart_creative_adset_perf\`
         WHERE client_id = @clientId AND ${RANGE_CLAUSE}
         GROUP BY adset_id
         -- The bare alias, NOT SUM(spend). BigQuery resolves a plain name in
         -- HAVING against the SELECT aliases first, and this query aliases
         -- SUM(spend) AS spend -- so writing HAVING SUM(spend) expands to
         -- SUM(SUM(spend)) and the page 500s with "Aggregations of
         -- aggregations are not allowed". The alias already is the sum.
         -- (Backticks are deliberately absent: this is inside a template
         -- literal, and one would end the string.)
         HAVING spend > 0
         ORDER BY spend DESC`,
        bounds
      ),
    ]);

    const byAd = new Map<string, MonthlySpend[]>();
    for (const m of monthly) {
      const id = String(m.ad_id);
      const list = byAd.get(id) ?? [];
      list.push({ month: String(m.month), spend: n0(m.spend) });
      byAd.set(id, list);
    }

    return {
      ads: totals.map((r) => ({
        adId: String(r.ad_id),
        adName: String(r.ad_name ?? r.ad_id),
        adsetId: r.adset_id ? String(r.adset_id) : null,
        adsetName: null, // filled in from the ad-set rows below
        campaignId: r.campaign_id ? String(r.campaign_id) : null,
        campaignName: null,
        tags: tagsFrom(r),
        components: componentsFrom(r),
        monthlySpend: byAd.get(String(r.ad_id)) ?? [],
      })).map((ad) => {
        const set = adsets.find((a) => String(a.adset_id) === ad.adsetId);
        return set
          ? { ...ad, adsetName: String(set.adset_name ?? ""), campaignName: set.campaign_name ? String(set.campaign_name) : null }
          : ad;
      }),
      adsets: adsets.map((r) => ({
        adsetId: String(r.adset_id),
        adsetName: String(r.adset_name ?? r.adset_id),
        campaignId: r.campaign_id ? String(r.campaign_id) : null,
        campaignName: r.campaign_name ? String(r.campaign_name) : null,
        components: componentsFrom(r),
        firstDate: isoDate(r.first_date as never),
        lastDate: isoDate(r.last_date as never),
        ageDays: num(r.age_days),
        frequencyLatest: num(r.frequency_latest),
      })),
      available: true,
      missing: null,
      currency: totals[0]?.currency ? String(totals[0].currency) : null,
      through: totals[0]?.through ? isoDate(totals[0].through as never) : null,
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return { ...EMPTY, missing: "mart.mart_creative_perf" };
  }
}

// ---------------------------------------------------------------------------
// The creative itself
// ---------------------------------------------------------------------------

export interface CreativeAsset {
  adId: string;
  assetUri: string | null;
  thumbUri: string | null;
  assetKind: string | null;
  objectType: string | null;
  videoLengthSec: number | null;
  /**
   * Width over height, as the creative was served. Null where the shape was
   * never recorded — an older row, or an asset we could not reach. The UI must
   * not substitute a number for it: the crop this replaced was a guessed 4:5.
   */
  aspectRatio: number | null;
  assetWidth: number | null;
  assetHeight: number | null;
  title: string | null;
  body: string | null;
  linkDescription: string | null;
  callToActionType: string | null;
  linkUrl: string | null;
  /** Every text variant an Advantage+ ad is rotating, not just the first. */
  bodies: string[];
  titles: string[];
  effectiveStatus: string | null;
  adsetName: string | null;
  campaignName: string | null;
}

function parseVariants(json: unknown): string[] {
  if (typeof json !== "string" || !json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (typeof v === "string" ? v : (v as { text?: string })?.text))
      .filter((v): v is string => Boolean(v));
  } catch {
    return [];
  }
}

export async function getCreativeAssets(
  clientId: string
): Promise<Map<string, CreativeAsset>> {
  if (isDemo(clientId)) {
    const { demoAssets } = await import("@/lib/demo/creative");
    return demoAssets();
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT ad_id, asset_uri, thumb_uri, asset_kind, object_type, video_length_sec, aspect_ratio, asset_width, asset_height,
              title, body, link_description, call_to_action_type, link_url,
              bodies_json, titles_json, effective_status, adset_name, campaign_name
       FROM \`${PROJECT_ID}.mart.mart_creative_asset\`
       WHERE client_id = @clientId`,
      { clientId }
    );
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return new Map(
      rows.map((r) => [
        String(r.ad_id),
        {
          adId: String(r.ad_id),
          assetUri: s(r.asset_uri),
          thumbUri: s(r.thumb_uri),
          assetKind: s(r.asset_kind),
          objectType: s(r.object_type),
          videoLengthSec: num(r.video_length_sec),
          aspectRatio: num(r.aspect_ratio),
          assetWidth: num(r.asset_width),
          assetHeight: num(r.asset_height),
          title: s(r.title),
          body: s(r.body),
          linkDescription: s(r.link_description),
          callToActionType: s(r.call_to_action_type),
          linkUrl: s(r.link_url),
          bodies: parseVariants(r.bodies_json),
          titles: parseVariants(r.titles_json),
          effectiveStatus: s(r.effective_status),
          adsetName: s(r.adset_name),
          campaignName: s(r.campaign_name),
        },
      ])
    );
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Breakdowns, for the ad detail panel
// ---------------------------------------------------------------------------

export interface BreakdownSlice {
  label: string;
  impressions: number;
  spend: number;
  purchases: number;
  clicks: number;
  /**
   * Impressions by gender, on the age slices only. Meta reports age x gender
   * and the aggregation used to collapse it to age alone, throwing away the
   * split that the panel draws as two bars. Null on placement slices, where
   * the dimension does not exist.
   */
  female?: number;
  male?: number;
}

export interface AdBreakdowns {
  /** age x gender, collapsed to age, plus the gender split. */
  ages: BreakdownSlice[];
  femaleShare: number | null;
  placements: BreakdownSlice[];
}

/**
 * Delivery diagnosis for one ad.
 *
 * Impressions and spend are the headline; purchases are carried but the UI
 * gates them. A single ad split six ways by age has single-digit purchases per
 * bucket, so "which age group has the better ROAS" is a question this data
 * cannot answer however confidently it renders. What it can answer is "where is
 * Meta putting this, and is that where the buyer is".
 */
export async function getAdBreakdowns(
  clientId: string,
  adId: string
): Promise<AdBreakdowns> {
  const empty: AdBreakdowns = { ages: [], femaleShare: null, placements: [] };
  if (isDemo(clientId)) {
    const { demoBreakdowns } = await import("@/lib/demo/creative");
    return demoBreakdowns(adId);
  }
  try {
    const [demo, place] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT age, gender, SUM(impressions) AS impressions,
                SUM(spend) AS spend, SUM(purchases) AS purchases,
                SUM(clicks) AS clicks
         FROM \`${PROJECT_ID}.mart.mart_creative_breakdown_demo\`
         WHERE client_id = @clientId AND ad_id = @adId
           AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
         GROUP BY age, gender`,
        { clientId, adId }
      ),
      query<Record<string, unknown>>(
        `SELECT publisher_platform, platform_position,
                SUM(impressions) AS impressions, SUM(spend) AS spend,
                SUM(purchases) AS purchases, SUM(clicks) AS clicks
         FROM \`${PROJECT_ID}.mart.mart_creative_breakdown_placement\`
         WHERE client_id = @clientId AND ad_id = @adId
           AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
         GROUP BY publisher_platform, platform_position
         ORDER BY impressions DESC
         LIMIT 8`,
        { clientId, adId }
      ),
    ]);

    const ages = new Map<string, BreakdownSlice>();
    let female = 0;
    let known = 0;
    for (const r of demo) {
      const key = String(r.age);
      const slice =
        ages.get(key) ??
        { label: key, impressions: 0, spend: 0, purchases: 0, clicks: 0, female: 0, male: 0 };
      slice.impressions += n0(r.impressions);
      slice.spend += n0(r.spend);
      slice.purchases += n0(r.purchases);
      slice.clicks += n0(r.clicks);

      const g = String(r.gender);
      if (g === "female" || g === "male") {
        known += n0(r.impressions);
        if (g === "female") {
          female += n0(r.impressions);
          slice.female = (slice.female ?? 0) + n0(r.impressions);
        } else {
          slice.male = (slice.male ?? 0) + n0(r.impressions);
        }
      }
      ages.set(key, slice);
    }

    return {
      ages: [...ages.values()].sort((a, b) => a.label.localeCompare(b.label)),
      femaleShare: known > 0 ? female / known : null,
      placements: place.map((r) => ({
        label: `${titleCase(String(r.publisher_platform))} ${titleCase(String(r.platform_position))}`,
        impressions: n0(r.impressions),
        spend: n0(r.spend),
        purchases: n0(r.purchases),
        clicks: n0(r.clicks),
      })),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return empty;
  }
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// The unmapped queue
// ---------------------------------------------------------------------------

export interface UnmappedAd {
  adId: string;
  adName: string;
  spend: number;
  purchases: number;
  impressions: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface UnmappedData {
  ads: UnmappedAd[];
  candidates: Candidate[];
  available: boolean;
}

export async function getUnmapped(clientId: string): Promise<UnmappedData> {
  if (isDemo(clientId)) {
    const { demoUnmapped } = await import("@/lib/demo/creative");
    return demoUnmapped();
  }
  try {
    const [ads, tasks] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT ad_id, ad_name, spend, purchases, impressions, first_seen, last_seen
         FROM \`${PROJECT_ID}.mart.mart_creative_unmapped\`
         WHERE client_id = @clientId
         ORDER BY spend DESC
         LIMIT 200`,
        { clientId }
      ),
      query<Record<string, unknown>>(
        `SELECT task_id, task_name, task_url, status, concept_id, concept_name,
                market, content_format
         FROM \`${PROJECT_ID}.mart.mart_clickup_ad_tasks\`
         WHERE client_id = @clientId`,
        { clientId }
      ),
    ]);

    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return {
      ads: ads.map((r) => ({
        adId: String(r.ad_id),
        adName: String(r.ad_name ?? r.ad_id),
        spend: n0(r.spend),
        purchases: n0(r.purchases),
        impressions: n0(r.impressions),
        firstSeen: isoDate(r.first_seen as never),
        lastSeen: isoDate(r.last_seen as never),
      })),
      candidates: tasks.map((r) => ({
        taskId: String(r.task_id),
        taskName: String(r.task_name ?? ""),
        taskUrl: s(r.task_url),
        status: s(r.status),
        conceptId: s(r.concept_id),
        conceptName: s(r.concept_name),
        market: s(r.market),
        contentFormat: s(r.content_format),
      })),
      available: true,
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return { ads: [], candidates: [], available: false };
  }
}

// ---------------------------------------------------------------------------
// Tag coverage — the gate on the Breakdown screen
// ---------------------------------------------------------------------------

export interface TagCoverage {
  pctSpendTagged: number | null;
  spendTotal: number;
  ads: number;
  adsTagged: number;
}

/**
 * Breakdown stays behind a flag until roughly 60% of spend carries a concept
 * tag. Below that it reads less than half the account, and the rows it does
 * show are not a sample of anything — they are whatever happened to get filed.
 * Reading the threshold from measured coverage rather than from somebody's
 * recollection of it is the whole point.
 */
export async function getTagCoverage(clientId: string): Promise<TagCoverage> {
  const empty: TagCoverage = { pctSpendTagged: null, spendTotal: 0, ads: 0, adsTagged: 0 };
  if (isDemo(clientId)) {
    const { demoCoverage } = await import("@/lib/demo/creative");
    return demoCoverage();
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT pct_spend_tagged, spend_total, ads, ads_tagged
       FROM \`${PROJECT_ID}.mart.mart_creative_tag_coverage\`
       WHERE client_id = @clientId`,
      { clientId }
    );
    const r = rows[0];
    if (!r) return empty;
    return {
      pctSpendTagged: num(r.pct_spend_tagged),
      spendTotal: n0(r.spend_total),
      ads: n0(r.ads),
      adsTagged: n0(r.ads_tagged),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export interface PersonaRow {
  personaId: string;
  name: string;
  status: string | null;
  clickupUrl: string | null;
}

export async function getPersonas(clientId: string): Promise<PersonaRow[]> {
  if (isDemo(clientId)) {
    const { demoPersonas } = await import("@/lib/demo/creative");
    return demoPersonas();
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT persona_id, name, status, clickup_url
       FROM \`${PROJECT_ID}.mart.mart_creative_personas\`
       WHERE client_id = @clientId ORDER BY name`,
      { clientId }
    );
    return rows.map((r) => ({
      personaId: String(r.persona_id),
      name: String(r.name ?? r.persona_id),
      status: r.status ? String(r.status) : null,
      clickupUrl: r.clickup_url ? String(r.clickup_url) : null,
    }));
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return [];
  }
}

export interface ConceptRow {
  conceptId: string;
  conceptCode: string | null;
  name: string;
  angle: string | null;
  offer: string | null;
  personaId: string | null;
  clickupUrl: string | null;
  /** True when ClickUp held two angles or two personas. Never averaged away. */
  multiValued: boolean;
}

/**
 * The concept roster, including the ones that have never run.
 *
 * The Concepts screen otherwise only ever sees a concept that some ad is
 * already attached to, which hides the two states worth acting on: a concept
 * written and never briefed against, and a concept whose angle, persona and
 * offer were never filled in. Six of Manami's nine are in the second state.
 */
export async function getConcepts(clientId: string): Promise<ConceptRow[]> {
  if (isDemo(clientId)) {
    const { demoConcepts } = await import("@/lib/demo/creative");
    return demoConcepts();
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT concept_id, concept_code, name, angle, offer, persona_id,
              clickup_url, multi_valued
       FROM \`${PROJECT_ID}.mart.mart_creative_concepts\`
       WHERE client_id = @clientId ORDER BY name`,
      { clientId }
    );
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return rows.map((r) => ({
      conceptId: String(r.concept_id),
      conceptCode: s(r.concept_code),
      name: String(r.name ?? r.concept_id),
      angle: s(r.angle),
      offer: s(r.offer),
      personaId: s(r.persona_id),
      clickupUrl: s(r.clickup_url),
      multiValued: r.multi_valued === true,
    }));
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return [];
  }
}

/**
 * The date each ad set first delivered, over the whole history.
 *
 * ── Why this is its own query ──────────────────────────────────────────────
 * `AdsetRow.firstDate` is `MIN(date)` *inside the selected window*, which is
 * right for the age gate — an ad set's no-touch clock is about how long it has
 * been running — and catastrophic for a cadence chart. Under the 30-day window
 * every ad set's first date clamps into the last thirty days, and the chart
 * would report the whole account as having launched last month: a wrong answer
 * that looks entirely plausible.
 *
 * Cadence is a multi-month question by definition, so it is asked once,
 * lifetime, regardless of what window the reader is in.
 */
export async function getAdsetLaunchDates(clientId: string): Promise<string[]> {
  if (isDemo(clientId)) {
    const { demoLaunchDates } = await import("@/lib/demo/creative");
    return demoLaunchDates();
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT MIN(date) AS first_date
       FROM \`${PROJECT_ID}.mart.mart_creative_adset_perf\`
       WHERE client_id = @clientId AND spend > 0
       GROUP BY adset_id`,
      { clientId }
    );
    return rows
      .map((r) => isoDate(r.first_date as never))
      .filter((d): d is string => d !== null);
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return [];
  }
}

/**
 * Account totals for one range, and nothing else.
 *
 * ── Why the comparison period is not fetched as ads ────────────────────────
 * The obvious move is to call `getCreativeAds` twice and diff them. It is the
 * wrong shape twice over. It pulls every ad, its tags and its monthly spend for
 * a period nothing on screen renders — several times the payload for six
 * numbers — and it invites per-ad deltas, which at this account's volume are
 * noise wearing a percentage sign. An ad with four purchases against three is
 * not up 33%.
 *
 * So the comparison is account-level only: spend, revenue, purchases and the
 * ratios built from them, which are the four figures with enough events behind
 * them to move for a reason.
 */
export async function getCreativeTotals(
  clientId: string,
  range: DateRange
): Promise<Components | null> {
  if (isDemo(clientId)) {
    const { demoTotals } = await import("@/lib/demo/creative");
    return demoTotals(range);
  }
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(purchases) AS purchases,
         SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(reach) AS reach,
         SUM(add_to_cart) AS add_to_cart, SUM(initiate_checkout) AS initiate_checkout,
         SUM(landing_page_views) AS landing_page_views, SUM(link_clicks) AS link_clicks,
         SUM(outbound_clicks) AS outbound_clicks,
         SUM(unique_outbound_clicks) AS unique_outbound_clicks,
         SUM(video_views) AS video_views,
         SUM(video_play_actions) AS video_play_actions,
         SUM(video_thruplays) AS video_thruplays,
         SUM(video_p25_watched) AS video_p25, SUM(video_p50_watched) AS video_p50,
         SUM(video_p75_watched) AS video_p75, SUM(video_p95_watched) AS video_p95,
         SUM(video_p100_watched) AS video_p100, SUM(video_30s_watched) AS video_30s
       FROM \`${PROJECT_ID}.mart.mart_creative_perf\`
       WHERE client_id = @clientId AND ${RANGE_CLAUSE}`,
      { clientId, from: range.from, to: range.to }
    );
    const r = rows[0];
    // No spend in the comparison range is not zero — it is "this client was not
    // running then", and a delta against it would read as infinite growth.
    if (!r || n0(r.spend) === 0) return null;
    return componentsFrom(r);
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}
