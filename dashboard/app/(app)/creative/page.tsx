/**
 * Screen 1 — Creatives.
 *
 * The first thing anyone sees, and the one that has to survive being wrong
 * about everything else: it works on an entirely untagged account, because
 * every figure on it comes from Meta. The tags only decide what the filters can
 * do.
 *
 * ── The scorecard's second row is the argument ─────────────────────────────
 * Spend, ROAS, CPA and purchases are the ordinary four. Winners, carriers,
 * losers and hit rate are the four that judge everything else — a 1.5% net-new
 * hit rate against a ~5% reference is the entire case for spending 80% of
 * production on iterations of proven winners rather than on new ideas, and for
 * cutting the active persona set. It belongs on the first screen, not buried in
 * a report.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeBar } from "@/components/creative/CreativeBar";
import { CreativeGrid } from "@/components/creative/CreativeGrid";
import { UnmappedQueue } from "@/components/creative/UnmappedQueue";
import { toQueueProposal, type QueueRow } from "@/lib/creative/view";
import { NotIngested, Scorecard, SectionHead, ThresholdsMissing } from "@/components/creative/primitives";
import { WindowToggle } from "@/components/creative/WindowToggle";
import { buildAdViews, loadCreativeContext } from "@/lib/creative/page";
import { winnerEconomics } from "@/lib/creative/model";
import { CONFIRM_THRESHOLD, propose } from "@/lib/creative/matching";
import { formatMoney } from "@/lib/currency";
import { money, pct, roas } from "@/components/creative/primitives";

export const metadata: Metadata = { title: "Creatives" };
export const dynamic = "force-dynamic";

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const ctx = await loadCreativeContext(searchParams);
  const { client, currency, data, thresholds, account } = ctx;

  return (
    <>
      <Header eyebrow={`Creative · ${client.name}`} title="Creatives" />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CreativeBar
            unmapped={ctx.unmappedCount}
            window={ctx.window}
            through={data.through}
            currency={currency}
            href="#unmapped"
          />
          <WindowToggle current={ctx.window} />
        </div>

        {!data.available ? (
          <NotIngested
            what="No creative performance in the warehouse yet."
            object={data.missing}
            hint="The migrations in infra/bigquery/219–224 create the objects this screen reads, and the nightly jobs fill them. Until then there is nothing to show, and showing zeroes instead would be a lie somebody would eventually quote."
          />
        ) : data.ads.length === 0 ? (
          <NotIngested
            what={`No Meta delivery for ${client.name} in this window.`}
            hint="Widen the window, or check that the Meta workflow is running for this client."
          />
        ) : !thresholds ? (
          <>
            <ThresholdsMissing clientName={client.name} />
            <Delivery account={account} currency={currency} />
          </>
        ) : (
          <>
            <Scorecard
              tiles={(() => {
                const w = winnerEconomics(data.ads, account.meanRoas, thresholds);
                return [
                  { label: "Spend", value: money(account.spend, currency), sub: `${account.ads} creatives` },
                  { label: "Blended ROAS", value: roas(account.meanRoas), sub: `target ${thresholds.targetRoas.toFixed(2)}` },
                  { label: "CPA", value: money(account.cpa, currency), sub: `target ${formatMoney(thresholds.targetCpa, currency)}` },
                  { label: "Purchases", value: account.purchases.toLocaleString("en-US"), sub: ctx.window === "lifetime" ? "lifetime" : "last 30 days" },
                  { label: "Winners", value: String(w.winners), sub: `${w.decided} decided` },
                  { label: "Carriers", value: String(w.carriers), sub: "above kill, under target" },
                  { label: "Losers", value: String(w.losers), sub: "below the kill line" },
                  { label: "Hit rate", value: pct(w.hitRate), sub: "reference 5%" },
                ];
              })()}
            />

            <SectionHead title="Every creative" eyebrow="ranked by spend" />

            <CreativeGrid
              ads={await buildAdViews(ctx, thresholds)}
              currency={currency}
              clientId={client.clientId}
              killRoas={thresholds.killRoas}
              targetRoas={thresholds.targetRoas}
              directionalPurchases={thresholds.directionalPurchases}
            />
          </>
        )}

        <div id="unmapped">
          {ctx.unmapped.available && ctx.unmapped.ads.length > 0 && (
            <UnmappedQueue
              rows={ctx.unmapped.ads.map<QueueRow>((ad) => ({
                adId: ad.adId,
                adName: ad.adName,
                spend: ad.spend,
                purchases: ad.purchases,
                // Scored on the server: the candidate list is the whole ad
                // pipeline, and shipping it to the browser to run string
                // similarity in a component would be both slower and a
                // needless disclosure of every task name.
                proposal: toQueueProposal(propose(ad.adName, ctx.unmapped.candidates)),
              }))}
              candidates={ctx.unmapped.candidates}
              clientId={client.clientId}
              currency={currency}
              confirmThreshold={CONFIRM_THRESHOLD}
            />
          )}
        </div>
      </main>
    </>
  );
}

/**
 * Delivery without verdicts.
 *
 * Rendered when a client has no thresholds on file. The spend is real and worth
 * seeing; the judgement is not available, and inventing a target so the screen
 * looks complete would produce verdicts indistinguishable from real ones.
 */
function Delivery({
  account,
  currency,
}: {
  account: { spend: number; revenue: number; purchases: number; meanRoas: number; cpa: number | null; ads: number };
  currency: string;
}) {
  return (
    <Scorecard
      tiles={[
        { label: "Spend", value: money(account.spend, currency), sub: `${account.ads} creatives` },
        { label: "Revenue", value: money(account.revenue, currency), sub: "Meta reported" },
        { label: "Blended ROAS", value: roas(account.meanRoas), sub: "no target set" },
        { label: "Purchases", value: account.purchases.toLocaleString("en-US"), sub: "in window" },
      ]}
    />
  );
}
