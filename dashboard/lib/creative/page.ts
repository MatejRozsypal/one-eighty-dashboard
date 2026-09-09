import "server-only";

/**
 * The shared server-side preamble for every Creative screen.
 *
 * All five need the same six things — the resolved client, the thresholds, the
 * ads with their tags, the assets, the account context and the unmapped count.
 * Doing it once here means a new screen cannot accidentally use a different
 * account mean for its shrinkage than the screen next to it, which would show
 * up as the same persona reporting two different ROAS figures on two tabs.
 */

import { getClients, resolveClient, type Client } from "@/lib/clients";
import {
  getCreativeAds,
  getCreativeAssets,
  getCreativeTotals,
  getUnmapped,
  type CreativeAsset,
  type CreativeData,
  type UnmappedData,
} from "@/lib/queries/creative";
import { getCreativeSettings, listConfirmedMappings, toDisplayThresholds, toThresholds, type StoredCreativeSettings } from "@/lib/creative/store";
import { accountContext, type AccountContext, type Components } from "@/lib/creative/model";
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
   * Account-level only — see `getCreativeTotals`.
   */
  previous: Components | null;
}



export async function loadCreativeContext(searchParams: {
  [k: string]: string | string[] | undefined;
}): Promise<CreativeContext> {
  // `all` rather than the dashboard-wide 30-day default. See parseViewParams:
  // tag breakdowns live on accumulation, and a month of a small account is not
  // enough purchases to separate one persona from another.
  const params = parseViewParams(searchParams, "all");
  const clients = await getClients();
  const requested = params.clientId;
  const client = await resolveClient(requested, clients);

  const [settings, data, assets, unmapped, confirmed, previous] = await Promise.all([
    getCreativeSettings(client.clientId),
    getCreativeAds(client.clientId, params.range),
    getCreativeAssets(client.clientId),
    getUnmapped(client.clientId),
    listConfirmedMappings(client.clientId),
    // Account totals only, and only when a comparison is actually selected.
    params.period.comparison
      ? getCreativeTotals(client.clientId, params.period.comparison)
      : Promise.resolve(null),
  ]);

  const confirmedIds = new Set(confirmed.map((c) => c.adId));

  return {
    client,
    // The Meta ad account's own currency, not the shop's. They are set
    // separately and are not always the same, and a ROAS built from one
    // currency's spend and another's revenue is silently wrong.
    currency: data.currency ?? client.currency,
    params,
    previous,
    settings,
    thresholds: toThresholds(settings),
    display: toThresholds(settings) ?? toDisplayThresholds(settings),
    data,
    assets,
    // The shrinkage anchor. Computed from summed revenue over summed spend, so
    // a 300 Kč freak at 17x cannot drag the mean that every other row is pulled
    // toward — the learnings file has that exact ad in it.
    account: accountContext(data.ads, settings.targetRoas ?? 1),
    unmapped,
    unmappedCount: unmapped.ads.filter((a) => !confirmedIds.has(a.adId)).length,
  };
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
      ctx.account.meanRoas,
      ctx.account.spend,
      thresholds
    )
  );
}
