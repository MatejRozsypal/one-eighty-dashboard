/**
 * Where Performance Max spends: one 100% stacked bar of spend by network per
 * campaign, with the same networks as a value share beneath. Hover a segment
 * for its spend, value and ROAS.
 *
 * The Search bucket includes Shopping placements: Google reports them together.
 */

import { formatMoney, formatPercent, formatRatio } from "@/lib/format";
import { ratio, roasOf, sumOf } from "@/lib/paid/math";
import type { GadsPmaxNetworkRow } from "@/lib/queries/paidGoogle";
import {
  NETWORK_FILL,
  NETWORK_ORDER,
  NETWORK_TEXT,
  networkLabel,
} from "./labels";
import { Section } from "./parts";

/** Segments narrower than this share keep their label out of the bar (it is in the tooltip). */
const LABEL_MIN_SHARE = 0.15;

function orderIndex(network: string): number {
  const i = (NETWORK_ORDER as readonly string[]).indexOf(network);
  return i === -1 ? NETWORK_ORDER.length : i;
}

function fillOf(network: string): string {
  return NETWORK_FILL[network] ?? NETWORK_FILL.OTHER;
}

function textOf(network: string): string {
  return NETWORK_TEXT[network] ?? NETWORK_TEXT.OTHER;
}

function Bar({
  rows,
  pick,
  total,
  currency,
  ariaLabel,
}: {
  rows: GadsPmaxNetworkRow[];
  pick: (r: GadsPmaxNetworkRow) => number | null;
  total: number;
  currency: string;
  ariaLabel: string;
}) {
  const segments = rows
    .map((r) => ({ row: r, amount: pick(r) ?? 0 }))
    .filter((s) => s.amount > 0);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="flex h-7 w-full overflow-hidden rounded-[6px] bg-gray-100"
    >
      {segments.map(({ row, amount }) => {
        const share = amount / total;
        const roas = roasOf(row.value, row.spend);
        const label = networkLabel(row.network);
        const tip = `${label}: ${formatMoney(row.spend, currency)} spend, ${formatMoney(
          row.value,
          currency
        )} value, ${formatRatio(roas)}`;
        return (
          <span
            key={row.network}
            title={tip}
            style={{ width: `${share * 100}%` }}
            className={`flex min-w-0 items-center justify-center overflow-hidden border-r border-surface-card px-1 font-mono text-[10.5px] last:border-r-0 ${fillOf(
              row.network
            )} ${textOf(row.network)}`}
          >
            {share >= LABEL_MIN_SHARE && (
              <span className="truncate">
                {label} {formatPercent(share, { decimals: 0 })}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The two bars (spend, value) for one campaign's network rows. */
export function PmaxBars({
  rows,
  currency,
}: {
  rows: GadsPmaxNetworkRow[];
  currency: string;
}) {
  const ordered = [...rows].sort((a, b) => orderIndex(a.network) - orderIndex(b.network));
  const spend = sumOf(ordered, (r) => r.spend) ?? 0;
  const value = sumOf(ordered, (r) => r.value) ?? 0;

  return (
    <div className="flex flex-col gap-2">
      {spend > 0 && (
        <div className="flex items-center gap-3">
          <span className="w-12 flex-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            Spend
          </span>
          <Bar rows={ordered} pick={(r) => r.spend} total={spend} currency={currency} ariaLabel="Spend by network" />
        </div>
      )}
      {value > 0 && (
        <div className="flex items-center gap-3">
          <span className="w-12 flex-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            Value
          </span>
          <Bar rows={ordered} pick={(r) => r.value} total={value} currency={currency} ariaLabel="Value by network" />
        </div>
      )}
    </div>
  );
}

function Legend({ networks }: { networks: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {networks.map((n) => (
        <li
          key={n}
          className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-content-muted"
        >
          <span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${fillOf(n)}`} />
          {networkLabel(n)}
        </li>
      ))}
    </ul>
  );
}

/** One block per PMax campaign with spend, biggest first. Null when no PMax spent. */
export function PmaxSplit({
  rows,
  currency,
}: {
  rows: GadsPmaxNetworkRow[];
  currency: string;
}) {
  const byCampaign = new Map<string, GadsPmaxNetworkRow[]>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaignId) ?? [];
    list.push(r);
    byCampaign.set(r.campaignId, list);
  }
  const blocks = [...byCampaign.values()]
    .map((list) => ({ list, spend: sumOf(list, (r) => r.spend) ?? 0 }))
    .filter((b) => b.spend > 0)
    .sort((a, b) => b.spend - a.spend);
  if (blocks.length === 0) return null;

  const networks = [...new Set(blocks.flatMap((b) => b.list.map((r) => r.network)))].sort(
    (a, b) => orderIndex(a) - orderIndex(b)
  );

  return (
    <Section title="PMax channels">
      <div className="flex flex-col gap-5 p-5">
        {blocks.map(({ list, spend }) => (
          <div key={list[0].campaignId} className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-content-strong" title={list[0].campaignName}>
                {list[0].campaignName}
              </span>
              <span className="flex-none font-mono text-[12px] tabular text-content-muted">
                {formatMoney(spend, currency)}
              </span>
            </div>
            <PmaxBars rows={list} currency={currency} />
          </div>
        ))}
        <Legend networks={networks} />
      </div>
    </Section>
  );
}
