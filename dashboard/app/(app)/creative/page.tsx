/**
 * Screen 1, Creatives.
 *
 * The first thing anyone sees, and the one that has to survive being wrong
 * about everything else: it works on an entirely untagged account, because
 * every figure on it comes from Meta. The tags only decide what the filters can
 * do.
 *
 * ── The scorecard's second row is the argument ─────────────────────────────
 * Spend, ROAS, CPA and purchases are the ordinary four. Winners, carriers,
 * losers and hit rate are the four that judge everything else: a net-new hit
 * rate far below the client's own 12-month rate is the case for spending 80% of
 * production on iterations of proven winners rather than on new ideas, and for
 * cutting the active persona set. It belongs on the first screen, not buried in
 * a report.
 *
 * ── One winner test ────────────────────────────────────────────────────────
 * Every count and colour on this page comes from the same `classify()` as the
 * hit rate: the client's read threshold, shrunk ROAS against target with the
 * stored 365-day anchor, and 14 days of age. The scorecard counts ads WITH
 * DELIVERY in the window; the hit rate counts ads FIRST DELIVERED in it.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeBar } from "@/components/creative/CreativeBar";
import { PageControls } from "@/components/controls/PageControls";
import { CreativeGrid } from "@/components/creative/CreativeGrid";
import { UnmappedQueue } from "@/components/creative/UnmappedQueue";
import { HitRateTrend, type HitRateTrendState } from "@/components/creative/HitRateTrend";
import { getLaunches } from "@/lib/queries/creativeLaunch";
import {
  FORMAT_FILTERS,
  conceptSplit,
  deltaWithheld,
  hitRate,
  inRange,
  launchContext,
  launchMonths,
  packHitRate,
  referenceRate,
  tileText,
  updatedLabel,
  type FormatFilter,
} from "@/lib/creative/hitRate";
import { toQueueProposal, type QueueRow } from "@/lib/creative/view";
import {
  CreativeNotConnected,
  Scorecard,
  SectionHead,
  rateChange,
} from "@/components/creative/primitives";
import { NoData, NotConnected } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { ageOf, buildAdViews, loadCreative } from "@/lib/creative/page";
import { WINNER_MIN_AGE_DAYS, winnerEconomics } from "@/lib/creative/model";
import { conceptLabel } from "@/lib/creative/display";
import { CONFIRM_THRESHOLD, propose } from "@/lib/creative/matching";
import { formatNumber, NO_VALUE } from "@/lib/format";
import { comparisonLabel, rangeLabel } from "@/lib/params";
import { money, roas, unitMoney } from "@/components/creative/primitives";
import type { AdView } from "@/lib/creative/view";

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || null;

/** The page's own URL with the trend's format filter changed, every other param kept. */
function formatHref(
  search: { [k: string]: string | string[] | undefined },
  format: FormatFilter
): string {
  const q = new URLSearchParams();
  for (const key of Object.keys(search)) {
    const v = one(search[key]);
    if (v !== null && key !== "hrfmt") q.set(key, v);
  }
  if (format !== "all") q.set("hrfmt", format);
  const qs = q.toString();
  return `/creative${qs ? `?${qs}` : ""}`;
}

/**
 * What to call a linked-in filter value.
 *
 * The link carries the value the grid matches on, which for a concept is an id
 * and for a format is `DYN`, and for an ad is its id. The chip should say the
 * concept's name, "Video" or the ad's name, so the label is read off the first ad that matches: whatever the
 * Creatives grid calls that ad, the chip calls the filter.
 */
function displayFor(ads: AdView[], field: string, value: string): string | null {
  const hit = ads.find(
    (a) => ((a as unknown as Record<string, unknown>)[field] ?? null) === value
  );
  if (!hit) return null;
  if (field === "conceptId") return conceptLabel(hit.conceptId, hit.conceptName) ?? value;
  if (field === "adId") return hit.adName ?? value;
  if (field === "campaignId") return hit.campaignName ?? value;
  if (field === "format") return hit.format === "DYN" ? "Video" : hit.format === "STAT" ? "Static" : value;
  return value;
}

