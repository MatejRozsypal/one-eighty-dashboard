/**
 * Quarter view: promo windows and checkpoints on one strip, then a card each.
 *
 * Strip: one lane per item across the quarter, the bar tinted by the item's
 * order status, a line at as of. Checkpoints are thin bars ending in a mark on
 * the check day.
 *
 * Card: window, status, the whole store in the window against the window's
 * slice of the curve (the number that adds up to the month), and the orders
 * attributed to the promo against its own target, n/a until both exist. A
 * promo with Target units adds units sold against it, and a started promo
 * its lift over the no-promo baseline. A checkpoint card leads
 * with the metric it has a target for (units, else orders, else revenue),
 * and its chip is that row's status. Every other condition the checkpoint
 * sets follows on its own line: orders, new customers, the CM3 floor and the
 * aMER floor. An aMER line always names the paid spend it is computed on, so
 * a multiple is never read without knowing how much bought it.
 */

import { StatusChip } from "@/components/plan/StatusChip";
import { NO_VALUE, formatMoney } from "@/lib/format";
import { daysBetween, fmtDay, fmtRange, monthStart, addMonths, monthEnd } from "@/lib/plan/dates";
import { METRIC_LABEL, fmtCount, fmtLift, fmtMer, fmtPace, fmtValue } from "@/lib/plan/format";
import { gateConditions, headlineMetric, liftRow, type TimelineItem } from "@/lib/plan/model";
import type { PacingRow, RowStatus } from "@/lib/plan/types";

const BAR: Record<RowStatus, string> = {
  ahead: "bg-info/70",
  on_track: "bg-growth-500/70",
  behind: "bg-warning/80",
  off_track: "bg-negative/75",
  not_started: "bg-gray-250",
  closed: "bg-gray-400",
  no_target: "bg-gray-250",
  not_measured: "bg-gray-250",
};

function Muted({ text }: { text: string }) {
  return <span className={text === NO_VALUE ? "text-content-muted" : "text-content-strong"}>{text}</span>;
}

function pct(date: string, start: string, span: number): number {
  return Math.min(100, Math.max(0, (daysBetween(start, date) / span) * 100));
}

