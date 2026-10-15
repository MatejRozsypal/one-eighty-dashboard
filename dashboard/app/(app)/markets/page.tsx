/**
 * Markets: every market of a client compared from top line to bottom line.
 *
 * Four questions (SPEC section 1): where the next unit of spend earns the most
 * contribution, whether a young market is on track or an unsold one worth a
 * test, whether a market is discount-addicted or loses its margin to shipping
 * and COD, and one view a client understands in a call.
 *
 * The ranking column is absolute GP after ads (CM3 once rate cards exist),
 * not ROAS: ratios explain, contribution decides. Period figures follow the
 * date picker and Compare; cohort figures are read at a fixed age from
 * complete cohorts and do not. The LTGP forecast is shown apart, dashed and
 * labelled, and never feeds a total, a ranking or a verdict.
 *
 * The screen itself lives in components/markets/MarketsScreen.tsx.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { MarketsScreen } from "@/components/markets/MarketsScreen";

export const metadata: Metadata = { title: "Markets" };
export const dynamic = "force-dynamic";

export default async function MarketsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  return <MarketsScreen client={client} searchParams={searchParams} />;
}
