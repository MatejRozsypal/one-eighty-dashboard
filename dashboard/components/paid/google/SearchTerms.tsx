/**
 * Search terms and keywords, top 200 by spend.
 *
 * Terms cover only part of Search spend (Google hides low-volume queries), so
 * the header says how much. PMax terms are not offered until that data is
 * ingested (a locked option with no way to unlock it only raises questions).
 * Brand is a dot on the term, from the client's brand terms.
 */

import type { ReactNode } from "react";
import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { SegmentedControl, type Segment } from "@/components/controls/SegmentedControl";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { isLowVolume, ratio, sumOf, unlessLowVolume } from "@/lib/paid/math";
import type { GadsKeywordRow, GadsTermMode, GadsTermRow } from "@/lib/queries/paidGoogle";
import { matchLabel, statusLabel } from "./labels";
import { CoverageChip, NumCell, RatioCell, Section, SpendCell, TextCell } from "./parts";

export type SearchSource = "terms" | "keywords";

const TERM_GRID =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,0.8fr)_repeat(7,minmax(0,0.9fr))] items-center gap-2";
const KEYWORD_GRID =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_repeat(7,minmax(0,0.9fr))] items-center gap-2";

export function SearchTerms({
  source,
  mode,
  terms,
  keywords,
  coverage,
  currency,
}: {
  source: SearchSource;
  mode: GadsTermMode;
  terms: GadsTermRow[];
  keywords: GadsKeywordRow[];
  /** Search-term spend over Search campaign spend. Null when there is no Search spend. */
  coverage: number | null;
  currency: string;
}) {
  const sourceSegments: Segment[] = [
    { value: "terms", label: "Search terms" },
    { value: "keywords", label: "Keywords" },
  ];
  const modeSegments: Segment[] = [
    { value: "all", label: "All" },
    { value: "brand", label: "Brand" },
    { value: "nonbrand", label: "Non-brand" },
    { value: "waste", label: "Waste" },
  ];

  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  let table: ReactNode;
  if (source === "terms") {
    const total = sumOf(terms, (t) => t.spend);
    const rows: DataTableRow[] = terms.map((t, i) => {
      const roas = ratio(t.value, t.spend);
      const cpa = ratio(t.spend, t.conversions);
      const cpc = ratio(t.spend, t.clicks);
      const low = isLowVolume({ spend: t.spend, purchases: t.conversions }, total);
      return {
        key: `${t.campaignId}|${t.matchType}|${t.searchTerm}|${i}`,
        sort: [
          t.searchTerm,
          t.campaignName,
          t.matchType,
          t.isBrand ? 1 : 0,
          statusLabel(t.status),
          t.spend,
          t.clicks,
          t.conversions,
          t.value,
          unlessLowVolume(roas, low),
          unlessLowVolume(cpa, low),
          cpc,
        ],
        cells: [
          <TextCell key="t" text={t.searchTerm} />,
          <TextCell key="c" text={t.campaignName} muted mono />,
          <span key="m" className="text-[12.5px] text-content-body">
            {matchLabel(t.matchType) ?? "n/a"}
          </span>,
          t.isBrand ? (
            <span
              key="b"
              role="img"
              aria-label="Brand term"
              title="Brand term"
              className="inline-block h-2 w-2 rounded-full bg-growth-600"
            />
          ) : (
            <span key="b" className="text-content-muted">
              &nbsp;
            </span>
          ),
          <span key="st" className="text-[12.5px] text-content-body">
            {statusLabel(t.status)}
          </span>,
          <SpendCell key="s" text={formatMoney(t.spend, currency)} />,
          <NumCell key="k" text={formatNumber(t.clicks)} />,
          <NumCell key="cv" text={formatNumber(t.conversions, { decimals: 1 })} />,
          <NumCell key="v" text={formatMoney(t.value, currency)} />,
          <RatioCell key="r" text={formatRatio(roas)} low={low} />,
          <RatioCell key="a" text={unit(cpa)} low={low} />,
          <NumCell key="p" text={unit(cpc)} />,
        ],
      };
    });
    table = (
      <div className="overflow-x-auto">
        <div className="min-w-[1180px]">
          <DataTable
            gridClass={TERM_GRID}
            columns={[
              { key: "t", label: "Search term" },
              { key: "c", label: "Campaign" },
              { key: "m", label: "Match" },
              { key: "b", label: "Brand" },
              { key: "st", label: "Status" },
              { key: "s", label: "Spend", align: "right" },
              { key: "k", label: "Clicks", align: "right" },
              { key: "cv", label: "Conv.", align: "right" },
              { key: "v", label: "Value", align: "right" },
              { key: "r", label: "ROAS", align: "right" },
              { key: "a", label: "CPA", align: "right" },
              { key: "p", label: "CPC", align: "right" },
            ]}
            rows={rows}
          />
        </div>
      </div>
    );
  } else {
    const total = sumOf(keywords, (k) => k.spend);
    const rows: DataTableRow[] = keywords.map((k, i) => {
      const roas = ratio(k.value, k.spend);
      const cpa = ratio(k.spend, k.conversions);
      const ctr = ratio(k.clicks, k.impressions);
      const cpc = ratio(k.spend, k.clicks);
      const low = isLowVolume({ spend: k.spend, purchases: k.conversions }, total);
      return {
        key: `${k.campaignId}|${k.matchType}|${k.keyword}|${i}`,
        sort: [
          k.keyword,
          k.campaignName,
          k.matchType,
          k.qualityScore,
          k.spend,
          k.conversions,
          k.value,
          unlessLowVolume(roas, low),
          unlessLowVolume(cpa, low),
          ctr,
          cpc,
        ],
        cells: [
          <TextCell key="k" text={k.keyword} />,
          <TextCell key="c" text={k.campaignName} muted mono />,
          <span key="m" className="text-[12.5px] text-content-body">
            {matchLabel(k.matchType) ?? "n/a"}
          </span>,
          <NumCell key="q" text={formatNumber(k.qualityScore)} />,
          <SpendCell key="s" text={formatMoney(k.spend, currency)} />,
          <NumCell key="cv" text={formatNumber(k.conversions, { decimals: 1 })} />,
          <NumCell key="v" text={formatMoney(k.value, currency)} />,
          <RatioCell key="r" text={formatRatio(roas)} low={low} />,
          <RatioCell key="a" text={unit(cpa)} low={low} />,
          <NumCell key="t" text={formatPercent(ctr, { decimals: 2 })} />,
          <NumCell key="p" text={unit(cpc)} />,
        ],
      };
    });
    table = (
      <div className="overflow-x-auto">
        <div className="min-w-[1100px]">
          <DataTable
            gridClass={KEYWORD_GRID}
            columns={[
              { key: "k", label: "Keyword" },
              { key: "c", label: "Campaign" },
              { key: "m", label: "Match" },
              {
                key: "q",
                label: "QS",
                align: "right",
                info: "Latest quality score in the range. Google reports it for keywords with enough searches.",
              },
              { key: "s", label: "Spend", align: "right" },
              { key: "cv", label: "Conv.", align: "right" },
              { key: "v", label: "Value", align: "right" },
              { key: "r", label: "ROAS", align: "right" },
              { key: "a", label: "CPA", align: "right" },
              { key: "t", label: "CTR", align: "right" },
              { key: "p", label: "CPC", align: "right" },
            ]}
            rows={rows}
          />
        </div>
      </div>
    );
  }

  return (
    <Section
      title={source === "terms" ? "Search terms" : "Keywords"}
      controls={
        <>
          {source === "terms" && <CoverageChip share={coverage} />}
          <SegmentedControl param="src" segments={sourceSegments} active={source} ariaLabel="Source" />
          {source === "terms" && (
            <SegmentedControl param="st" segments={modeSegments} active={mode} ariaLabel="Filter" />
          )}
        </>
      }
    >
      {table}
    </Section>
  );
}