export function PromoTimeline({
  items,
  start,
  end,
  asOf,
  currency,
}: {
  items: TimelineItem[];
  start: string;
  end: string;
  asOf: string | null;
  currency: string;
}) {
  const span = daysBetween(start, end) + 1;
  const months: string[] = [];
  for (let m = monthStart(start); m <= end; m = addMonths(m, 1)) months.push(m);
  const asOfAt = asOf && asOf >= start && asOf <= end ? pct(asOf, start, span) + 100 / span : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="relative ml-[56px] flex h-5 border-b border-hairline">
            {months.map((m) => {
              const from = m < start ? start : m;
              const to = monthEnd(m) > end ? end : monthEnd(m);
              return (
                <span
                  key={m}
                  className="absolute top-0 border-l border-hairline pl-1.5 font-mono text-[10.5px] text-content-muted"
                  style={{ left: `${pct(from, start, span)}%`, width: `${((daysBetween(from, to) + 1) / span) * 100}%` }}
                >
                  {new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                </span>
              );
            })}
          </div>
          <ul className="relative flex flex-col gap-1.5 py-2">
            {asOfAt !== null && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 top-0 w-px bg-content-strong/40"
                style={{ left: `calc(56px + (100% - 56px) * ${asOfAt / 100})` }}
              />
            )}
            {items.map((item) => {
              const s = item.start < start ? start : item.start;
              const e = item.end > end ? end : item.end;
              const status = item.byMetric.orders?.status ?? "not_started";
              const left = pct(s, start, span);
              const width = Math.max(1.2, ((daysBetween(s, e) + 1) / span) * 100);
              return (
                <li key={item.taskId} className="flex h-6 items-center">
                  <span className="w-[56px] flex-none truncate font-mono text-[11px] text-content-strong">{item.code}</span>
                  <span className="relative h-full flex-1">
                    <span
                      title={`${item.code} · ${item.name}, ${fmtRange(item.start, item.end)}`}
                      className={`absolute top-1/2 -translate-y-1/2 rounded-[4px] ${
                        item.kind === "gate" ? "h-[6px] bg-content-strong/30" : `h-[14px] ${BAR[status]}`
                      } ${item.planStatus === "planning" ? "opacity-50" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                    {item.kind === "gate" && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-content-strong"
                        style={{ left: `${pct(e, start, span) + 100 / span}%` }}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <TimelineCard key={item.taskId} item={item} currency={currency} />
        ))}
      </div>
    </div>
  );
}

/**
 * One checkpoint condition: actual (or n/a) of its threshold. An aMER line adds
 * the spend the ratio is computed on, and the spend the window must carry for
 * the floor to count (derived from the ad budget, absent when there is none).
 */
function ConditionLine({ row, currency }: { row: PacingRow; currency: string }) {
  const started = row.status !== "not_started";
  const spendNote =
    row.metric === "amer"
      ? [
          started && row.ratioDenActual !== null ? `on ${formatMoney(row.ratioDenActual, currency)}` : null,
          row.minSpend !== null ? `needs ${formatMoney(row.minSpend, currency)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  return (
    <>
      <dt className="text-content-muted">{METRIC_LABEL[row.metric]}</dt>
      <dd className="text-right tabular">
        <Muted text={started ? fmtValue(row.actual, row.metric, currency) : NO_VALUE} />
        <span className="text-content-muted"> of {fmtValue(row.target, row.metric, currency)}</span>
        {spendNote && <span className="block text-[10.5px] text-content-muted">{spendNote}</span>}
      </dd>
    </>
  );
}

function TimelineCard({ item, currency }: { item: TimelineItem; currency: string }) {
  const orders = item.byMetric.orders;
  // A checkpoint is judged on the metric it has a target for (units first).
  const lead = item.kind === "gate" ? headlineMetric(item.byMetric) : "orders";
  const head = item.byMetric[lead];
  const units = item.kind === "promo" && item.byMetric.units?.target != null ? item.byMetric.units : undefined;
  const started = (row: PacingRow | undefined) => row !== undefined && row.status !== "not_started";
  // Lift only once there is one to read: a line of n/a on every future promo is clutter.
  const lift = item.kind === "promo" ? liftRow(item.byMetric) : null;
  const merRow = [head, orders, ...Object.values(item.byMetric)].find((r) => r?.merCapPct != null);

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[14px_16px]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold text-content-strong">
            <span className="font-mono">{item.code}</span> · {item.name}
          </span>
          <span className="font-mono text-[11px] text-content-muted">
            {item.kind === "gate" ? `Check ${fmtDay(item.end)}` : fmtRange(item.start, item.end)}
            {item.planStatus === "planning" && " · planning"}
          </span>
        </div>
        {head && <StatusChip row={head} />}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px]">
        {item.kind === "promo" ? (
          <>
            <dt className="text-content-muted">Store orders</dt>
            <dd className="text-right tabular">
              <Muted text={started(orders) ? fmtCount(orders?.actual) : NO_VALUE} />
              <span className="text-content-muted"> of {fmtCount(orders?.target)}</span>
            </dd>
            <dt className="text-content-muted">Pace</dt>
            <dd className="text-right tabular">
              <Muted text={started(orders) ? fmtPace(orders?.pacePct) : NO_VALUE} />
            </dd>
            {units && (
              <>
                <dt className="text-content-muted">{METRIC_LABEL.units}</dt>
                <dd className="text-right tabular">
                  <Muted text={started(units) ? fmtCount(units.actual) : NO_VALUE} />
                  <span className="text-content-muted"> of {fmtCount(units.target)}</span>
                </dd>
              </>
            )}
            {lift?.liftPct != null && (
              <>
                <dt className="text-content-muted">Lift</dt>
                <dd className="text-right tabular">
                  <Muted text={fmtLift(lift.liftPct)} />
                  {lift.metric !== "orders" && <span className="text-content-muted"> {METRIC_LABEL[lift.metric].toLowerCase()}</span>}
                </dd>
              </>
            )}
            <dt className="text-content-muted">Attributed</dt>
            <dd className="text-right tabular">
              <Muted text={fmtCount(item.attributedOrders)} />
              <span className="text-content-muted"> of {fmtCount(item.attributedTarget)}</span>
            </dd>
          </>
        ) : (
          <>
            {head ? (
              <ConditionLine row={head} currency={currency} />
            ) : (
              <>
                <dt className="text-content-muted">{METRIC_LABEL[lead]}</dt>
                <dd className="text-right tabular">
                  <Muted text={NO_VALUE} />
                </dd>
              </>
            )}
            {started(head) && head?.target != null && head.metric !== "amer" && (
              <>
                <dt className="text-content-muted">Pace</dt>
                <dd className="text-right tabular">
                  <Muted text={fmtPace(head.pacePct)} />
                </dd>
              </>
            )}
            {gateConditions(item.byMetric, lead).map((row) => (
              <ConditionLine key={row.metric} row={row} currency={currency} />
            ))}
            {merRow && (
              <>
                <dt className="text-content-muted">MER</dt>
                <dd className="text-right tabular">
                  <Muted text={fmtMer(merRow.merActualPct)} />
                  <span className="text-content-muted"> cap {fmtMer(merRow.merCapPct)}</span>
                </dd>
              </>
            )}
          </>
        )}
      </dl>
    </article>
  );
}
