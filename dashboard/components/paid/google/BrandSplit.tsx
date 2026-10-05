/**
 * Brand, Non-brand, Shopping & PMax and Other side by side.
 *
 * One column per class that delivered in the range. Each figure is rebuilt from
 * the class's summed components, so the columns add up to the totals above.
 * Search IS appears only where the class has a reported share.
 */

import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
  type DeltaInput,
  type DeltaKind,
} from "@/lib/format";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { Value } from "@/components/ui/EmptyState";
import { ratio, searchImpressionShare, sumOf } from "@/lib/paid/math";
import type { GadsCampaignAgg } from "@/lib/queries/paidGoogle";
import { classSplit, partOf, rates } from "./aggregate";
import { CLASS_LABEL } from "./labels";
import { Section } from "./parts";

interface Line {
  label: string;
  value: string;
  /** Both values and the kind (rates show points); null when comparison is off. */
  change?: DeltaInput | null;
  goodWhen?: GoodWhen;
}

export function BrandSplit({
  campaigns,
  currency,
  compare,
}: {
  campaigns: GadsCampaignAgg[];
  currency: string;
  compare: boolean;
}) {
  const split = classSplit(campaigns);
  if (split.length === 0) return null;

  const totalCur = sumOf(partOf(campaigns, "current"), (m) => m.spend);
  const totalPrev = compare ? sumOf(partOf(campaigns, "previous"), (m) => m.spend) : null;

  const chg = (
    a: number | null,
    b: number | null,
    kind: DeltaKind,
    decimals?: number
  ): DeltaInput | null =>
    compare ? { current: a, previous: b, kind, currency, ...(decimals !== undefined ? { decimals } : {}) } : null;

  return (
    <Section title="Brand split">
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(230px,1fr))]">
        {split.map(({ cls, current, previous }) => {
          const r = rates(current);
          const rp = rates(compare ? previous : null);
          const share = ratio(current?.spend ?? null, totalCur);
          const sharePrev = compare ? ratio(previous?.spend ?? null, totalPrev) : null;
          const is = current ? searchImpressionShare([current]) : null;
          const isPrev = compare && previous ? searchImpressionShare([previous]) : null;

          const lines: Line[] = [
            {
              label: "Spend",
              value: formatMoney(current?.spend ?? null, currency),
              change: chg(current?.spend ?? null, previous?.spend ?? null, "money"),
              goodWhen: "neutral",
            },
            {
              label: "Share",
              value: formatPercent(share),
              change: chg(share, sharePrev, "rate"),
              goodWhen: "neutral",
            },
            {
              label: "Value",
              value: formatMoney(current?.value ?? null, currency),
              change: chg(current?.value ?? null, previous?.value ?? null, "money"),
            },
            { label: "ROAS", value: formatRatio(r.roas), change: chg(r.roas, rp.roas, "ratio") },
            {
              label: "Conversions",
              value: formatNumber(current?.conversions ?? null, { decimals: 1 }),
              change: chg(current?.conversions ?? null, previous?.conversions ?? null, "count", 1),
            },
            {
              label: "CPA",
              value: formatMoney(r.cpa, currency, { unit: true }),
              change: chg(r.cpa, rp.cpa, "money"),
              goodWhen: "down",
            },
            {
              label: "CPC",
              value: formatMoney(r.cpc, currency, { unit: true }),
              change: chg(r.cpc, rp.cpc, "money"),
              goodWhen: "down",
            },
          ];
          if (is !== null) {
            lines.push({
              label: "Search IS",
              value: formatPercent(is),
              change: chg(is, isPrev, "rate"),
            });
          }

          return (
            <div
              key={cls}
              className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline p-[16px_18px]"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-strong">
                {CLASS_LABEL[cls]}
              </span>
              <dl className="flex flex-col gap-2">
                {lines.map((l) => (
                  <div key={l.label} className="flex items-baseline justify-between gap-3">
                    <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      {l.label}
                    </dt>
                    <dd className="flex items-baseline gap-2.5">
                      <DeltaChip change={l.change} goodWhen={l.goodWhen ?? "up"} />
                      <span className="font-mono text-[13px] font-semibold tabular text-content-strong">
                        <Value>{l.value}</Value>
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
