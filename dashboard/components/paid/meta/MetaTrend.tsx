/**
 * Five small multiples: ROAS, CPA, CPM, Link CTR, Cost / ATC.
 *
 * The point is diagnosis without text: is CPM moving, or is conversion? Each
 * card draws the period as a line and the comparison period as a pale ghost
 * line on the same scale, so a drift reads against where it started.
 *
 * Daily up to 45 days, weekly up to 180, monthly beyond. Every point is a ratio
 * of that bucket's own sums (never an average of daily ratios). The comparison
 * line is aligned by bucket position, not by calendar date.
 *
 * Server component, hand-rolled SVG (no chart library, no client JS).
 */

import { formatMoney, formatPercent, formatRatio } from "@/lib/format";
import { bucketGrain, pointChange, relativeChange } from "@/lib/paid/math";
import type { DateRange } from "@/lib/period";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import {
  inPeriod,
  ratesOf,
  series,
  sumRows,
  type MetaRates,
  type MetaRow,
  type MetaSums,
} from "@/components/paid/meta/aggregate";
import { PpChip } from "@/components/paid/meta/cells";

const W = 240;
const H = 56;
const PAD = 3;

interface Metric {
  key: string;
  label: string;
  pick: (r: MetaRates) => number | null;
  format: (v: number | null) => string;
  goodWhen: GoodWhen;
  /** Rates change in percentage points, the rest in percent. */
  pp?: boolean;
}

function metrics(currency: string): Metric[] {
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });
  return [
    { key: "roas", label: "ROAS", pick: (r) => r.roas, format: (v) => formatRatio(v), goodWhen: "up" },
    { key: "cpa", label: "CPA", pick: (r) => r.cpa, format: unit, goodWhen: "down" },
    { key: "cpm", label: "CPM", pick: (r) => r.cpm, format: unit, goodWhen: "down" },
    {
      key: "ctr",
      label: "Link CTR",
      pick: (r) => r.linkCtr,
      format: (v) => formatPercent(v, { decimals: 2 }),
      goodWhen: "up",
      pp: true,
    },
    { key: "atc", label: "Cost / ATC", pick: (r) => r.costPerAtc, format: unit, goodWhen: "down" },
  ];
}

/** Path with a break wherever a value is missing. */
function pathOf(values: Array<number | null>, min: number, span: number, n: number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = n <= 1 ? W / 2 : (i / (n - 1)) * W;
    const y = PAD + (H - PAD * 2) - ((v - min) / span) * (H - PAD * 2);
    d += `${pen ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    pen = true;
  });
  return d.trim();
}

function TrendCard({
  metric,
  current,
  ghost,
  total,
  previousTotal,
}: {
  metric: Metric;
  current: Array<number | null>;
  ghost: Array<number | null> | null;
  total: number | null;
  previousTotal: number | null | undefined;
}) {
  const drawn = [...current, ...(ghost ?? [])].filter((v): v is number => v !== null);
  const min = drawn.length ? Math.min(...drawn) : 0;
  const max = drawn.length ? Math.max(...drawn) : 1;
  const span = max - min || 1;
  const enough = current.filter((v) => v !== null).length >= 2;
  const n = current.length;
  const hasCompare = previousTotal !== undefined && ghost !== null;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-hairline bg-surface-card p-[13px_15px] shadow-sm">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        {metric.label}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`font-mono text-[18px] font-semibold leading-none tabular ${
            total === null ? "text-content-muted" : "text-content-strong"
          }`}
        >
          {metric.format(total)}
        </span>
        {hasCompare &&
          (metric.pp ? (
            <PpChip delta={pointChange(total, previousTotal ?? null)} goodWhen={metric.goodWhen} />
          ) : (
            <DeltaChip delta={relativeChange(total, previousTotal ?? null)} goodWhen={metric.goodWhen} />
          ))}
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: H }}
        role="img"
        aria-label={`${metric.label} over the period`}
      >
        {ghost && ghost.some((v) => v !== null) && (
          <path
            d={pathOf(ghost, min, span, n)}
            fill="none"
            stroke="var(--gray-300)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {enough && (
          <path
            d={pathOf(current, min, span, n)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

export function MetaTrend({
  rows,
  range,
  comparison,
  currency,
}: {
  rows: readonly MetaRow[];
  range: DateRange;
  comparison: DateRange | null;
  /** Ad account currency. */
  currency: string;
}) {
  const grain = bucketGrain(range);
  const cur = series(inPeriod(rows, "current"), range, grain);
  const prev = comparison ? series(inPeriod(rows, "comparison"), comparison, grain) : null;
  const curTotal: MetaSums = sumRows(inPeriod(rows, "current"));
  const prevTotal = comparison ? ratesOf(sumRows(inPeriod(rows, "comparison"))) : null;
  const totalRates = ratesOf(curTotal);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {metrics(currency).map((m) => (
        <TrendCard
          key={m.key}
          metric={m}
          current={cur.map((b) => m.pick(ratesOf(b.sums)))}
          ghost={prev ? alignTo(prev.map((b) => m.pick(ratesOf(b.sums))), cur.length) : null}
          total={m.pick(totalRates)}
          previousTotal={prevTotal ? m.pick(prevTotal) : undefined}
        />
      ))}
    </div>
  );
}

/** The comparison series, padded or cut to the current series' length. */
function alignTo(values: Array<number | null>, n: number): Array<number | null> {
  if (values.length >= n) return values.slice(0, n);
  return [...values, ...Array.from({ length: n - values.length }, () => null)];
}
