/**
 * Screen 3 — Breakdown.
 *
 * Pick a dimension, see what earned the spend. Lifetime to date, because
 * accumulation is how a small account buys statistical power.
 *
 * ── The coverage gate ──────────────────────────────────────────────────────
 * Below roughly 60% of spend carrying a concept tag, this screen reads less
 * than half the account and the rows it does show are not a sample of anything
 * — they are whatever happened to get filed. It still renders, because hiding
 * it would be its own kind of dishonesty, but it says so at the top and it says
 * so with the measured number rather than a recollection of it.
 *
 * ── Rows nobody can read are greyed and hatched, never hidden ──────────────
 * Dropping them would silently rebase every share-of-spend percentage on a
 * denominator that excludes them, and every remaining figure would still look
 * entirely reasonable.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeBar } from "@/components/creative/CreativeBar";
import { WindowToggle } from "@/components/creative/WindowToggle";
import { DimensionPicker } from "@/components/creative/DimensionPicker";
import {
  IntervalChart,
  ShareOverTime,
  SpendRevenueBars,
  type BreakdownRow,
} from "@/components/creative/BreakdownCharts";
import {
  ConfidenceChip,
  NotIngested,
  SectionHead,
  SpendBar,
  ThresholdsMissing,
  money,
  pct,
  roas,
} from "@/components/creative/primitives";
import { loadCreativeContext } from "@/lib/creative/page";
import { getTagCoverage } from "@/lib/queries/creative";
import { groupBy, read, sum } from "@/lib/creative/model";
import { BREAKDOWN_DIMENSIONS, FORMAT_LABELS, isBreakdownKey, type BreakdownKey, type Format } from "@/lib/creative/vocabulary";
import type { AdRow } from "@/lib/creative/model";

export const metadata: Metadata = { title: "Breakdown" };
export const dynamic = "force-dynamic";

/** Roughly the share of spend below which this screen misleads more than it helps. */
const COVERAGE_FLOOR = 0.6;

const KEY_OF: Record<BreakdownKey, (ad: AdRow) => string | null> = {
  angle: (a) => a.tags.angle,
  persona: (a) => a.tags.personaName ?? a.tags.personaId,
  concept: (a) => (a.tags.conceptId ? `${a.tags.conceptId} ${a.tags.conceptName ?? ""}`.trim() : null),
  offer: (a) => a.tags.offer,
  format: (a) => (a.tags.format ? (FORMAT_LABELS[a.tags.format as Format] ?? a.tags.format) : null),
  stage: (a) => a.tags.stage,
  method: (a) => a.tags.productionMethod,
  creator: (a) => a.tags.creatorName,
  hook: (a) =>
    a.tags.bodyCode || a.tags.hookCode
      ? `${a.tags.bodyCode ?? "b?"}${a.tags.hookCode ?? "h?"}`
      : null,
  // The one dimension that is not a creative tag at all, and the one the
  // learnings file says is the only variable that actually predicts anything in
  // this account: which ad set the ad sat in.
  adset: (a) => a.adsetName,
};

