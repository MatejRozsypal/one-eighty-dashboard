/**
 * Pinned: one activity card per client. Pure, safe anywhere.
 *
 * A client with a Goals plan this month gets the three Activity rings, outer
 * revenue, middle CM3, inner aMER. Each ring is the pacing row's actual to
 * date over its target to date, so a closed ring means on plan for today and
 * a ring past one turn means ahead of it. Every number is the pacing row as
 * the Goals page shows it (mart.plan_pacing); a metric the plan does not
 * target keeps an empty track and shows its month-to-date actual.
 *
 * A client without a plan has nothing to pace against, so it gets a single
 * neutral ring: revenue month to date over the same days a year earlier, from
 * mart.plan_actuals_daily, the same comparison the Home cards make.
 */

import { NO_VALUE, formatMoney, formatNumber, formatPercent, formatRatio, MINUS } from "@/lib/format";
import { fmtPace } from "@/lib/plan/format";
import { planStatusLabel } from "@/lib/plan/health";
import type { PacingRow } from "@/lib/plan/types";
import type { ClientHealth, MonthMetric } from "@/lib/home/types";
import { completeSum, monthStart, yearEarlier } from "./series";
import type { ClientSeries, PinnedCard, RingFigure } from "./types";

type RingMetric = RingFigure["metric"];

const LABEL: Record<RingMetric, string> = { revenue: "Revenue", cm3: "CM3", amer: "aMER" };

const UNMEASURED: Record<RingMetric, string> = {
  revenue: "No daily actuals in mart.plan_actuals_daily this month.",
  cm3: "CM3 needs cost data on every day this month (mart.plan_actuals_daily).",
  amer: "aMER needs paid spend on every day this month (mart.plan_actuals_daily).",
};

/** "CZK 412K", "$41.2K", "2.10×". */
export function compactValue(value: number | null | undefined, metric: RingMetric, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  if (metric === "amer") return formatRatio(value);
  return formatMoney(value, currency, { compact: true });
}

/** The comparison beside the figure, without the currency: "430K", "2.40×". */
function compactTarget(value: number | null | undefined, metric: RingMetric): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (metric === "amer") return formatRatio(value);
  return formatNumber(value, { compact: true, decimals: 1 });
}

function planRing(metric: RingMetric, m: MonthMetric, currency: string, monthLabel: string | null): RingFigure {
  const row: PacingRow | null = m.row;
  const label = LABEL[metric];
  if (!row) {
    return {
      metric,
      label,
      actualText: compactValue(m.actual, metric, currency),
      targetText: null,
      fraction: null,
      caption: "No target",
      note:
        m.actual === null
          ? UNMEASURED[metric]
          : `The Goals plan has no ${label} target for ${monthLabel ?? "this month"}. Month to date from mart.plan_actuals_daily.`,
    };
  }
  if (row.status === "not_measured" || row.actual === null) {
    return {
      metric,
      label,
      actualText: NO_VALUE,
      targetText: compactTarget(row.targetToDate, metric),
      fraction: null,
      caption: "Not measured",
      note: UNMEASURED[metric],
    };
  }
  const fraction =
    row.targetToDate !== null && row.targetToDate > 0 ? Math.max(0, row.actual / row.targetToDate) : null;
  return {
    metric,
    label,
    actualText: compactValue(row.actual, metric, currency),
    targetText: compactTarget(row.targetToDate, metric),
    fraction,
    caption: `${fmtPace(row.pacePct)} of plan · ${planStatusLabel(row)}`,
    note:
      fraction === null
        ? "The plan to date is zero or below, so there is nothing to measure the ring against."
        : null,
  };
}

function signed(fraction: number): string {
  const text = formatPercent(Math.abs(fraction));
  if (text === formatPercent(0)) return text;
  return fraction < 0 ? `${MINUS}${text}` : `+${text}`;
}

/** Revenue on the same days a year earlier, from the daily actuals, when every day is there. */
function lastYearRevenue(series: ClientSeries | undefined): number | null {
  if (!series) return null;
  const from = yearEarlier(monthStart(series.asOf));
  const to = yearEarlier(series.asOf);
  return completeSum(series.days, "revenue", from, to);
}

function lastYearCard(c: ClientHealth, currency: string, series: ClientSeries | undefined): RingFigure {
  const ly = lastYearRevenue(series);
  const change = c.revenueVsLastYear.value;
  return {
    metric: "revenue",
    label: "Revenue",
    actualText: compactValue(c.revenue.actual, "revenue", currency),
    targetText: change === null ? null : compactTarget(ly, "revenue"),
    fraction: change === null ? null : Math.max(0, 1 + change),
    caption: change === null ? "Last year n/a" : `${signed(change)} on last year`,
    note:
      c.revenue.actual === null
        ? UNMEASURED.revenue
        : change === null
          ? c.revenueVsLastYear.note
          : null,
  };
}

function extra(metric: RingMetric, m: MonthMetric, currency: string): RingFigure {
  return {
    metric,
    label: LABEL[metric],
    actualText: compactValue(m.actual, metric, currency),
    targetText: null,
    fraction: null,
    caption: "Month to date",
    note: m.actual === null ? UNMEASURED[metric] : null,
  };
}

export function buildPinned(clients: ClientHealth[], series: ClientSeries[]): PinnedCard[] {
  const cards: PinnedCard[] = [];
  for (const c of clients) {
    if (!c.clientId || !c.currency) continue;
    const s = series.find((x) => x.clientId === c.clientId);
    const href = `/goals?client=${encodeURIComponent(c.clientId)}`;
    const hasPlan = Boolean(c.revenue.row || c.cm3.row || c.amer.row);
    cards.push(
      hasPlan
        ? {
            clientId: c.clientId,
            name: c.name,
            mode: "plan",
            rings: [
              planRing("revenue", c.revenue, c.currency, c.monthLabel),
              planRing("cm3", c.cm3, c.currency, c.monthLabel),
              planRing("amer", c.amer, c.currency, c.monthLabel),
            ],
            extras: [],
            asOf: c.asOf,
            monthLabel: c.monthLabel,
            href,
          }
        : {
            clientId: c.clientId,
            name: c.name,
            mode: "lastYear",
            rings: [lastYearCard(c, c.currency, s)],
            extras: [extra("cm3", c.cm3, c.currency), extra("amer", c.amer, c.currency)],
            asOf: c.asOf,
            monthLabel: c.monthLabel,
            href,
          }
    );
  }
  // Clients with a plan first: their rings are the ones that mean "on plan".
  return cards.sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "plan" ? -1 : 1));
}

