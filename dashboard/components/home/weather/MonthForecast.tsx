/**
 * The "10-day forecast" of the Forecast Home: one row per client, read like
 * Apple Weather's list of days.
 *
 * Where Weather draws a day's low to high on one temperature scale, each row
 * here draws where the client's month is headed on one scale of its own
 * target (100% is the goal line). The pill is the warehouse's month-end
 * projection: its 80% range where the warehouse computes one (revenue), the
 * point projection otherwise (CM3). The white dot is the month to date. The
 * page adds no projection of its own: with no projection there is no pill,
 * and with no plan there is no target to scale by, so the row shows the month
 * to date only.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { METRIC_LABEL, fmtPace, fmtValue } from "@/lib/plan/format";
import type { PacingRow } from "@/lib/plan/types";
import type { ClientHealth } from "@/lib/home/types";
import { ConditionGlyph, conditionOf } from "./Glyphs";

const GRID =
  "grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[30px_minmax(0,11rem)_minmax(0,1fr)_7.5rem]";

/** Share of the target, clamped to the drawn scale. */
function at(value: number | null, target: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return (Math.max(0, Math.min(max, value / target)) / max) * 100;
}

/** The scale every row shares: at least 125% of target, in 25% steps, at most 250%. */
export function scaleMax(clients: ClientHealth[]): number {
  let top = 1.25;
  for (const c of clients) {
    const r = c.focus;
    if (!r || !r.target || r.target <= 0) continue;
    for (const v of [r.actual, r.projected, r.projectedHigh]) {
      if (v !== null && Number.isFinite(v)) top = Math.max(top, v / r.target);
    }
  }
  return Math.min(2.5, Math.ceil((top + 0.02) / 0.25) * 0.25);
}

function Bar({ row, max }: { row: PacingRow; max: number }) {
  const target = row.target as number;
  const tone = toneVars(toneOfRow(row));
  const dot = at(row.actual, target, max);
  const low = at(row.projectedLow ?? row.projected, target, max);
  const high = at(row.projectedHigh ?? row.projected, target, max);
  const goal = at(target, target, max) as number;
  const pillStart = low !== null && high !== null ? Math.min(low, high) : null;
  const pillEnd = low !== null && high !== null ? Math.max(low, high) : null;

  return (
    <div aria-hidden="true" className="relative h-[8px] w-full rounded-full bg-[rgba(17,24,28,0.08)]">
      {dot !== null && pillStart !== null && pillStart > dot && (
        <span
          className="absolute top-1/2 h-[2px] -translate-y-1/2"
          style={{
            left: `${dot}%`,
            width: `${pillStart - dot}%`,
            backgroundImage: `linear-gradient(90deg, ${tone.graphic} 50%, transparent 50%)`,
            backgroundSize: "6px 2px",
            opacity: 0.55,
          }}
        />
      )}
      {pillStart !== null && pillEnd !== null && pillEnd - pillStart >= 1 && (
        <span
          className="absolute inset-y-0 rounded-full"
          style={{
            left: `${pillStart}%`,
            width: `${pillEnd - pillStart}%`,
            background: `linear-gradient(90deg, ${tone.tint}, ${tone.graphic})`,
            boxShadow: `inset 0 0 0 1px ${tone.graphic}`,
          }}
        />
      )}
      {pillStart !== null && pillEnd !== null && pillEnd - pillStart < 1 && (
        <span
          className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(pillStart + pillEnd) / 2}%`, background: tone.graphic }}
        />
      )}
      <span
        className="absolute top-[-5px] h-[18px] w-[2px] -translate-x-1/2 rounded-full bg-[var(--h-mark,#1c1c1e)]"
        style={{ left: `${goal}%` }}
      />
      {dot !== null && (
        <span
          className="absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] bg-white"
          style={{ left: `${dot}%`, borderColor: "var(--h-mark, #1c1c1e)" }}
        />
      )}
    </div>
  );
}

function rowTip(c: ClientHealth, row: PacingRow): string {
  const cur = c.currency ?? "CZK";
  const v = (x: number | null) => fmtValue(x, row.metric, cur);
  const parts = [
    `${METRIC_LABEL[row.metric]} target ${v(row.target)}, month to date ${v(row.actual)}, pace ${fmtPace(row.pacePct)} of plan to date.`,
    row.projected !== null ? `Projected month end ${v(row.projected)}.` : "No month-end projection from the warehouse yet.",
    row.projectedLow !== null && row.projectedHigh !== null
      ? `80% range ${v(row.projectedLow)} to ${v(row.projectedHigh)}.`
      : null,
  ];
  return parts.filter(Boolean).join(" ");
}

function ClientRow({ client, max }: { client: ClientHealth; max: number }) {
  const row = client.focus;
  const currency = client.currency;
  const tone = row ? toneOfRow(row) : "neutral";
  const colours = toneVars(tone);
  const href = client.clientId
    ? `${row ? "/goals" : "/snapshot"}?client=${encodeURIComponent(client.clientId)}`
    : null;

  const mtdMetric = row?.metric ?? "revenue";
  const mtdValue = row ? row.actual : client.revenue.actual;
  const mtd = currency && mtdValue !== null ? fmtValue(mtdValue, mtdMetric, currency, { compact: true }) : NO_VALUE;
  const status = !client.clientId
    ? "Not in the warehouse"
    : row
      ? `${METRIC_LABEL[row.metric]} · ${planStatusLabel(row)}`
      : "Revenue · No plan";
  const hasScale = !!row && row.target !== null && row.target > 0;

  return (
    <li className={`${GRID} border-t border-hairline py-3 first:border-t-0`}>
      <span
        className="flex h-[30px] w-[30px] items-center justify-center rounded-full"
        style={{ background: colours.tint, color: colours.graphic }}
      >
        <ConditionGlyph condition={conditionOf(tone)} size={18} />
      </span>

      <div className="flex min-w-0 flex-col">
        {href ? (
          <AppLink
            href={href}
            className="truncate text-[16px] font-semibold leading-[1.25] text-content-strong underline-offset-2 hover:underline"
          >
            {client.name}
          </AppLink>
        ) : (
          <span className="truncate text-[16px] font-semibold leading-[1.25] text-content-strong">{client.name}</span>
        )}
        <span
          className="truncate text-[12.5px] font-semibold leading-[1.3]"
          style={{ color: row ? colours.text : "var(--text-muted)" }}
        >
          {status}
        </span>
      </div>

      <div className="order-last col-span-3 flex min-w-0 items-center gap-3 sm:order-none sm:col-span-1">
        <span className="w-[4.75rem] flex-none text-right text-[14px] font-semibold tabular text-content-muted">
          <span className="sr-only">Month to date </span>
          {mtd}
        </span>
        <div className="min-w-0 flex-1">
          {hasScale ? (
            <Bar row={row as PacingRow} max={max} />
          ) : (
            <span className="block text-[12.5px] text-content-muted">
              {client.clientId ? "No plan this month" : "ClickUp only"}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-end text-right">
        {hasScale && row && row.projected !== null && currency ? (
          <>
            <span className="inline-flex items-center gap-1 text-[16px] font-semibold tabular text-content-strong">
              {fmtValue(row.projected, row.metric, currency, { compact: true })}
              <InfoTip text={rowTip(client, row)} label={`About ${client.name}'s month`} />
            </span>
            <span className="text-[12px] tabular text-content-muted">
              of {fmtValue(row.target, row.metric, currency, { compact: true })}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-[16px] font-semibold text-content-muted">
            {NO_VALUE}
            <InfoTip
              text={
                !client.clientId
                  ? "Not in the warehouse registry (ref.clients), so no shop data."
                  : !row
                    ? "No Goals plan this month (mart.plan_pacing), so no target and no projection."
                    : row && currency
                      ? rowTip(client, row)
                      : "No projection."
              }
              label={`Why ${client.name} has no projection`}
            />
          </span>
        )}
      </div>
    </li>
  );
}

