"use client";

/**
 * Markets ranked by absolute CM3 once every sold market has a cost card, by
 * GP after ads before (gross profit, then net revenue when a market lacks
 * it), each with its verdict chip, maturity badge and the change against the
 * comparison. A row opens the market.
 */

import { DeltaChip } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { NaValue, VerdictChip, MaturityBadge } from "@/components/markets/bits";
import { isNa, num, RANK_LABEL, type MarketsModel } from "@/lib/markets/model";
import { columnCurrency, formatFigure, longName, type CurrencyMode } from "@/lib/markets/display";

export function Leaderboard({
  model,
  mode,
  onOpen,
}: {
  model: MarketsModel;
  mode: CurrencyMode;
  onOpen: (market: string) => void;
}) {
  const key = model.ranking.key;
  const max = Math.max(1, ...model.markets.map((c) => Math.abs(num(c.cur[key]) ?? 0)));

  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
        Ranked by {RANK_LABEL[key]}
        <InfoTip
          text={
            key === "cm3"
              ? "Absolute CM3 decides the order; ratios explain it."
              : model.ranking.why
                ? `Not every market has GP after ads: ${model.ranking.why}.`
                : "Absolute GP after ads decides the order; ratios explain it. CM3 takes over once every market has a cost card (Settings > Market costs)."
          }
        />
      </h2>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {model.markets.map((c, i) => {
          const ccy = columnCurrency(c, mode, model.baseCurrency);
          const x = c.cur[key];
          const prev = c.prev ? c.prev[key] : null;
          const v = num(x);
          return (
            <li key={c.key}>
              <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-2.5 transition-colors duration-fast hover:bg-gray-50">
                <span className="font-mono text-[12px] tabular text-content-muted">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => onOpen(c.key)}
                  className="min-w-0 truncate text-left text-[14px] font-medium text-content-strong underline decoration-transparent underline-offset-4 hover:decoration-hairline-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {longName(c)}
                </button>
                <span className="text-right font-mono text-[14px] tabular text-content-strong">
                  {isNa(x) ? <NaValue reason={x.na} /> : formatFigure(x.v * ccy.cur, "money", ccy.code)}
                </span>
                <span />
                <span className="col-span-2 flex flex-col gap-1.5">
                  <span aria-hidden="true" className="block h-[6px] rounded-pill bg-gray-100">
                    <span
                      className={`block h-full rounded-pill ${v !== null && v < 0 ? "bg-negative" : "bg-growth-500"}`}
                      style={{ width: `${v === null ? 0 : (Math.abs(v) / max) * 100}%` }}
                    />
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {c.verdict && <VerdictChip verdict={c.verdict} maturity={c.maturity.level} maturityWhy={c.maturity.why} />}
                      <MaturityBadge level={c.maturity.level} why={c.maturity.why} />
                    </span>
                    {prev && !isNa(x) && !isNa(prev) && (
                      <DeltaChip
                        change={{ current: x.v * ccy.cur, previous: prev.v * ccy.prev, kind: "money", currency: ccy.code, compact: true }}
                        goodWhen="up"
                      />
                    )}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