export default async function BreakdownPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const ctx = await loadCreativeContext(searchParams);
  const { client, currency, data, thresholds, account } = ctx;

  const raw = Array.isArray(searchParams.by) ? searchParams.by[0] : searchParams.by;
  const dimension: BreakdownKey = isBreakdownKey(raw) ? raw : "angle";
  const label = BREAKDOWN_DIMENSIONS.find((d) => d.key === dimension)!.label;

  if (!data.available || data.ads.length === 0) {
    return (
      <Shell ctx={ctx} dimension={dimension}>
        <NotIngested
          what="Nothing to break down yet."
          object={data.missing}
          hint="This screen groups the same rows the Creatives grid shows."
        />
      </Shell>
    );
  }
  if (!thresholds) {
    return (
      <Shell ctx={ctx} dimension={dimension}>
        <ThresholdsMissing clientName={client.name} />
      </Shell>
    );
  }

  const coverage = await getTagCoverage(client.clientId);
  const groups = groupBy(data.ads, KEY_OF[dimension]);

  const rows: BreakdownRow[] = groups.map((g) => {
    const c = sum(g.ads);
    const r = read(c, account.meanRoas, account.spend, thresholds);
    return {
      key: g.key,
      label: g.untagged ? "— untagged —" : g.label,
      untagged: g.untagged,
      ads: g.ads.length,
      spend: c.spend,
      spendShare: r.spendShare,
      revenue: c.revenue,
      purchases: c.purchases,
      cpa: c.purchases > 0 ? c.spend / c.purchases : null,
      roas: r.roas,
      roasRaw: r.roasRaw,
      ciLow: r.ciLow,
      ciHigh: r.ciHigh,
      confidence: r.confidence,
      readable: c.purchases >= thresholds.directionalPurchases,
    };
  });

  // Share of spend by month, for the top five rows.
  const months = [
    ...new Set(data.ads.flatMap((a) => a.monthlySpend.map((m) => m.month))),
  ].sort();
  const monthTotals = months.map((m) =>
    data.ads.reduce(
      (acc, a) => acc + (a.monthlySpend.find((x) => x.month === m)?.spend ?? 0),
      0
    )
  );
  const series = groups.slice(0, 5).map((g) => ({
    key: g.key,
    label: g.untagged ? "— untagged —" : g.label,
    values: months.map((m, i) => {
      const spend = g.ads.reduce(
        (acc, a) => acc + (a.monthlySpend.find((x) => x.month === m)?.spend ?? 0),
        0
      );
      return monthTotals[i] > 0 ? spend / monthTotals[i] : 0;
    }),
  }));

  const maxSpend = Math.max(1, ...rows.map((r) => r.spend));

  return (
    <Shell ctx={ctx} dimension={dimension}>
      {coverage.pctSpendTagged !== null && coverage.pctSpendTagged < COVERAGE_FLOOR && (
        <div className="glass flex flex-col gap-2 border-warning/40 p-5">
          <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-warning">
            Reads {pct(coverage.pctSpendTagged)} of the account
          </span>
          <p className="m-0 max-w-[74ch] text-[13px] leading-[1.7] text-content-body">
            Only {pct(coverage.pctSpendTagged)} of the last 90 days&apos; spend carries a
            concept tag, against a working floor of {pct(COVERAGE_FLOOR)}. Every row below is
            real, and the untagged row is shown at its true size — but a comparison between
            two tagged rows is a comparison inside the tagged minority, and it is not a
            statement about the account. Work the unmapped queue before quoting anything
            here.
          </p>
        </div>
      )}

      <div className="glass p-5">
        <h4 className="m-0 mb-3 text-[13px] font-semibold tracking-heading text-content-strong">
          Spend against revenue
        </h4>
        <SpendRevenueBars
          rows={rows}
          killRoas={thresholds.killRoas}
          targetRoas={thresholds.targetRoas}
        />
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-content-muted">
          {[
            ["var(--text-muted)", "Spend"],
            ["var(--accent)", "Revenue, at or above target"],
            ["var(--info)", "Revenue, profitable under target"],
            ["var(--negative)", "Revenue, below the kill line"],
          ].map(([c, l]) => (
            <span key={l}>
              <i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-[-1px]"
                 style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      <div className="glass p-5">
        <h4 className="m-0 mb-3 text-[13px] font-semibold tracking-heading text-content-strong">
          What we can and cannot tell apart
        </h4>
        <IntervalChart
          rows={rows}
          killRoas={thresholds.killRoas}
          targetRoas={thresholds.targetRoas}
        />
      </div>

      <div className="glass-solid overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr>
              {[label, "Ads", "Spend", "Share", "Purch.", "CPA", "ROAS", "Raw", "95% interval", "Confidence"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`border-b border-hairline bg-gray-50/60 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted ${
                      i >= 1 && i <= 7 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={r.readable ? "" : "row-unreadable"}
                title={
                  r.readable
                    ? undefined
                    : `Under ${thresholds.directionalPurchases} purchases. The interval is wider than the gap between the kill line and the target, so this row cannot support a decision.`
                }
              >
                <td className={`border-b border-hairline px-3.5 py-2.5 text-[13px] font-medium ${r.untagged ? "italic text-content-muted" : "text-content-strong"}`}>
                  {r.label}
                </td>
                <Num>{r.ads}</Num>
                <Num>{money(r.spend, currency)}</Num>
                <td className="border-b border-hairline px-3.5 py-2.5">
                  <SpendBar
                    fraction={r.spend / maxSpend}
                    tone={
                      !r.readable
                        ? "muted"
                        : r.roas !== null && r.roas >= thresholds.targetRoas
                          ? "accent"
                          : r.roas !== null && r.roas < thresholds.killRoas
                            ? "negative"
                            : "neutral"
                    }
                  />
                  <span className="font-mono text-[11px] text-content-muted">
                    {pct(r.spendShare)}
                  </span>
                </td>
                <Num>{r.purchases}</Num>
                <Num>{money(r.cpa, currency)}</Num>
                <Num strong>{roas(r.roas)}</Num>
                {/* The raw ratio beside the shrunk one, always. Hiding it would
                    make the shrinkage feel like a correction being applied
                    behind the reader's back. */}
                <Num muted>{roas(r.roasRaw)}</Num>
                <td className="border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[12px] tabular text-content-muted">
                  {r.ciLow !== null && r.ciHigh !== null
                    ? `${roas(r.ciLow)} – ${roas(r.ciHigh)}`
                    : "—"}
                </td>
                <td className="border-b border-hairline px-3.5 py-2.5">
                  <ConfidenceChip level={r.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <SectionHead title="Share of spend over time" eyebrow="top five, monthly" />
        <div className="glass p-5">
          <ShareOverTime series={series} months={months} />
        </div>
      </section>
    </Shell>
  );
}

function Num({
  children,
  strong,
  muted,
}: {
  children: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] tabular ${
        strong ? "font-medium text-content-strong" : muted ? "text-content-muted" : "text-content-body"
      }`}
    >
      {children}
    </td>
  );
}

function Shell({
  ctx,
  dimension,
  children,
}: {
  ctx: Awaited<ReturnType<typeof loadCreativeContext>>;
  dimension: BreakdownKey;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header eyebrow={`Creative · ${ctx.client.name}`} title="Breakdown" />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CreativeBar
            unmapped={ctx.unmappedCount}
            window={ctx.window}
            through={ctx.data.through}
            currency={ctx.currency}
            href="/creative#unmapped"
          />
          <WindowToggle current={ctx.window} />
        </div>
        <DimensionPicker current={dimension} />
        {children}
      </main>
    </>
  );
}
