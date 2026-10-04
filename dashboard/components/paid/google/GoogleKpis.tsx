/**
 * The two KPI rows on the Google tab.
 *
 * Row 1: Spend, Conv. value, ROAS, Conversions, CPA. Row 2: eight compact
 * tiles for brand mix and auction health. Conversions are the purchase
 * category. Every tile carries its change against the comparison period: rates
 * in percentage points, money, counts and ratios in percent.
 *
 * The tile is local, not `KpiTile`: these tiles need a free-text tooltip and a
 * point-change chip, and the lost impression share tooltips must say the figure
 * is an upper bound.
 */

import { formatMoney, formatNumber, formatPercent, formatRatio, isNoValue, NO_VALUE } from "@/lib/format";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS, type MetricDefinition } from "@/lib/metrics";
import {
  brandShare,
  lostBudgetShare,
  lostRankShare,
  nonBrandRoas,
  pointChange,
  ratio,
  relativeChange,
  searchImpressionShare,
} from "@/lib/paid/math";
import type { GadsCampaignAgg, GadsLeakage } from "@/lib/queries/paidGoogle";
import { classedRows, partOf, rates, rollUp } from "./aggregate";
import { PpChip } from "./parts";

/** Google reports a share under 10% as a floor value, so lost share is an upper bound. */
const FLOOR_NOTE =
  "Search network only. Upper bound, because Google reports shares under 10% as a floor value.";

function withNote(key: string, note: string): MetricDefinition {
  return { ...METRIC_DEFINITIONS[key], note };
}

interface Tile {
  label: string;
  value: string;
  /** Relative change, a fraction. */
  delta?: number | null;
  /** Change in a rate, in fraction points. */
  pointDelta?: number | null;
  goodWhen?: GoodWhen;
  /** Definition from the metrics list, possibly with a local note. */
  definition?: MetricDefinition;
  /** Plain tooltip text when no definition fits. */
  info?: string;
}

function GadsTile({ tile, large }: { tile: Tile; large: boolean }) {
  const missing = isNoValue(tile.value);
  return (
    <div className="flex min-w-0 flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
      <span className="relative inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        {tile.label}
        {tile.definition && <MetricTooltip definition={tile.definition} />}
        {!tile.definition && tile.info && <InfoTip text={tile.info} label={`About ${tile.label}`} />}
      </span>
      <span
        className={`font-mono font-semibold leading-none tracking-heading tabular ${
          large ? "text-[22px]" : "text-[19px]"
        } ${missing ? "text-content-muted" : "text-content-strong"}`}
      >
        {missing ? NO_VALUE : tile.value}
      </span>
      {tile.pointDelta !== undefined && tile.pointDelta !== null ? (
        <PpChip delta={tile.pointDelta} goodWhen={tile.goodWhen ?? "up"} />
      ) : tile.delta !== undefined && tile.delta !== null ? (
        <DeltaChip delta={tile.delta} goodWhen={tile.goodWhen ?? "up"} />
      ) : null}
    </div>
  );
}

