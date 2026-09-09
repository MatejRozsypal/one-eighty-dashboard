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
import { CreativeTabs } from "@/components/creative/CreativeTabs";
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
  const { client, currency, data, thresholds, display, account } = ctx;

  // Rendered against `display`, which equals `thresholds` when they are set and
  // is a judgement-free stand-in when they are not. The wall of creative is the
  // product; it does not wait for anybody to visit Settings.
  const views = data.available ? await buildAdViews(ctx, display) : [];
  const w = thresholds ? winnerEconomics(data.ads, account.meanRoas, thresholds) : null;

  const tiles = [
    { label: "Spend", value: money(account.spend, currency), sub: `${account.ads} creatives` },
    {
      label: "Blended ROAS",
      value: roas(account.meanRoas),
      sub: thresholds ? `target ${thresholds.targetRoas.toFixed(2)}` : "no target set",
    },
    {
      label: "CPA",
      value: money(account.cpa, currency),
      sub: thresholds ? `target ${formatMoney(thresholds.targetCpa, currency)}` : "no target set",
    },
    {
      label: "Purchases",
      value: account.purchases.toLocaleString("en-US"),
      sub: ctx.window === "lifetime" ? "lifetime" : "last 30 days",
    },
    // The four that judge the rest. They need a kill line and a target to mean
    // anything, so without them they read as absent rather than as zero — a
    // "0 winners" on an account with no target set is a claim, and a false one.
    {
      label: "Winners",
      value: w ? String(w.winners) : "—",
      sub: w ? `${w.decided} decided` : "needs a target",
    },
    {
      label: "Carriers",
      value: w ? String(w.carriers) : "—",
      sub: w ? "above kill, under target" : "needs a kill line",
    },
    {
      label: "Losers",
      value: w ? String(w.losers) : "—",
      sub: w ? "below the kill line" : "needs a kill line",
    },
    {
      label: "Hit rate",
      value: w ? pct(w.hitRate) : "—",
      sub: "reference 5%",
    },
  ];

  return (
    <>
      <Header eyebrow={`Creative · ${client.name}`} title="Creatives" />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-0 lg:px-8">
        <CreativeTabs unmapped={ctx.unmappedCount} href="#unmapped" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CreativeBar
            unmapped={0}
            window={ctx.window}
            through={data.through}
            currency={currency}
            href="#unmapped"
          />
          <WindowToggle current={ctx.window} />
        </div>

        {!thresholds && data.available && data.ads.length > 0 && (
          <ThresholdsMissing clientName={client.name} />
        )}

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
        ) : (
          <>
            <Scorecard tiles={tiles} />

            <SectionHead title="Every creative" eyebrow="ranked by spend" />

            <CreativeGrid
              ads={views}
              currency={currency}
              clientId={client.clientId}
              // Without real lines nothing is coloured as winning or losing:
              // a kill line of 0 and a target of infinity mean every readable
              // row renders neutral, which is the honest rendering of "no
              // judgement available".
              killRoas={display.killRoas}
              targetRoas={display.targetRoas}
              directionalPurchases={display.directionalPurchases}
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
