/**
 * Attribution cross-check: what each ad platform says it earned against what
 * GA4 credits it, with the shop's own revenue underneath.
 *
 * Rows are fixed (Meta, Google, other paid, Paid, No channel), so no column sorts.
 * "Paid" is the sum of the platform rows plus other paid. "No channel" holds
 * purchases GA4 recorded without a session: they count in all-channel revenue and
 * tracking coverage, never in Paid.
 */

import type { ReactNode } from "react";
import { formatMoney, formatPercent, formatRatio, isNoValue } from "@/lib/format";
import { DataTable, type DataTableRow } from "@/components/ui/DataTable";
import { InfoTip } from "@/components/ui/InfoTip";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { NoValue } from "@/components/ui/EmptyState";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { overClaim, ratio, sumOf, trackingCoverage } from "@/lib/paid/math";
import type { Ga4CrossCheck } from "@/lib/queries/paidGa4";

const COLUMNS = [
  { key: "platform", label: "Platform", sortable: false },
  { key: "spend", label: "Spend", align: "right" as const, sortable: false },
  { key: "value", label: "Platform value", align: "right" as const, sortable: false },
  { key: "ga4", label: "GA4 revenue", align: "right" as const, sortable: false },
  { key: "proas", label: "Platform ROAS", align: "right" as const, sortable: false },
  { key: "groas", label: "GA4 ROAS", align: "right" as const, sortable: false },
  {
    key: "over",
    label: "Over-claim",
    align: "right" as const,
    sortable: false,
    info: "Platform value divided by GA4 revenue. Above 1.00x the platform claims more than GA4 sees. Attribution rules differ, so some gap is normal.",
  },
];

const NO_CHANNEL_TIP =
  "Purchases GA4 recorded without a session, usually when visitors decline cookies. Counted in all-channel revenue and tracking coverage, never in paid.";
const SHOP_TIP =
  "Shopify shops use revenue including tax and shipping, other shops use revenue as reported. GA4 purchase value can still differ in tax treatment.";

const mono = "font-mono text-[12.5px] tabular text-content-strong";

export function CrossCheck({
  data,
  currency,
  hasMeta,
  hasGoogle,
}: {
  data: Ga4CrossCheck;
  currency: string;
  hasMeta: boolean;
  hasGoogle: boolean;
}) {
  const money = (v: number | null) => formatMoney(v, currency);
  const cell = (text: string, className = mono) =>
    isNoValue(text) ? <NoValue /> : <span className={className}>{text}</span>;

  function row(
    key: string,
    label: ReactNode,
    spend: number | null,
    value: number | null,
    ga4: number | null,
    bold = false
  ): DataTableRow {
    const cls = bold ? `${mono} font-semibold` : mono;
    return {
      key,
      sort: [null, null, null, null, null, null, null],
      cells: [
        label,
        cell(money(spend), cls),
        cell(money(value), cls),
        cell(money(ga4), cls),
        cell(formatRatio(ratio(value, spend)), cls),
        cell(formatRatio(ratio(ga4, spend)), cls),
        cell(formatRatio(overClaim(value, ga4)), cls),
      ],
    };
  }

  const named = (tone: string, name: string) => (
    <span className="inline-flex items-center gap-2 text-[13px] text-content-strong">
      <span aria-hidden="true" className={`h-[9px] w-[9px] rounded-[3px] ${tone}`} />
      {name}
    </span>
  );

  const ga4Paid = sumOf(["meta", "google", "other_paid"] as const, (p) => data.ga4[p].revenue);
  const ga4All = sumOf(
    ["meta", "google", "other_paid", "non_paid", "unattributed"] as const,
    (p) => data.ga4[p].revenue
  );
  const platformValue = sumOf(
    [hasMeta ? data.platformValue.meta : null, hasGoogle ? data.platformValue.google : null],
    (v) => v
  );

  const rows: DataTableRow[] = [];
  if (hasMeta) {
    rows.push(row("meta", named("bg-platform-meta", "Meta"), data.spend.meta, data.platformValue.meta, data.ga4.meta.revenue));
  }
  if (hasGoogle) {
    rows.push(row("google", named("bg-platform-google", "Google"), data.spend.google, data.platformValue.google, data.ga4.google.revenue));
  }
  if ((data.ga4.other_paid.sessions ?? 0) > 0 || (data.ga4.other_paid.revenue ?? 0) > 0) {
    rows.push(row("other", <span className="text-[13px] text-content-strong">Other paid</span>, null, null, data.ga4.other_paid.revenue));
  }
  rows.push(row("paid", <span className="text-[13px] font-semibold text-content-strong">Paid</span>, data.spend.paid, platformValue, ga4Paid, true));
  if ((data.ga4.unattributed.revenue ?? 0) > 0) {
    rows.push(
      row(
        "nochannel",
        <span className="inline-flex items-center gap-1.5 text-[13px] text-content-strong">
          No channel
          <InfoTip text={NO_CHANNEL_TIP} label="About No channel" />
        </span>,
        null,
        null,
        data.ga4.unattributed.revenue
      )
    );
  }

  const coverage = trackingCoverage(ga4All, data.shopRevenue);

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <DataTable
            gridClass="grid grid-cols-[1.3fr_1fr_1fr_1fr_0.9fr_0.9fr_0.9fr] items-center gap-2"
            columns={COLUMNS}
            rows={rows}
          />
        </div>
      </div>

      <dl className="m-0 grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            Shop revenue
            <InfoTip text={SHOP_TIP} label="About Shop revenue" />
          </dt>
          <dd className="m-0 font-mono text-[16px] font-semibold tabular text-content-strong">
            {cell(money(data.shopRevenue), "")}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            GA4 revenue, all channels
          </dt>
          <dd className="m-0 font-mono text-[16px] font-semibold tabular text-content-strong">
            {cell(money(ga4All), "")}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            Tracking coverage
            <MetricTooltip definition={METRIC_DEFINITIONS["Tracking coverage"]} />
          </dt>
          <dd className="m-0 font-mono text-[16px] font-semibold tabular text-content-strong">
            {cell(formatPercent(coverage), "")}
          </dd>
        </div>
      </dl>
    </div>
  );
}
