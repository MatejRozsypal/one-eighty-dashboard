/**
 * Products that Shopping, PMax and Demand Gen spent on, top 200 by spend.
 *
 * Without a Merchant Center link an item is its id plus product type level 1,
 * so the group-by control also offers product type, brand and custom label 0.
 * Rows are split by campaign type. The header says how much of Shopping and
 * PMax spend the rows account for: low for a PMax-heavy account, and true.
 */

import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { SegmentedControl, type Segment } from "@/components/controls/SegmentedControl";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { isLowVolume, ratio, sumOf, unlessLowVolume } from "@/lib/paid/math";
import type { GadsProductGroup, GadsProductRow } from "@/lib/queries/paidGoogle";
import { channelLabel } from "./labels";
import { CoverageChip, NumCell, RatioCell, Section, SpendCell, TextCell } from "./parts";

const GRID =
  "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_repeat(7,minmax(0,0.9fr))] items-center gap-2";

const GROUP_HEAD: Record<GadsProductGroup, string> = {
  item: "Item",
  type: "Product type",
  brand: "Brand",
  label0: "Label 0",
};

export function Products({
  rows,
  group,
  zeroOnly,
  coverage,
  currency,
}: {
  rows: GadsProductRow[];
  group: GadsProductGroup;
  zeroOnly: boolean;
  /** Product spend over Shopping and PMax spend. Null when those campaigns did not spend. */
  coverage: number | null;
  currency: string;
}) {
  const groupSegments: Segment[] = [
    { value: "item", label: "Product" },
    { value: "type", label: "Type" },
    { value: "brand", label: "Brand" },
    { value: "label0", label: "Label 0" },
  ];
  const zeroSegments: Segment[] = [
    { value: "all", label: "All" },
    { value: "zero", label: "Zero conversions" },
  ];

  const total = sumOf(rows, (r) => r.spend);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  const tableRows: DataTableRow[] = rows.map((r, i) => {
    const roas = ratio(r.value, r.spend);
    const cpa = ratio(r.spend, r.conversions);
    const ctr = ratio(r.clicks, r.impressions);
    const low = isLowVolume({ spend: r.spend, purchases: r.conversions }, total);
    const label = r.key ?? "Not set";
    return {
      key: `${r.key}|${r.channelType}|${i}`,
      sort: [
        label,
        channelLabel(r.channelType),
        r.spend,
        r.clicks,
        r.conversions,
        r.value,
        unlessLowVolume(roas, low),
        unlessLowVolume(cpa, low),
        ctr,
      ],
      cells: [
        <span key="i" className="flex min-w-0 items-baseline gap-2">
          <TextCell text={label} muted={r.key === null} />
          {r.productType && (
            <span className="flex-none truncate font-mono text-[10.5px] text-content-muted">
              {r.productType}
            </span>
          )}
        </span>,
        <span key="t" className="block truncate text-[12.5px] text-content-body">
          {channelLabel(r.channelType)}
        </span>,
        <SpendCell key="s" text={formatMoney(r.spend, currency)} />,
        <NumCell key="k" text={formatNumber(r.clicks)} />,
        <NumCell key="c" text={formatNumber(r.conversions, { decimals: 1 })} />,
        <NumCell key="v" text={formatMoney(r.value, currency)} />,
        <RatioCell key="r" text={formatRatio(roas)} low={low} />,
        <RatioCell key="a" text={unit(cpa)} low={low} />,
        <NumCell key="ct" text={formatPercent(ctr, { decimals: 2 })} />,
      ],
    };
  });

  return (
    <Section
      title="Products"
      controls={
        <>
          <CoverageChip share={coverage} />
          <SegmentedControl param="pg" segments={groupSegments} active={group} ariaLabel="Group by" />
          <SegmentedControl
            param="zero"
            segments={zeroSegments}
            active={zeroOnly ? "zero" : "all"}
            ariaLabel="Conversions"
          />
        </>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <DataTable
            gridClass={GRID}
            columns={[
              { key: "i", label: GROUP_HEAD[group] },
              { key: "t", label: "Campaign type" },
              { key: "s", label: "Spend", align: "right" },
              { key: "k", label: "Clicks", align: "right" },
              { key: "c", label: "Conv.", align: "right" },
              { key: "v", label: "Value", align: "right" },
              { key: "r", label: "ROAS", align: "right" },
              { key: "a", label: "CPA", align: "right" },
              { key: "ct", label: "CTR", align: "right" },
            ]}
            rows={tableRows}
          />
        </div>
      </div>
    </Section>
  );
}
