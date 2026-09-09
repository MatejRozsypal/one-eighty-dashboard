/**
 * Screen 5 — Production ROI.
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
import { CreativeTabs } from "@/components/creative/CreativeTabs";
import { PageControls } from "@/components/controls/PageControls";
import {
  ConfidenceChip,
  NotIngested,
  Scorecard,
  SectionHead,
  ThresholdsMissing,
  money,
  pct,
} from "@/components/creative/primitives";
import { loadCreativeContext } from "@/lib/creative/page";
import { getCreatorTerms, getProductionRates } from "@/lib/creative/store";
import { adCost, contributionMargin, type CreatorTerms, type ProductionRate } from "@/lib/creative/cost";
import { classify, groupBy, sum } from "@/lib/creative/model";
import { confidenceOf } from "@/lib/creative/stats";

export const metadata: Metadata = { title: "Production ROI" };
export const dynamic = "force-dynamic";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const ctx = await loadCreativeContext(searchParams);
  const { client, currency, data, thresholds, display, account } = ctx;
  // What a creative cost and what it returned is a measurement; which of them
  // "won" is a judgement. So the cost table renders either way and only the
  // cost-to-first-winner tiles wait for the lines to be set.
  const judged = thresholds !== null;
  if (!data.available || data.ads.length === 0) {
    return (
      <Shell ctx={ctx}>
        <NotIngested what="No delivery to price yet." object={data.missing} />
      </Shell>
    );
  }

  const [rates, terms] = await Promise.all([
    getProductionRates(client.clientId),
    getCreatorTerms(client.clientId),
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
      label: g.untagged ? "— unattributed —" : g.label,
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
        ? g.ads.filter((a) => classify(a.components, account.meanRoas, thresholds) === "winner").length
        : 0,
      confidence: confidenceOf(components.purchases, display),
    };
  });

  const totalProduction = rows.reduce((a, r) => a + (r.production ?? 0), 0);
  const totalWinners = rows.reduce((a, r) => a + r.winners, 0);
  // Stated where ClickUp says so, inferred from b1h1 only for the ads that
  // predate the field — the same precedence the velocity gauge uses, so the two
  // screens cannot report different net-new hit rates.
  const stated = data.ads.filter((a) => a.tags.productionType !== null);
  const netNew =
    stated.length > 0
      ? stated.filter((a) => a.tags.productionType === "Net-new")
      : data.ads.filter(
          (a) => (a.tags.hookCode ?? "h1") === "h1" && (a.tags.bodyCode ?? "b1") === "b1"
        );
  const netNewWinners = judged
    ? netNew.filter((a) => classify(a.components, account.meanRoas, thresholds) === "winner").length
    : 0;
  const burned = judged
    ? data.ads
        .filter((a) => classify(a.components, account.meanRoas, thresholds) !== "winner")
        .reduce((a, b) => a + b.components.spend, 0)
    : 0;

  const unpriced = rows.some((r) => r.pricedShare < 1);

  return (
    <Shell ctx={ctx}>
      {!judged && <ThresholdsMissing clientName={client.name} />}

      {(unpriced || rates.length === 0) && (
        <div className="glass flex flex-col gap-2 border-warning/40 p-5">
          <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-warning">
            Costs are mostly estimates
          </span>
          <p className="m-0 max-w-[74ch] text-[13px] leading-[1.7] text-content-body">
            {rates.length === 0
              ? "No per-asset rates have been entered, so nothing below has a cost basis at all."
              : "Some ads have no production cost, so their rows are priced from the per-asset rate for the method."}{" "}
            The ClickUp <span className="font-mono">Production cost</span> field is what turns
            this from an estimate into a measurement. Until it is filled in, read the return
            column as an order of magnitude and nothing finer.
          </p>
        </div>
      )}

      <div className="glass-solid overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse">
          <thead>
            <tr>
              {["Made by", "Ads", "Priced", "Cost / asset", "Production", "Ad spend", "Contribution", "Net of production", "Return", "Confidence"].map(
                (h, i) => (
                  <th key={h}
                      className={`border-b border-hairline bg-gray-50/60 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted ${
                        i === 0 || i === 9 ? "text-left" : "text-right"
                      }`}>
                    {h}
                  </th>
                )
              )}
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
                <Cell>{r.costPerAsset === null ? "unpriced" : money(r.costPerAsset, currency)}</Cell>
                <Cell>{r.production === null ? "—" : money(r.production, currency)}</Cell>
                <Cell>{money(r.spend, currency)}</Cell>
                <Cell>{r.cm === null ? "no margin set" : money(r.cm, currency)}</Cell>
                <td className={`border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] tabular ${
                  r.net === null ? "text-content-muted" : r.net >= 0 ? "text-positive" : "text-negative"
                }`}>
                  {r.net === null ? "—" : money(r.net, currency)}
                </td>
                <td className={`border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] font-medium tabular ${
                  r.ret === null ? "text-content-muted" : r.ret >= 1 ? "text-positive" : "text-negative"
                }`}>
                  {r.ret === null ? "—" : `${r.ret.toFixed(2)}×`}
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
        <SectionHead title="Cost to first winner" eyebrow="the number that judges the rest" />
        {/*
          This is the argument for the 80/20 split in one row of tiles. A
          net-new hit rate far below the ~5% reference is not an argument for
          better briefs; it is an argument for making fewer new ideas and more
          iterations of the one that already works.
        */}
        <Scorecard
          tiles={[
            {
              label: "Net-new hit rate",
              value: netNew.length ? pct(netNewWinners / netNew.length) : "—",
              sub: `${netNewWinners} from ${netNew.length} first-hook ads`,
            },
            {
              label: "Ads per winner",
              value: totalWinners > 0 ? String(Math.round(data.ads.length / totalWinners)) : "—",
              sub: "reference is about 20 at a 5% hit rate",
            },
            {
              label: "Production per winner",
              value: totalWinners > 0 ? money(totalProduction / totalWinners, currency) : "—",
              sub: `${money(totalProduction, currency)} across ${data.ads.length} ads`,
            },
            {
              label: "Media burned per winner",
              value: totalWinners > 0 ? money(burned / totalWinners, currency) : money(burned, currency),
              sub: totalWinners > 0 ? "on the ones that never cleared" : "no winner yet",
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
      {children}
    </td>
  );
}

function Shell({
  ctx,
  children,
}: {
  ctx: Awaited<ReturnType<typeof loadCreativeContext>>;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header eyebrow={`Creative · ${ctx.client.name}`} title="Production ROI" />
      <PageControls client={ctx.client} params={ctx.params} />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        <CreativeTabs unmapped={ctx.unmappedCount} href="/creative#unmapped" />
        <CreativeBar
          unmapped={0}
          through={ctx.data.through}
          currency={ctx.currency}
          href="/creative#unmapped"
        />
        {children}
      </main>
    </>
  );
}