export function MonthForecast({ clients, monthLabel }: { clients: ClientHealth[]; monthLabel: string | null }) {
  const max = scaleMax(clients);
  const ticks = [0, 0.5, 1, 1.5, 2, 2.5].filter((t) => t <= max);

  return (
    <div className="rounded-card border border-hairline bg-surface-card px-4 pb-2 pt-3.5 shadow-sm sm:px-6">
      <div className={`${GRID} pb-2`}>
        <span className="col-span-2 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted">
          {monthLabel ?? "This month"}
          <InfoTip
            text="Dot: month to date. Pill: the warehouse's month-end projection, its 80% range where it computes one. Line: the month's target. Every row on the same scale, in % of its own target."
            label="How to read the forecast"
          />
        </span>
        <div className="hidden min-w-0 items-center gap-3 sm:flex">
          <span className="w-[4.75rem] flex-none text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-content-muted">
            To date
          </span>
          <div className="relative h-[14px] min-w-0 flex-1">
            {ticks.map((t) => (
              <span
                key={t}
                className={`absolute top-0 text-[11px] font-semibold tabular ${
                  t === 0 ? "" : t === max ? "-translate-x-full" : "-translate-x-1/2"
                } ${t === 1 ? "text-content-strong" : "text-content-muted"}`}
                style={{ left: `${(t / max) * 100}%` }}
              >
                {t === 1 ? "Target" : `${Math.round(t * 100)}%`}
              </span>
            ))}
          </div>
        </div>
        <span className="hidden text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-content-muted sm:block">
          Month end
        </span>
      </div>
      <ol className="m-0 list-none p-0">
        {clients.map((c) => (
          <ClientRow key={c.key} client={c} max={max} />
        ))}
      </ol>
    </div>
  );
}
