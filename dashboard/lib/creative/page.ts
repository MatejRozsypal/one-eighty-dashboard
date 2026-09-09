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
  getUnmapped,
  type CreativeAsset,
  type CreativeData,
  type CreativeWindow,
  type UnmappedData,
} from "@/lib/queries/creative";
import { getCreativeSettings, listConfirmedMappings, toDisplayThresholds, toThresholds, type StoredCreativeSettings } from "@/lib/creative/store";
import { accountContext, type AccountContext } from "@/lib/creative/model";
import { signMany } from "@/lib/creative/assets";
import { toAdView, type AdView } from "@/lib/creative/view";
import type { CreativeThresholds } from "@/lib/creative/stats";

export interface CreativeContext {
  client: Client;
  currency: string;
  window: CreativeWindow;
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
}

export function parseWindow(value: string | string[] | undefined): CreativeWindow {
  return (Array.isArray(value) ? value[0] : value) === "30d" ? "30d" : "lifetime";
}

export async function loadCreativeContext(searchParams: {
  [k: string]: string | string[] | undefined;
}): Promise<CreativeContext> {
  const clients = await getClients();
  const requested = Array.isArray(searchParams.client)
    ? searchParams.client[0]
    : searchParams.client;
  const client = await resolveClient(requested, clients);
  const window = parseWindow(searchParams.window);

  const [settings, data, assets, unmapped, confirmed] = await Promise.all([
    getCreativeSettings(client.clientId),
    getCreativeAds(client.clientId, window),
    getCreativeAssets(client.clientId),
    getUnmapped(client.clientId),
    listConfirmedMappings(client.clientId),
  ]);

  const confirmedIds = new Set(confirmed.map((c) => c.adId));

  return {
    client,
    // The Meta ad account's own currency, not the shop's. They are set
    // separately and are not always the same, and a ROAS built from one
    // currency's spend and another's revenue is silently wrong.
    currency: data.currency ?? client.currency,
    window,
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
  const [thumbs, fulls] = await Promise.all([
    signMany(assets.map((a) => a?.thumbUri ?? null)),
    signMany(assets.map((a) => a?.assetUri ?? null)),
  ]);

  return ctx.data.ads.map((ad, i) =>
    toAdView(
      ad,
      assets[i],
      { thumbUrl: thumbs[i], assetUrl: fulls[i] },
      ctx.account.meanRoas,
      ctx.account.spend,
      thresholds
    )
  );
}