export function GoogleKpis({
  campaigns,
  leakage,
  currency,
  compare,
}: {
  campaigns: GadsCampaignAgg[];
  leakage: GadsLeakage;
  currency: string;
  /** False when the comparison is off: no deltas at all. */
  compare: boolean;
}) {
  const cur = rollUp(partOf(campaigns, "current"));
  const prev = compare ? rollUp(partOf(campaigns, "previous")) : null;
  const r = rates(cur);
  const p = rates(prev);

  const cmp = (a: number | null, b: number | null) => (compare ? relativeChange(a, b) : null);
  const pts = (a: number | null, b: number | null) => (compare ? pointChange(a, b) : null);

  const curClassed = classedRows(campaigns, "current");
  const prevClassed = classedRows(campaigns, "previous");

  const searchIs = cur ? searchImpressionShare([cur]) : null;
  const searchIsPrev = prev ? searchImpressionShare([prev]) : null;
  const lostB = cur ? lostBudgetShare([cur]) : null;
  const lostBPrev = prev ? lostBudgetShare([prev]) : null;
  const lostR = cur ? lostRankShare([cur]) : null;
  const lostRPrev = prev ? lostRankShare([prev]) : null;

  const leak = leakageShare(leakage.current);
  const leakPrev = leakage.previous ? leakageShare(leakage.previous) : null;

  const brand = brandShare(curClassed);
  const brandPrev = compare ? brandShare(prevClassed) : null;
  const nbRoas = nonBrandRoas(curClassed);
  const nbRoasPrev = compare ? nonBrandRoas(prevClassed) : null;

  const money = (v: number | null) => formatMoney(v, currency);
  const unitMoney = (v: number | null) => formatMoney(v, currency, { unit: true });

  const row1: Tile[] = [
    {
      label: "Spend",
      value: money(cur?.spend ?? null),
      delta: cmp(cur?.spend ?? null, prev?.spend ?? null),
      goodWhen: "neutral",
    },
    {
      label: "Conv. value",
      value: money(cur?.value ?? null),
      delta: cmp(cur?.value ?? null, prev?.value ?? null),
      info: "Purchase conversions only.",
    },
    {
      label: "ROAS",
      value: formatRatio(r.roas),
      delta: cmp(r.roas, p.roas),
      info: "Purchase conversion value divided by spend.",
    },
    {
      label: "Conversions",
      value: formatNumber(cur?.conversions ?? null, { decimals: 1 }),
      delta: cmp(cur?.conversions ?? null, prev?.conversions ?? null),
      info: "Purchase conversions only. Google counts fractions under data-driven attribution.",
    },
    {
      label: "CPA",
      value: unitMoney(r.cpa),
      delta: cmp(r.cpa, p.cpa),
      goodWhen: "down",
    },
  ];

  const row2: Tile[] = [
    {
      label: "Brand share",
      value: formatPercent(brand),
      pointDelta: pts(brand, brandPrev),
      goodWhen: "neutral",
      definition: METRIC_DEFINITIONS["Brand share"],
    },
    {
      label: "Non-brand ROAS",
      value: formatRatio(nbRoas),
      delta: cmp(nbRoas, nbRoasPrev),
      definition: METRIC_DEFINITIONS["Non-brand ROAS"],
    },
    {
      label: "Search IS",
      value: formatPercent(searchIs),
      pointDelta: pts(searchIs, searchIsPrev),
      definition: withNote(
        "Search IS",
        "Search network only. Google reports shares under 10% as a floor value, so small shares read high."
      ),
    },
    {
      label: "Lost IS (budget)",
      value: formatPercent(lostB),
      pointDelta: pts(lostB, lostBPrev),
      goodWhen: "down",
      definition: withNote("Lost IS (budget)", FLOOR_NOTE),
    },
    {
      label: "Lost IS (rank)",
      value: formatPercent(lostR),
      pointDelta: pts(lostR, lostRPrev),
      goodWhen: "down",
      definition: withNote("Lost IS (rank)", FLOOR_NOTE),
    },
    {
      label: "CTR",
      value: formatPercent(r.ctr, { decimals: 2 }),
      pointDelta: pts(r.ctr, p.ctr),
      info: "Clicks divided by impressions, all networks.",
    },
    {
      label: "CPC",
      value: unitMoney(r.cpc),
      delta: cmp(r.cpc, p.cpc),
      goodWhen: "down",
      info: "Spend divided by clicks, all networks.",
    },
    {
      label: "Brand leakage",
      value: formatPercent(leak),
      pointDelta: pts(leak, leakPrev),
      goodWhen: "down",
      definition: METRIC_DEFINITIONS["Brand leakage"],
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {row1.map((t) => (
          <GadsTile key={t.label} tile={t} large />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {row2.map((t) => (
          <GadsTile key={t.label} tile={t} large={false} />
        ))}
      </div>
    </section>
  );
}

/** Brand search-term spend over all search-term spend, both in non-brand campaigns. */
function leakageShare(parts: { brandSpend: number | null; totalSpend: number | null }): number | null {
  if (parts.totalSpend === null) return null;
  return ratio(parts.brandSpend ?? 0, parts.totalSpend);
}
