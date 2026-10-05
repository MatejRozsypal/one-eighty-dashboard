import "server-only";

/**
 * The shared server-side preamble for every Creative screen.
 *
 * All five need the same six things, the resolved client, the thresholds, the
 * ads with their tags, the assets, the account context and the unmapped count.
 * Doing it once here means a new screen cannot accidentally use a different
 * account mean for its shrinkage than the screen next to it, which would show
 * up as the same persona reporting two different ROAS figures on two tabs.
 */

import { getClients, resolveClient, type Client } from "@/lib/clients";
import { missingSource, pageAvailability } from "@/lib/capabilities";
import {
  getCreativeAds,
  getCreativeAssets,
  getCreativeTotals,
  getUnmapped,
  getVideoAdRates,
  type CreativeAsset,
  type CreativeData,
  type UnmappedData,
} from "@/lib/queries/creative";
import { getCreativeSettings, listConfirmedMappings, toDisplayThresholds, toHitRateThresholds, toThresholds, type StoredCreativeSettings } from "@/lib/creative/store";
import { getLaunchAnchor, type LaunchAnchor } from "@/lib/queries/creativeLaunch";
import { relativeFloors, withFloors } from "@/lib/creative/floors";
import { accountContext, fillNames, type AccountContext, type Components } from "@/lib/creative/model";
import { parseViewParams, type ViewParams } from "@/lib/params";
import { signMany, signManyDownloads } from "@/lib/creative/assets";
import { toAdView, type AdView } from "@/lib/creative/view";
import type { CreativeThresholds } from "@/lib/creative/stats";

export interface CreativeContext {
  client: Client;
  currency: string;
  /** The selected range, comparison range and mode, straight off the URL. */
  params: ViewParams;
  settings: StoredCreativeSettings;
  /** Null when the client has no kill line, target or CPA on file. */
  thresholds: CreativeThresholds | null;
  /**
   * What the hit rate and winners need: a target ROAS and a read threshold,
   * nothing else (no Target CPA, no kill line). Null only without a target.
   */
  hitThresholds: CreativeThresholds | null;
  /**
   * The launch table's anchor and ages, or null when it is not ready. Every
   * screen shrinks toward `anchor.priorRoas` and applies the winner age rule
   * from `anchor.ageByAd`, the same as the hit rate.
   */
  anchor: LaunchAnchor | null;
  /**
   * Always present. Equal to `thresholds` when they are set; otherwise a
   * judgement-free stand-in so the screens can still render delivery.
   */
  display: CreativeThresholds;
  data: CreativeData;
  assets: Map<string, CreativeAsset>;
  account: AccountContext;
  unmapped: UnmappedData;
  /** Unmapped ads minus any a person has already confirmed this hour. */
  unmappedCount: number;
  /**
   * The comparison period's account totals, or null when no comparison is
   * selected, the client was not running then, or the range has no rows.
   * Account-level only, see `getCreativeTotals`.
   */
  previous: Components | null;
}



/**
 * What a Creative page gets back: either the client has no Meta account and
 * the page renders `<NotConnected />`, or the full context.
 *
 * Decided from the registry flags (`lib/capabilities`) before any query runs,
 * so a client without Meta costs no BigQuery reads and never sees an empty
 * state that blames the date range.
 */
export type CreativeLoad =
  | { status: "not-connected"; client: Client; source: string }
  | { status: "ready"; ctx: CreativeContext };

