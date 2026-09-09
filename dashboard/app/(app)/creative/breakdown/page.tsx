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
import { CreativeTabs } from "@/components/creative/CreativeTabs";
import { PageControls } from "@/components/controls/PageControls";
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
import { BREAKDOWN_DIMENSIONS, FOCUS_FIELD, FORMAT_LABELS, isBreakdownKey, type BreakdownKey, type Format } from "@/lib/creative/vocabulary";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { viewQuery } from "@/lib/params";
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
  const { client, currency, data, thresholds, display, account } = ctx;
  // A breakdown is arithmetic on delivery: which angle took the spend, what it
  // returned, how wide the interval is. None of that needs a kill line. Only
  // the colour coding and the three zones on the interval chart do, and those
  // come off rather than the whole screen.
  const judged = thresholds !== null;

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
  const coverage = await getTagCoverage(client.clientId);
  const groups = groupBy(data.ads, KEY_OF[dimension]);

  const rows: BreakdownRow[] = groups.map((g) => {
    const c = sum(g.ads);
    // The value the Creatives grid matches on, taken off a member of the group
    // rather than parsed back out of the label — the label for a concept is
    // "id name" and for a format is "Video", and neither is what filters.
    const first = g.ads[0];
    const focusValue = g.untagged
      ? null
      : ((first as unknown as Record<string, unknown>)[FOCUS_FIELD[dimension]] as
          | string
          | null
          | undefined) ?? null;
    const r = read(c, account.meanRoas, account.spend, display);
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
      readable: c.purchases >= display.directionalPurchases,
      focusValue,
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

  // Carries the client and the window across, so following a row does not
  // silently reset the reader to another client's lifetime figures.
  const linkTo = (value: string) => {
    const q = new URLSearchParams(viewQuery(ctx.params));
    q.set("focus", FOCUS_FIELD[dimension]);
    q.set("is", value);
    return `/creative?${q.toString()}`;
  };

  return (
    <Shell ctx={ctx} dimension={dimension}>
      {!judged && <ThresholdsMissing clientName={client.name} />}

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
          killRoas={judged ? thresholds.killRoas : null}
          targetRoas={judged ? thresholds.targetRoas : null}
        />
        <div className="mt-2.5 flex flex-wrap gap-4 text-[12px] text-content-muted">
          {(judged
            ? [
                ["var(--text-muted)", "Spend"],
                ["var(--accent)", "Revenue, at or above target"],
                ["var(--info)", "Revenue, profitable under target"],
                ["var(--negative)", "Revenue, below the kill line"],
              ]
            : [
                ["var(--text-muted)", "Spend"],
                ["var(--info)", "Revenue"],
              ]
          ).map(([c, l]) => (
            <span key={l}>
              <i aria-hidden="true" className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px]"
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
          killRoas={judged ? thresholds.killRoas : null}
          targetRoas={judged ? thresholds.targetRoas : null}
        />
        {/*
          The bar is the payload of this chart and nothing on it says so.
          Without this line a reader takes the bar for a magnitude — a longer
          bar reading as a better row — when it means the opposite: a wide bar
          is a row we know less about.

          The swatches are the zones as the chart actually paints them: the
          same colour at the same low alpha, with a solid hairline of the full
          colour so a 6% fill is still visible at 9 pixels.
        */}
        <div className="mt-2.5 flex flex-wrap gap-4 text-[12px] text-content-muted">
          {(judged
            ? [
                [`Losing money, under ${thresholds.killRoas.toFixed(2)}`, "var(--negative)", 0.06],
                ["Profitable, under target", "var(--text-muted)", 0.05],
                [`At or above target ${thresholds.targetRoas.toFixed(2)}`, "var(--accent)", 0.07],
              ]
            : []
          ).map(([label, colour, alpha]) => (
            <span key={label as string}>
              <i
                aria-hidden="true"
                className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px]"
                style={{
                  background: `color-mix(in srgb, ${colour} ${(alpha as number) * 100}%, transparent)`,
                  border: `1px solid ${colour}`,
                }}
              />
              {label}
            </span>
          ))}
          <span>
            <i
              aria-hidden="true"
              className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px]"
              style={{ background: "var(--border-strong)" }}
            />
            Bar = the range the true value could be in
          </span>
        </div>
      </div>

      {/*
        The same sortable, resizable table every other screen in the app uses.
        A breakdown is read by ordering it — by spend to see where the money
        went, by ROAS to see what came back, by purchases to see what is even
        readable — and a fixed sort by spend answers only the first of those.

        The dimension cell is a link into the Creatives grid, filtered to this
        row. "Curiosity gap returns 1.25" is not a finding until you have seen
        the eleven ads that make it up, and this is the only path from one to
        the other that does not involve retyping a filter.
      */}
      <DataTable
        gridClass="grid grid-cols-[2.4fr_0.5fr_0.9fr_1fr_0.6fr_0.8fr_0.7fr_0.6fr_1.2fr_1fr] items-center gap-2"
        emptyMessage="No delivery to break down in this window."
        columns={[
          { key: "dim", label },
          { key: "ads", label: "Ads", align: "right" },
          { key: "spend", label: "Spend", align: "right" },
          { key: "share", label: "Share" },
          { key: "purch", label: "Purch.", align: "right" },
          { key: "cpa", label: "CPA", align: "right" },
          { key: "roas", label: "ROAS", align: "right" },
          { key: "raw", label: "Raw", align: "right" },
          { key: "ci", label: "95% interval" },
          { key: "conf", label: "Confidence", sortable: false },
        ]}
        rows={rows.map((r) => ({
          key: r.key,
          sort: [
            r.label,
            r.ads,
            r.spend,
            r.spendShare,
            r.purchases,
            r.cpa,
            r.roas,
            r.roasRaw,
            r.ciHigh !== null && r.ciLow !== null ? r.ciHigh - r.ciLow : null,
            null,
          ],
          cells: [
            <span
              key="d"
              className={r.readable ? "" : "opacity-60"}
              title={
                r.readable
                  ? undefined
                  : `Under ${display.directionalPurchases} purchases. The interval is wider than the gap between the kill line and the target, so this row cannot support a decision.`
              }
            >
              {r.focusValue ? (
                <Link
                  href={linkTo(r.focusValue)}
                  className="text-[13px] font-medium text-content-strong underline decoration-hairline-strong underline-offset-2 transition-colors duration-fast hover:decoration-accent"
                >
                  {r.label}
                </Link>
              ) : (
                <span
                  className={`text-[13px] font-medium ${
                    r.untagged ? "italic text-content-muted" : "text-content-strong"
                  }`}
                >
                  {r.label}
                </span>
              )}
            </span>,
            <span key="a" className="font-mono text-[13px] tabular text-content-body">{r.ads}</span>,
            <span key="s" className="font-mono text-[13px] tabular text-content-body">{money(r.spend, currency)}</span>,
            <span key="sh" className="block">
              <SpendBar
                fraction={r.spend / maxSpend}
                tone={
                  !r.readable
                    ? "muted"
                    : !judged
                      ? "neutral"
                      : r.roas !== null && r.roas >= thresholds.targetRoas
                        ? "accent"
                        : r.roas !== null && r.roas < thresholds.killRoas
                          ? "negative"
                          : "neutral"
                }
              />
              <span className="font-mono text-[11px] text-content-muted">{pct(r.spendShare)}</span>
            </span>,
            <span key="p" className="font-mono text-[13px] tabular text-content-body">{r.purchases}</span>,
            <span key="c" className="font-mono text-[13px] tabular text-content-body">{money(r.cpa, currency)}</span>,
            <span key="r" className="font-mono text-[13px] font-medium tabular text-content-strong">{roas(r.roas)}</span>,
            /* The raw ratio beside the shrunk one, always. Hiding it would make
               the shrinkage feel like a correction applied behind the reader's
               back. */
            <span key="rw" className="font-mono text-[13px] tabular text-content-muted">{roas(r.roasRaw)}</span>,
            <span key="ci" className="font-mono text-[12px] tabular text-content-muted">
              {r.ciLow !== null && r.ciHigh !== null ? `${roas(r.ciLow)} – ${roas(r.ciHigh)}` : "—"}
            </span>,
            <ConfidenceChip key="cf" level={r.confidence} />,
          ],
        }))}
      />

      <section>
        <SectionHead title="Share of spend over time" eyebrow="top five, monthly" />
        <div className="glass p-5">
          <ShareOverTime series={series} months={months} />
        </div>
      </section>
    </Shell>
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
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-0 lg:px-8">
        <CreativeTabs unmapped={ctx.unmappedCount} href="/creative#unmapped" />
        <CreativeBar
          unmapped={0}
          through={ctx.data.through}
          currency={ctx.currency}
          href="/creative#unmapped"
        />
        <DimensionPicker current={dimension} />
        {children}
      </main>
    </>
  );
}
