/**
 * Audience: where the spend goes and what it returns, by one dimension.
 *
 * Phase A offers the two dimensions the campaign names can answer, Stage and
 * Market. The four that need a breakdown ingest (Advantage+ segment, Age x
 * gender, Placement, Geo) show as disabled segments with the tooltip
 * "Not ingested"; there is no card text. The dimension is `?aud=`.
 *
 * Each row shows a dual bar (share of spend over share of purchase value), so a
 * row that earns more than it costs stands out without reading numbers. Reach
 * is never summed across rows.
 */

import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/DataTable";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { formatMoney, formatPercent, formatRatio } from "@/lib/format";
import { isLowVolume, perThousand, ratio, sumOf, unlessLowVolume } from "@/lib/paid/math";
import type { AudienceAgg, NamingDimension } from "@/components/paid/meta/aggregate";
import { Fig, LowVolumeFig } from "@/components/paid/meta/cells";

const GRID = "grid grid-cols-[1.4fr_1.6fr_0.9fr_0.7fr_0.8fr_0.7fr_0.8fr] items-center gap-2";

const NOT_INGESTED = "Not ingested";

function DualBar({ spendShare, valueShare }: { spendShare: number | null; valueShare: number | null }) {
  const w = (v: number | null) => `${Math.max(0, Math.min(1, v ?? 0)) * 100}%`;
  return (
    <span
      className="flex w-full flex-col gap-[3px]"
      title={`Spend ${formatPercent(spendShare, { decimals: 1 })}, value ${formatPercent(valueShare, { decimals: 1 })}`}
    >
      <span className="block h-[5px] rounded-full bg-gray-100">
        <span className="block h-full rounded-full bg-platform-meta" style={{ width: w(spendShare) }} />
      </span>
      <span className="block h-[5px] rounded-full bg-gray-100">
        <span className="block h-full rounded-full bg-accent" style={{ width: w(valueShare) }} />
      </span>
    </span>
  );
}

export function AudienceBreakdown({
  rows,
  dim,
  currency,
}: {
  rows: AudienceAgg[];
  dim: NamingDimension;
  /** Ad account currency. */
  currency: string;
}) {
  const totalSpend = sumOf(rows, (r) => r.sums.spend);
  const totalValue = sumOf(rows, (r) => r.sums.revenue);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  const columns: DataTableColumn[] = [
    { key: "label", label: dim === "stage" ? "Stage" : "Market" },
    {
      key: "share",
      label: "Share",
      sortable: false,
      info: "Top bar is the share of spend. Bottom bar is the share of purchase value.",
    },
    { key: "spend", label: "Spend", align: "right" },
    { key: "roas", label: "ROAS", align: "right" },
    { key: "cpa", label: "CPA", align: "right" },
    { key: "cpm", label: "CPM", align: "right" },
    { key: "ctr", label: "Link CTR", align: "right" },
  ];

  const tableRows: DataTableRow[] = rows.map((r) => {
    const s = r.sums;
    const low = isLowVolume({ spend: s.spend, purchases: s.purchases }, totalSpend);
    const roas = ratio(s.revenue, s.spend);
    const cpa = ratio(s.spend, s.purchases);
    const cpm = perThousand(s.spend, s.impressions);
    const ctr = ratio(s.linkClicks, s.impressions);
    const spendShare = ratio(s.spend, totalSpend);
    const valueShare = ratio(s.revenue, totalValue);
    return {
      key: r.key,
      sort: [r.label, null, s.spend, unlessLowVolume(roas, low), unlessLowVolume(cpa, low), cpm, ctr],
      cells: [
        <span className="block truncate text-[13px] text-content-strong">{r.label}</span>,
        <DualBar spendShare={spendShare} valueShare={valueShare} />,
        <Fig strong>{formatMoney(s.spend, currency)}</Fig>,
        <LowVolumeFig low={low}>{formatRatio(roas)}</LowVolumeFig>,
        <LowVolumeFig low={low}>{unit(cpa)}</LowVolumeFig>,
        <Fig>{unit(cpm)}</Fig>,
        <Fig>{formatPercent(ctr, { decimals: 2 })}</Fig>,
      ],
    };
  });

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <h2 className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-content-muted">
          Audience
        </h2>
        <SegmentedControl
          param="aud"
          ariaLabel="Audience dimension"
          active={dim}
          segments={[
            { value: "stage", label: "Stage" },
            { value: "market", label: "Market" },
            { value: "segment", label: "Advantage+ segment", disabled: true, disabledReason: NOT_INGESTED },
            { value: "demo", label: "Age x gender", disabled: true, disabledReason: NOT_INGESTED },
            { value: "placement", label: "Placement", disabled: true, disabledReason: NOT_INGESTED },
            { value: "geo", label: "Geo", disabled: true, disabledReason: NOT_INGESTED },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <DataTable columns={columns} rows={tableRows} gridClass={GRID} />
        </div>
      </div>
    </section>
  );
}