export async function loadCreative(
  searchParams: { [k: string]: string | string[] | undefined },
  /** True only on the screen that shows a comparison. Skips the extra query elsewhere. */
  options: { compare?: boolean } = {}
): Promise<CreativeLoad> {
  // `all` rather than the dashboard-wide 30-day default. See parseViewParams:
  // tag breakdowns live on accumulation, and a month of a small account is not
  // enough purchases to separate one persona from another.
  const params = parseViewParams(searchParams, "all");
  const clients = await getClients();
  const requested = params.clientId;
  const client = await resolveClient(requested, clients);

  if (pageAvailability(client, "/creative") !== "available") {
    return {
      status: "not-connected",
      client,
      source: missingSource(client, "/creative") ?? "Meta",
    };
  }

  const [settings, data, assets, unmapped, confirmed, previous, anchor, videoRates] = await Promise.all([
    getCreativeSettings(client.clientId),
    getCreativeAds(client.clientId, params.range),
    getCreativeAssets(client.clientId),
    getUnmapped(client.clientId),
    listConfirmedMappings(client.clientId),
    // Account totals only, and only when a comparison is actually selected.
    options.compare && params.period.comparison
      ? getCreativeTotals(client.clientId, params.period.comparison)
      : Promise.resolve(null),
    // The launch table's anchor (365-day ROAS) and ad ages: one winner test on
    // every screen. Null when the table is not ready, and screens then keep
    // the window mean and apply no age rule.
    getLaunchAnchor(client.clientId),
    // Genuine video ads of the trailing 180 days: the relative hook and hold floors.
    getVideoAdRates(client.clientId),
  ]);

  const confirmedIds = new Set(confirmed.map((c) => c.adId));

  // The performance mart carries campaign and ad set ids only. The names come
  // from the asset mart, so a campaign link and the Ad set breakdown both work
  // even when the ad set mart returns nothing.
  const named: CreativeData = { ...data, ads: fillNames(data.ads, assets) };

  // Relative hook and hold floors from the client's own genuine video ads;
  // the stored Settings floors when there are too few (diagnostic only).
  const floors = videoRates
    ? relativeFloors(videoRates, {
        hookRateFloor: settings.hookRateFloor,
        holdRateFloor: settings.holdRateFloor,
      })
    : null;
  const windowAccount = accountContext(named.ads, settings.targetRoas ?? 1);

  const strict = toThresholds(settings);
  const ctx: CreativeContext = {
    client,
    // The Meta ad account's own currency, not the shop's. They are set
    // separately and are not always the same, and a ROAS built from one
    // currency's spend and another's revenue is silently wrong.
    currency: data.currency ?? client.currency,
    params,
    previous,
    settings,
    thresholds: strict ? withFloors(strict, floors) : null,
    hitThresholds: toHitRateThresholds(settings),
    anchor,
    display: withFloors(strict ?? toDisplayThresholds(settings), floors),
    data: named,
    assets,
    // `meanRoas` is the window's blended ROAS, summed revenue over summed
    // spend, so a 300 Kč freak at 17x cannot drag it, the learnings file has
    // that exact ad in it. It is what the Blended ROAS tile shows. What rows
    // are shrunk toward is `anchorRoas`: the client's stored 365-day ROAS, the
    // same number the hit rate uses, so the winner bar does not move with the
    // date picker.
    account: { ...windowAccount, anchorRoas: anchor?.priorRoas ?? windowAccount.meanRoas },
    unmapped,
    unmappedCount: unmapped.ads.filter((a) => !confirmedIds.has(a.adId)).length,
  };
  return { status: "ready", ctx };
}

/**
 * Turn the ads into their rendered form, signing every asset URL in one pass.
 *
 * Signing is a local cryptographic operation rather than a network call, but a
 * per-tile `await` inside the component tree would still serialise forty of
 * them behind each other.
 */
export async function buildAdViews(
  ctx: CreativeContext,
  thresholds: CreativeThresholds
): Promise<AdView[]> {
  const assets = ctx.data.ads.map((ad) => ctx.assets.get(ad.adId));
  const [thumbs, fulls, downloads] = await Promise.all([
    signMany(assets.map((a) => a?.thumbUri ?? null)),
    signMany(assets.map((a) => a?.assetUri ?? null)),
    signManyDownloads(
      ctx.data.ads.map((ad, i) => ({
        uri: assets[i]?.assetUri ?? null,
        filename: ad.adName,
      }))
    ),
  ]);

  return ctx.data.ads.map((ad, i) =>
    toAdView(
      ad,
      assets[i],
      { thumbUrl: thumbs[i], assetUrl: fulls[i], downloadUrl: downloads[i] },
      ctx.account.anchorRoas,
      ctx.account.spend,
      thresholds,
      ageOf(ctx, ad.adId)
    )
  );
}

/**
 * Days since an ad's first delivery, as the launch table has it. Null when the
 * table is not ready (no age rule then). An ad the table does not hold yet is
 * newer than the last build, so it is a day old at most.
 */
export function ageOf(ctx: Pick<CreativeContext, "anchor">, adId: string): number | null {
  if (ctx.anchor === null) return null;
  return ctx.anchor.ageByAd.get(adId) ?? 0;
}
