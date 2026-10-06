/**
 * Quarter view: promo windows and checkpoints on one strip, then a card each.
 *
 * Strip: one lane per item across the quarter, the bar tinted by the item's
 * order status, a line at as of. Checkpoints are thin bars ending in a mark on
 * the check day.
 *
 * Card: window, status, the whole store in the window against the window's
 * slice of the curve (the number that adds up to the month), and the orders
 * attributed to the promo against its own target, n/a until both exist.
 */

import { StatusChip } from "@/components/plan/StatusChip";
import { NO_VALUE } from "@/lib/format";
import { daysBetween, fmtDay, fmtRange, monthStart, addMonths, monthEnd } from "@/lib/plan/dates";
import { fmtCount, fmtMer, fmtPace } from "@/lib/plan/format";
import type { TimelineItem } from "@/lib/plan/model";
import type { PacingStatus } from "@/lib/plan/types";

const BAR: Record<PacingStatus, string> = {
  ahead: "bg-info/70",
  on_track: "bg-growth-500/70",
  behind: "bg-warning/80",
  off_track: "bg-negative/75",
  not_started: "bg-gray-250",
  closed: "bg-gray-400",
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
}: {
  items: TimelineItem[];
  start: string;
  end: string;
  asOf: string | null;
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
          <TimelineCard key={item.taskId} item={item} />
        ))}
      </div>
    </div>
  );
}

function TimelineCard({ item }: { item: TimelineItem }) {
  const orders = item.byMetric.orders;
  const started = orders && orders.status !== "not_started";
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
        {orders && <StatusChip row={orders} />}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px]">
        {item.kind === "promo" ? (
          <>
            <dt className="text-content-muted">Store orders</dt>
            <dd className="text-right tabular">
              <Muted text={started ? fmtCount(orders?.actual) : NO_VALUE} />
              <span className="text-content-muted"> of {fmtCount(orders?.target)}</span>
            </dd>
            <dt className="text-content-muted">Pace</dt>
            <dd className="text-right tabular">
              <Muted text={started ? fmtPace(orders?.pacePct) : NO_VALUE} />
            </dd>
            <dt className="text-content-muted">Attributed</dt>
            <dd className="text-right tabular">
              <Muted text={fmtCount(item.attributedOrders)} />
              <span className="text-content-muted"> of {fmtCount(item.attributedTarget)}</span>
            </dd>
          </>
        ) : (
          <>
            <dt className="text-content-muted">Orders</dt>
            <dd className="text-right tabular">
              <Muted text={started ? fmtCount(orders?.actual) : NO_VALUE} />
              <span className="text-content-muted"> of {fmtCount(orders?.target)}</span>
            </dd>
            {orders?.merCapPct !== null && orders?.merCapPct !== undefined && (
              <>
                <dt className="text-content-muted">MER</dt>
                <dd className="text-right tabular">
                  <Muted text={fmtMer(orders.merActualPct)} />
                  <span className="text-content-muted"> cap {fmtMer(orders.merCapPct)}</span>
                </dd>
              </>
            )}
          </>
        )}
      </dl>
    </article>
  );
}
