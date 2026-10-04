/**
 * Paid > GA4. What GA4 credits to paid traffic, set against what the ad
 * platforms claim and what the shop booked.
 *
 * States, in order: capability off (not connected), view not deployed (not
 * connected), no rows ever (no data), last day older than 3 days (one line),
 * no rows in range (no data). The page root stays a fragment of header,
 * controls and main: the Paid layout orders those siblings.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { addDays, todayUtc } from "@/lib/period";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { formatNumber } from "@/lib/format";
import {
  GA4_FUNNEL_CHANNELS,
  GA4_LANDING_FILTERS,
  getGa4Channels,
  getGa4CrossCheck,
  getGa4Funnel,
  getGa4Kpis,
  getGa4LandingPages,
  getGa4LastDate,
  parseChoice,
} from "@/lib/queries/paidGa4";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Notice } from "@/components/ui/Notice";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import { Ga4Kpis } from "@/components/paid/ga4/Ga4Kpis";
import { CrossCheck } from "@/components/paid/ga4/CrossCheck";
import { Ga4Channels } from "@/components/paid/ga4/Ga4Channels";
import { Ga4Funnel } from "@/components/paid/ga4/Ga4Funnel";
import { LandingPages } from "@/components/paid/ga4/LandingPages";

export const metadata: Metadata = { title: "Paid" };
export const dynamic = "force-dynamic";

/** GA4 exports run a day behind; older than this many days counts as stale. */
const STALE_AFTER_DAYS = 3;

const MAIN = "page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8";
const CARD =
  "overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm";
const CARD_HEAD = "flex items-center justify-between gap-3 border-b border-hairline px-5 py-4";

/** "Aug 19" from a YYYY-MM-DD string, in UTC so the day never shifts. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function PaidGa4Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const notConnected = (source: string) => (
    <>
      <Header title="Paid" />
      <main className={MAIN}>
        <NotConnected source={source} />
      </main>
    </>
  );

  if (pageAvailability(client, "/paid/ga4") !== "available") {
    return notConnected(missingSource(client, "/paid/ga4") ?? "GA4");
  }

  // First call: it also tells us whether the mart view exists yet.
  const last = await getGa4LastDate(client.clientId);
  if (!last.available) return notConnected("GA4");

  const stale =
    last.lastDate !== null && last.lastDate < addDays(todayUtc(), -STALE_AFTER_DAYS);

  if (last.lastDate === null || stale) {
    return (
      <>
        <Header title="Paid" />
        <PageControls client={client} params={params} compare />
        <main className={MAIN}>
          {last.lastDate === null ? (
            <NoData />
          ) : (
            <Notice tone="warning">No GA4 data since {shortDate(last.lastDate)}.</Notice>
          )}
        </main>
      </>
    );
  }

  const channel = parseChoice(searchParams.ch, GA4_FUNNEL_CHANNELS);
  const landing = parseChoice(searchParams.lp, GA4_LANDING_FILTERS);
  const hasMeta = client.capabilities.meta;
  const hasGoogle = client.capabilities.googleAds;
  const basis = client.shopPlatform === "shopify" ? "gross" : "net";
  const currency = client.currency;

  const [kpis, cross, channels, funnel, pages] = await Promise.all([
    getGa4Kpis(client.clientId, params.period),
    getGa4CrossCheck(client.clientId, params.range, basis, currency),
    getGa4Channels(client.clientId, params.range),
    getGa4Funnel(client.clientId, params.range, channel),
    getGa4LandingPages(client.clientId, params.range, landing),
  ]);

  if (kpis.current.rows === 0) {
    return (
      <>
        <Header title="Paid" />
        <PageControls client={client} params={params} compare />
        <main className={MAIN}>
          <NoData />
        </main>
      </>
    );
  }

  const fxMissing = kpis.current.fxMissing ?? 0;

  return (
    <>
      <Header title="Paid" />
      <PageControls client={client} params={params} compare />
      <main className={MAIN}>
        {fxMissing > 0 && (
          <Notice tone="warning">
            {formatNumber(fxMissing)} orders excluded from revenue totals.
          </Notice>
        )}

        <Ga4Kpis kpis={kpis} currency={currency} />

        <section className={CARD}>
          <div className={CARD_HEAD}>
            <Eyebrow>Cross-check</Eyebrow>
          </div>
          <CrossCheck data={cross} currency={currency} hasMeta={hasMeta} hasGoogle={hasGoogle} />
        </section>

        <section className={CARD}>
          <div className={CARD_HEAD}>
            <Eyebrow>Paid channels</Eyebrow>
          </div>
          <Ga4Channels rows={channels} currency={currency} />
        </section>

        <section className={`${CARD} p-[24px_20px] lg:p-[24px_28px]`}>
          <div className="mb-4">
            <Eyebrow>Funnel</Eyebrow>
          </div>
          <Ga4Funnel counts={funnel} channel={channel} />
        </section>

        <section className={CARD}>
          <div className={CARD_HEAD}>
            <Eyebrow>Landing pages</Eyebrow>
          </div>
          <div className="pt-4">
            <LandingPages
              rows={pages}
              currency={currency}
              filter={landing}
              hasMeta={hasMeta}
              hasGoogle={hasGoogle}
            />
          </div>
        </section>
      </main>
    </>
  );
}
