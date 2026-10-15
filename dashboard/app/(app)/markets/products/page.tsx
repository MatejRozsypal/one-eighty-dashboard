/**
 * Markets, Products: which products sell in which market, and what a market
 * buys differently from home. Kept light on purpose: shares, units and
 * average selling price, no price index and no buying-power adjustment.
 *
 * The screen lives in components/markets/products/ProductsScreen.tsx.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { ProductsScreen } from "@/components/markets/products/ProductsScreen";

export const metadata: Metadata = { title: "Products by market" };
export const dynamic = "force-dynamic";

export default async function MarketsProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  return <ProductsScreen client={client} searchParams={searchParams} />;
}