export const metadata: Metadata = { title: "Creatives" };
export const dynamic = "force-dynamic";

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  // This is the one Creative screen that shows a comparison, so it is the one
  // that asks for the comparison period's totals and turns Compare on.
  const loaded = await loadCreative(searchParams, { compare: true });
  if (loaded.status === "not-connected") {
    return <CreativeNotConnected title="Creatives" source={loaded.source} />;
  }
  const { ctx } = loaded;
  const { client, currency, data, thresholds, hitThresholds, display, account } = ctx;

  // Rendered against `display`, which equals `thresholds` when they are set and
  // is a judgement-free stand-in when they are not. The wall of creative is the
  // product; it does not wait for anybody to visit Settings.
  const comparison = ctx.params.period.comparison;
  const launchRange =
    comparison && comparison.from < ctx.params.range.from
      ? { from: comparison.from, to: ctx.params.range.to }
      : ctx.params.range;
  const [views, launches] = await Promise.all([
    data.available ? buildAdViews(ctx, display) : Promise.resolve([] as AdView[]),
    // The hit rate counts ads by FIRST delivery, lifetime to date, so it reads
    // its own table rather than the period totals above. Not ready reads as
    // n/a, never as zero.
    // With a comparison selected the read also reaches back to the comparison
    // period's start, so its launches are loaded for the Hit rate tile.
    data.available
      ? getLaunches(client.clientId, launchRange)
      : Promise.resolve(null),
  ]);

  const formatParam = one(searchParams.hrfmt);
  const format: FormatFilter = FORMAT_FILTERS.find((f) => f === formatParam) ?? "all";
  const launched = launches && launches.state === "ready" ? launches : null;
  // The hit rate needs a target ROAS and a read threshold, not a Target CPA
  // (`hitThresholds`), so a client without a CPA still gets one.
  const hit = launched ? hitRate(inRange(launched.rows, ctx.params.range), hitThresholds) : null;
  // The reference is the client's own hit rate over its trailing 365 days of
  // launches. There is no fixed benchmark.
  const reference = launched ? referenceRate(launched.rows, hitThresholds, launched.through) : null;
  const hitText = tileText(hit, hitThresholds, reference);
  // The comparison period's hit rate, read from the same launch table. A
  // period with no launches has no rate (zero launches is not a 0% hit rate),
  // so the tile then carries no change at all. While the current cohort is
  // still maturing and the comparison is settled, the older cohort simply had
  // more time to win: no change either (Reports withholds on the same rule).
  const prevHit =
    launched && comparison && hitThresholds
      ? hitRate(inRange(launched.rows, comparison), hitThresholds)
      : null;
  const trendState: HitRateTrendState = !launched
    ? "not-ready"
    : hitThresholds
      ? "ready"
      : "no-thresholds";
  const rangeRows = launched ? inRange(launched.rows, ctx.params.range) : [];
  const split = launched ? conceptSplit(rangeRows, hitThresholds) : null;
  // New ad set vs added to an existing one, and the pack-level rate. Both read
  // as not ready until the launch table carries the ad set columns.
  const context = launched ? launchContext(rangeRows, hitThresholds) : null;
  const packs = launched ? packHitRate(rangeRows, hitThresholds, ctx.params.range) : null;
  const updated = updatedLabel(launched?.refreshedAt ?? null);

  // ── A filter linked in from Breakdown or Concepts ───────────────────────
  // `?focus=<AdView field>&is=<raw value>`. The display text is taken from the
  // first ad that matches rather than from the URL, so a concept arrives as its
  // name and a format as "Video", the reader never sees the id the link was
  // actually built on.
  const focusField = one(searchParams.focus);
  const focusValue = one(searchParams.is);
  const focus =
    focusField && focusValue
      ? {
          field: focusField,
          value: focusValue,
          display:
            displayFor(views, focusField, focusValue) ?? focusValue,
        }
      : null;
  const w = thresholds
    ? winnerEconomics(data.ads, account.anchorRoas, thresholds, (id) => ageOf(ctx, id))
    : null;

  // ── Against the comparison period ───────────────────────────────────────
  // Only these four. They are account-level sums with enough events behind them
  // to move for a reason; the verdict counts below them are small integers, and
  // a winner count going from one to two is not "up 100%".
  const prev = ctx.previous;
  const prevRoas = prev && prev.spend > 0 ? prev.revenue / prev.spend : null;
  const prevCpa = prev && prev.purchases > 0 ? prev.spend / prev.purchases : null;
  const compare = comparisonLabel(ctx.params);

  const tiles = [
    {
      label: "Spend",
      value: money(account.spend, currency),
      sub: `${account.ads} creatives`,
      change: prev
        ? { current: account.spend, previous: prev.spend, kind: "money" as const, currency }
        : null,
      // Spending more is neither good nor bad on its own, and colouring it
      // would assert a judgement the number does not support.
      goodWhen: "neutral" as const,
    },
    {
      label: "Blended ROAS",
      value: roas(account.meanRoas),
      sub: thresholds ? `target ${thresholds.targetRoas.toFixed(2)}` : "no target set",
      change: { current: account.meanRoas, previous: prevRoas, kind: "ratio" as const },
      goodWhen: "up" as const,
    },
    {
      label: "CPA",
      value: unitMoney(account.cpa, currency),
      sub: thresholds ? `target ${unitMoney(thresholds.targetCpa, currency)}` : "no target set",
      change: {
        current: account.cpa,
        previous: prevCpa,
        kind: "money" as const,
        currency,
      },
      goodWhen: "down" as const,
    },
    {
      label: "Purchases",
      value: formatNumber(account.purchases),
      sub: compare ?? undefined,
      change: prev
        ? { current: account.purchases, previous: prev.purchases, kind: "count" as const }
        : null,
      goodWhen: "up" as const,
    },
    // The four that judge the rest. They need a kill line and a target to mean
    // anything, so without them they read as absent rather than as zero, a
    // "0 winners" on an account with no target set is a claim, and a false one.
    {
      label: "Winners with delivery in period",
      value: w ? String(w.winners) : NO_VALUE,
      sub: w ? `${w.decided} decided` : undefined,
      info: `Ads with delivery in the period at or above target ROAS, with enough purchases to read and ${WINNER_MIN_AGE_DAYS}+ days since first delivery.`,
    },
    {
      label: "Carriers",
      value: w ? String(w.carriers) : NO_VALUE,
      info: "Above the kill line, under target.",
    },
    {
      label: "Losers",
      value: w ? String(w.losers) : NO_VALUE,
      info: "Below the kill line.",
    },
    // Not winners over ads with delivery: that moves with how many old ads
    // are still running. Winners over ads FIRST delivered in the period.
    {
      label: "Hit rate",
      value: hitText.value ?? NO_VALUE,
      sub: hitText.sub,
      info: hitText.info,
      // Percentage points in both modes, and only when the comparison period
      // launched something.
      change:
        prevHit && hit && !deltaWithheld(hit, prevHit)
          ? rateChange(hit.rate, prevHit.rate, prevHit.launched)
          : null,
      goodWhen: "up" as const,
    },
  ];

  return (
    <>
      <Header title="Creatives" />
      <PageControls client={client} params={ctx.params} compare />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-4 lg:px-8">

        <div className="flex flex-wrap items-center justify-between gap-3">
          <CreativeBar
            unmapped={ctx.unmappedCount}
            through={data.through}
            updated={updated}
            currency={currency}
            href="#unmapped"
          />
        </div>

        {!thresholds && data.available && data.ads.length > 0 && (
          <Notice tone="warning">No verdicts. Set thresholds in Settings.</Notice>
        )}

        {!data.available ? (
          <NotConnected source="Creative data" />
        ) : data.ads.length === 0 ? (
          <NoData />
        ) : (
          <>
            <Scorecard tiles={tiles} />

            <HitRateTrend
              state={trendState}
              months={
                launched
                  ? launchMonths(launched.rows, thresholds, launched.through, ctx.params.range, format)
                  : []
              }
              format={format}
              hrefs={Object.fromEntries(
                FORMAT_FILTERS.map((f) => [f, formatHref(searchParams, f)])
              ) as Record<FormatFilter, string>}
              concepts={split ? split.rows : null}
              reference={reference}
              context={context}
              packs={packs}
            />

            <SectionHead title="Every creative" />

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
              targetCpa={display.targetCpa}
              directionalPurchases={display.directionalPurchases}
              focus={focus}
              rangeLabel={rangeLabel(ctx.params)}
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
