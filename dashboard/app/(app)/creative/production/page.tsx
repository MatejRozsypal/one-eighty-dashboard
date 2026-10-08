/**
 * Screen 5, Production ROI.
 *
 * What each way of making a creative costs, and what it returned.
 *
 * ── Why this ships last, and why it says so ────────────────────────────────
 * It needs the ClickUp `Production cost` field, which does not exist yet, and
 * per-asset rates that nobody has entered. Until both are filled in, every cost
 * on this screen is an estimate, and a contribution-margin figure built on
 * estimates is worth exactly as much as the estimates. So the table carries a
 * column saying what share of each row's cost was measured rather than assumed,
 * and a method with no rate at all is shown as unpriced rather than as free.
 *
 * ── Contribution margin appears here and not at ad level ───────────────────
 * The production cost of one ad in a six-hook batch is an allocation, not a
 * measurement. Dividing a shoot six ways and then ranking the six on the result
 * compares allocation noise. Here the cost is the subject rather than a divisor,
 * which is the one place the allocation is fair to make.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeBar } from "@/components/creative/CreativeBar";
import { PageControls } from "@/components/controls/PageControls";
import {
  ConfidenceChip,
  CreativeNotConnected,
  Scorecard,
  SectionHead,
  money,
  pct,
} from "@/components/creative/primitives";
import { NoData, NoValue, NotConnected } from "@/components/ui/EmptyState";
import { InfoTip } from "@/components/ui/InfoTip";
import { Notice } from "@/components/ui/Notice";
import { isNoValue, NO_VALUE } from "@/lib/format";
import { ageOf, loadCreative, type CreativeContext } from "@/lib/creative/page";
import { getLaunches } from "@/lib/queries/creativeLaunch";
import { HIT_RATE_REFERENCE_LABEL, formatRate, hitRate, inRange, referenceRate } from "@/lib/creative/hitRate";
import { getCreatorTerms, getProductionRates } from "@/lib/creative/store";
import { adCost, contributionMargin, type CreatorTerms, type ProductionRate } from "@/lib/creative/cost";
import { classify, groupBy, sum } from "@/lib/creative/model";
import { confidenceOf } from "@/lib/creative/stats";
import { isNetNew } from "@/lib/creative/velocity";

export const metadata: Metadata = { title: "Production ROI" };
export const dynamic = "force-dynamic";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const loaded = await loadCreative(searchParams);
  if (loaded.status === "not-connected") {
    return <CreativeNotConnected title="Production ROI" source={loaded.source} />;
  }
  const { ctx } = loaded;
  const { client, currency, data, thresholds, display, account } = ctx;
  // What a creative cost and what it returned is a measurement; which of them
  // "won" is a judgement. So the cost table renders either way and only the
  // cost-to-first-winner tiles wait for the lines to be set.
  const judged = thresholds !== null;
  if (!data.available || data.ads.length === 0) {
    return (
      <Shell ctx={ctx}>
        {data.available ? <NoData /> : <NotConnected source="Creative data" />}
      </Shell>
    );
  }

  const [rates, terms, launches] = await Promise.all([
    getProductionRates(client.clientId),
    getCreatorTerms(client.clientId),
    // The launch cohort behind the "Net-new hit rate" tile: the same table and
    // the same hitRate() as the Creative tile.
    getLaunches(client.clientId, ctx.params.range),
  ]);
  const rateList: ProductionRate[] = rates.map((r) => ({
    productionMethod: r.productionMethod,
    format: r.format,
    costPerAsset: r.costPerAsset,
    includesInternalTime: r.includesInternalTime,
  }));
  const termsById = new Map<string, CreatorTerms>(
    terms.map((t) => [t.creatorId, { ...t }])
  );

  const groups = groupBy(data.ads, (ad) => ad.tags.productionMethod);

  const rows = groups.map((g) => {
    const components = sum(g.ads);
    const costs = g.ads.map((ad) =>
      adCost({
        manualCost: ad.tags.productionCost,
        productionMethod: ad.tags.productionMethod,
        format: ad.tags.format,
        creator: ad.tags.creatorId ? (termsById.get(ad.tags.creatorId) ?? null) : null,
        rates: rateList,
        attributedRevenue: ad.components.revenue,
      })
    );
    const priced = costs.filter((c) => c.cost !== null);
    const production = priced.reduce((a, c) => a + (c.cost ?? 0), 0);
    const cm = contributionMargin(components.revenue, components.spend, display.grossMargin);

    return {
      key: g.key,
      label: g.label,
      ads: g.ads.length,
      // The share of this row's cost that is a real number rather than a rate
      // somebody typed into settings. The whole row is only as good as this.
      measured: priced.length ? costs.filter((c) => c.source === "manual").length / priced.length : 0,
      pricedShare: g.ads.length ? priced.length / g.ads.length : 0,
      costPerAsset: priced.length ? production / priced.length : null,
      production: priced.length ? production : null,
      spend: components.spend,
      revenue: components.revenue,
      purchases: components.purchases,
      cm,
      net: cm !== null && priced.length ? cm - production : null,
      ret: cm !== null && production > 0 ? cm / production : null,
      winners: judged
        ? g.ads.filter((a) => classify(a.components, account.anchorRoas, thresholds, ageOf(ctx, a.adId)) === "winner").length
        : 0,
      confidence: confidenceOf(components.purchases, display),
    };
  });

  const totalProduction = rows.reduce((a, r) => a + (r.production ?? 0), 0);
  // No cost entered anywhere is an absent input, not free production.
  const anyPriced = rows.some((r) => r.production !== null);
  const totalWinners = rows.reduce((a, r) => a + r.winners, 0);
  // The same rule as the velocity gauge (isNetNew), so the two screens cannot
  // disagree: stated in ClickUp, else b1h1, else unknown and left out.
  const netNew = data.ads.filter((a) => isNetNew(a) === true);
  // The net-new hit rate is hitRate() on the launch cohort (ads first
  // delivered in the window, relaunches excluded), restricted to the ads this
  // screen calls net-new. Same function, same anchor, same age rule as the
  // Creative tile. The reference is the client's own trailing 12-month rate.
  const launched = launches.state === "ready" ? launches : null;
  const netNewIds = new Set(netNew.map((a) => a.adId));
  const netNewHit = launched
    ? hitRate(inRange(launched.rows, ctx.params.range).filter((r) => netNewIds.has(r.adId)), ctx.hitThresholds)
    : null;
  const ownRate = launched ? referenceRate(launched.rows, ctx.hitThresholds, launched.through) : null;
  const burned = judged
    ? data.ads
        .filter((a) => classify(a.components, account.anchorRoas, thresholds, ageOf(ctx, a.adId)) !== "winner")
        .reduce((a, b) => a + b.components.spend, 0)
    : 0;

  const unpriced = rows.some((r) => r.pricedShare < 1);

  return (
    <Shell ctx={ctx}>
      {!judged && <Notice tone="warning">No verdicts. Set thresholds in Settings.</Notice>}

      {(unpriced || rates.length === 0) && (
        <Notice tone="warning">
          Costs are estimates.
          <InfoTip
            text="Priced from per-asset rates unless the ClickUp Production cost field is filled in. Read Return as an order of magnitude."
            label="About costs"
          />
        </Notice>
      )}

      <div className="glass-solid overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse">
          <thead>
            <tr>
              {(
                [
                  ["Made by"],
                  ["Ads"],
                  ["Priced"],
                  ["Cost / asset", "n/a when no rate is set for the method."],
                  ["Production"],
                  ["Ad spend"],
                  ["Contribution", "n/a when no gross margin is set."],
                  ["Net of production"],
                  ["Return"],
                  ["Confidence"],
                ] as Array<[string, string?]>
              ).map(([h, info], i) => (
                <th key={h}
                    className={`border-b border-hairline bg-gray-50/60 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted ${
                      i === 0 || i === 9 ? "text-left" : "text-right"
                    }`}>
                  <span className="inline-flex items-center gap-1.5">
                    {h}
                    {info && <InfoTip text={info} label={`About ${h}`} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.purchases >= display.directionalPurchases ? "" : "row-unreadable"}>
                <td className="border-b border-hairline px-3.5 py-2.5 text-[13px] font-medium text-content-strong">
                  {r.label}
                </td>
                <Cell>{r.ads}</Cell>
                <Cell>{pct(r.pricedShare)}</Cell>
                <Cell>{r.costPerAsset === null ? NO_VALUE : money(r.costPerAsset, currency)}</Cell>
                <Cell>{r.production === null ? NO_VALUE : money(r.production, currency)}</Cell>
                <Cell>{money(r.spend, currency)}</Cell>
                <Cell>{r.cm === null ? NO_VALUE : money(r.cm, currency)}</Cell>
                <td className={`border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] tabular ${
                  r.net === null ? "text-content-muted" : r.net >= 0 ? "text-positive-text" : "text-negative-text"
                }`}>
                  {r.net === null ? NO_VALUE : money(r.net, currency)}
                </td>
                <td className={`border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] font-medium tabular ${
                  r.ret === null ? "text-content-muted" : r.ret >= 1 ? "text-positive-text" : "text-negative-text"
                }`}>
                  {r.ret === null ? NO_VALUE : `${r.ret.toFixed(2)}×`}
                </td>
                <td className="border-b border-hairline px-3.5 py-2.5">
                  <ConfidenceChip level={r.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Every tile in this block counts winners, and there is no such thing
          as a winner without a target ROAS. Rendering it against the display
          stand-ins would put a confident "0 winners" and a 0% hit rate on the
          screen, which reads as a finding rather than as an absent input. */}
      {judged && (
      <section>
        <SectionHead title="Cost per winner" />
        {/*
          This is the argument for the 80/20 split in one row of tiles. A
          a net-new hit rate far below the client's own 12-month rate is not an
          argument for better briefs; it is an argument for making fewer new
          ideas and more iterations of the one that already works.
        */}
        <Scorecard
          tiles={[
            {
              label: "Net-new hit rate",
              value: netNewHit && netNewHit.rate !== null ? (formatRate(netNewHit.rate) ?? NO_VALUE) : NO_VALUE,
              info: netNewHit
                ? `${netNewHit.winners ?? 0} of ${netNewHit.launched} net-new ads first delivered in the window, relaunches excluded.${ownRate === null ? "" : ` ${HIT_RATE_REFERENCE_LABEL}: ${formatRate(ownRate)}.`}`
                : "Launch data is not ready.",
            },
            {
              label: "Ads per winner",
              value: totalWinners > 0 ? String(Math.round(data.ads.length / totalWinners)) : NO_VALUE,
              info: "Ads with delivery in the window per winner.",
            },
            {
              label: "Production per winner",
              value: totalWinners > 0 && anyPriced ? money(totalProduction / totalWinners, currency) : NO_VALUE,
              info: anyPriced
                ? `${money(totalProduction, currency)} across ${data.ads.length} ads.`
                : "No production cost entered.",
            },
            {
              label: "Wasted spend per winner",
              value: totalWinners > 0 ? money(burned / totalWinners, currency) : money(burned, currency),
              info: "Spend on ads that never became winners.",
              sub: totalWinners > 0 ? undefined : "no winner yet",
            },
          ]}
        />
      </section>
      )}
    </Shell>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] tabular text-content-body">
      {isNoValue(children) ? <NoValue /> : children}
    </td>
  );
}

function Shell({
  ctx,
  children,
}: {
  ctx: CreativeContext;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header title="Production ROI" />
      <PageControls client={ctx.client} params={ctx.params} />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        <CreativeBar
          unmapped={ctx.unmappedCount}
          through={ctx.data.through}
          currency={ctx.currency}
          href="/creative#unmapped"
        />
        {children}
      </main>
    </>
  );
}
