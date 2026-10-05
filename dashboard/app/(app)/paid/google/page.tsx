/**
 * Paid > Google tab.
 *
 * Money is in the Google Ads account currency and data ends yesterday. The tab
 * reads the campaign mart once for both periods and derives the KPI rows, the
 * brand split and the campaign table from that one result, so they cannot
 * disagree. Conversions are the purchase category.
 *
 * View state lives in the URL: `class` and `cols` shape the campaign table,
 * `campaign` opens its detail, `src` and `st` pick the search view and filter,
 * `pg` and `zero` shape the product table.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { tabHref } from "@/lib/paid/links";
import { ratio } from "@/lib/paid/math";
import {
  getGadsAdGroups,
  getGadsCampaignAgg,
  getGadsCoverage,
  getGadsDevices,
  getGadsKeywords,
  getGadsLeakage,
  getGadsPmaxSplit,
  getGadsProducts,
  getGadsSearchTerms,
  type GadsProductGroup,
  type GadsTermMode,
} from "@/lib/queries/paidGoogle";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import { GoogleKpis } from "@/components/paid/google/GoogleKpis";
import { BrandSplit } from "@/components/paid/google/BrandSplit";
import {
  GoogleCampaigns,
  type CampaignCols,
  type ClassFilter,
} from "@/components/paid/google/GoogleCampaigns";
import { GoogleCampaignDetail } from "@/components/paid/google/GoogleCampaignDetail";
import { PmaxSplit } from "@/components/paid/google/PmaxSplit";
import { SearchTerms, type SearchSource } from "@/components/paid/google/SearchTerms";
import { Products } from "@/components/paid/google/Products";
import { BRAND_CLASSES, channelSpend } from "@/components/paid/google/aggregate";

export const metadata: Metadata = { title: "Paid" };
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** One of the allowed values, else the fallback. A hand-edited URL never breaks the page. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const COLS: readonly CampaignCols[] = ["outcome", "auction", "budget"];
const SOURCES: readonly SearchSource[] = ["terms", "keywords"];
const MODES: readonly GadsTermMode[] = ["all", "brand", "nonbrand", "waste"];
const GROUPS: readonly GadsProductGroup[] = ["item", "type", "brand", "label0"];
const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,40}$/;

export default async function PaidGooglePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/paid/google") !== "available") {
    return (
      <>
        <Header title="Paid" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/paid/google") ?? "Google"} />
        </main>
      </>
    );
  }

  const currency = client.gadsCurrency ?? client.currency;
  const compare = params.comparisonMode !== "none" && params.period.comparison !== null;

  const cols = oneOf(first(searchParams.cols), COLS, "outcome");
  const cls = oneOf<ClassFilter>(first(searchParams.class), ["all", ...BRAND_CLASSES], "all");
  const source = oneOf(first(searchParams.src), SOURCES, "terms");
  const mode = oneOf(first(searchParams.st), MODES, "all");
  const group = oneOf(first(searchParams.pg), GROUPS, "item");
  const zeroOnly = first(searchParams.zero) === "zero";
  const rawCampaign = first(searchParams.campaign);
  const campaignParam = rawCampaign && CAMPAIGN_ID.test(rawCampaign) ? rawCampaign : null;

  const range = params.period.current;
  const id = client.clientId;

  const [campaigns, leakage, pmaxRows, coverage, terms, keywords, products, adGroups, devices] =
    await Promise.all([
      getGadsCampaignAgg(id, params.period),
      getGadsLeakage(id, params.period),
      getGadsPmaxSplit(id, range),
      getGadsCoverage(id, range),
      source === "terms" ? getGadsSearchTerms(id, range, mode) : Promise.resolve([]),
      source === "keywords" ? getGadsKeywords(id, range) : Promise.resolve([]),
      getGadsProducts(id, range, group, zeroOnly),
      campaignParam ? getGadsAdGroups(id, range, campaignParam) : Promise.resolve([]),
      campaignParam ? getGadsDevices(id, range, campaignParam) : Promise.resolve([]),
    ]);

  const hasDelivery = campaigns.some((c) => (c.current?.spend ?? 0) > 0);

  const controls = <PageControls client={client} params={params} compare />;
  if (!hasDelivery) {
    return (
      <>
        <Header title="Paid" />
        {controls}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  // Links keep the whole view (client, range, comparison and every table state).
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const v = first(value);
    if (v !== undefined) query.set(key, v);
  }
  // Long tables render their top rows only; `more` lists the ones opened up.
  const openTables = new Set((first(searchParams.more) ?? "").split(",").filter(Boolean));
  const moreHrefFor = (table: "terms" | "keywords" | "products", open: boolean) => {
    const next = new Set(openTables);
    if (open) next.add(table);
    else next.delete(table);
    const q = new URLSearchParams(query);
    if (next.size > 0) q.set("more", [...next].sort().join(","));
    else q.delete("more");
    return tabHref("google", q);
  };
  const hrefFor = (campaignId: string) => {
    const q = new URLSearchParams(query);
    q.set("campaign", campaignId);
    return tabHref("google", q);
  };
  const closeHref = tabHref("google", query, { drop: ["campaign"] });

  const selected = campaignParam
    ? (campaigns.find((c) => c.campaignId === campaignParam && c.current !== null) ?? null)
    : null;

  const searchSpend = channelSpend(campaigns, ["SEARCH"]);
  const shopSpend = channelSpend(campaigns, ["SHOPPING", "PERFORMANCE_MAX"]);
  const termCoverage = ratio(coverage.termSpend, searchSpend);
  const productCoverage = ratio(coverage.productSpend, shopSpend);

  const showSearch = (searchSpend ?? 0) > 0 || terms.length > 0 || keywords.length > 0;
  const showProducts = (shopSpend ?? 0) > 0 || products.length > 0;

  return (
    <>
      <Header title="Paid" />
      {controls}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <GoogleKpis campaigns={campaigns} leakage={leakage} currency={currency} compare={compare} />
        <BrandSplit campaigns={campaigns} currency={currency} compare={compare} />
        <GoogleCampaigns
          campaigns={campaigns}
          currency={currency}
          compare={compare}
          cols={cols}
          cls={cls}
          selectedId={selected?.campaignId ?? null}
          hrefFor={hrefFor}
        />
        {selected && (
          <GoogleCampaignDetail
            campaign={selected}
            adGroups={adGroups}
            devices={devices}
            pmaxRows={pmaxRows.filter((r) => r.campaignId === selected.campaignId)}
            currency={currency}
            closeHref={closeHref}
          />
        )}
        <PmaxSplit rows={pmaxRows} currency={currency} />
        {showSearch && (
          <SearchTerms
            source={source}
            mode={mode}
            terms={terms}
            keywords={keywords}
            coverage={termCoverage}
            currency={currency}
            expanded={openTables.has(source)}
            moreHref={moreHrefFor(source, true)}
            lessHref={moreHrefFor(source, false)}
          />
        )}
        {showProducts && (
          <Products
            rows={products}
            group={group}
            zeroOnly={zeroOnly}
            coverage={productCoverage}
            currency={currency}
            expanded={openTables.has("products")}
            moreHref={moreHrefFor("products", true)}
            lessHref={moreHrefFor("products", false)}
          />
        )}
      </main>
    </>
  );
}
