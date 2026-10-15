/**
 * Markets, Trends & analysis: the deeper reads behind the Overview.
 *
 * The Overview (/markets) stays a brief look-through: map, leaderboard, P&L
 * matrix. Everything that needs a chart to answer lives here: the portfolio
 * of nCAC against GP per customer, weekly trends by market, what changed
 * against the compare period and why, how new customers respond to spend
 * (with a reallocation estimate), the GA4 funnel by market and order values
 * against the free-shipping threshold.
 *
 * The screen lives in components/markets/trends/TrendsScreen.tsx.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { TrendsScreen } from "@/components/markets/trends/TrendsScreen";

export const metadata: Metadata = { title: "Markets trends & analysis" };
export const dynamic = "force-dynamic";

export default async function MarketsTrendsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  return <TrendsScreen client={client} searchParams={searchParams} />;
}
