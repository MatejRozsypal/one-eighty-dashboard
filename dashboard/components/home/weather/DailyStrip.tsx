"use client";

/**
 * The "hourly" strip of the Forecast Home: one cell per day of the month,
 * the way Apple Weather lays out the next hours.
 *
 * Each cell is the day's actual against the day's plan, summed over the
 * clients with a Goals plan for the metric (one currency only). The plan is
 * the Goals daily curve from the day rows of mart.plan_pacing, so a promo day
 * carries its own higher plan. A sun is a day at or above its plan, a cloud a
 * day below it; days still to come show their plan alone, like a forecast.
 * The bar is the same comparison drawn: the tick is the plan, the fill the
 * actual, up to one and a half times the plan.
 */

import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE, formatMoney, formatNumber } from "@/lib/format";
import { dayParts, type StripData, type StripDay, type StripMetric, type StripSeries } from "@/lib/home/weather/model";
import { ConditionGlyph, TileGlyph } from "./Glyphs";

const LABEL: Record<StripMetric, string> = { revenue: "Revenue", cm3: "CM3" };
const METER_MAX = 1.5;
const METER_H = 40;
const SUN = "#FFD60A";

/** "48K", "1.2M", "940": short enough for a 52px cell. */
function short(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return NO_VALUE;
  const abs = Math.abs(v);
  return formatNumber(v, { compact: abs >= 1000, decimals: abs >= 10_000 && abs < 1_000_000 ? 0 : 1 });
}

function money(v: number | null, currency: string): string {
  return formatMoney(v, currency);
}

function describe(day: StripDay, metric: StripMetric, currency: string): string {
  const { weekday, day: n, month } = dayParts(day.date);
  const when = `${weekday} ${n} ${month}`;
  const plan = `plan ${money(day.target, currency)}`;
  if (day.state === "future") return `${when}: ${plan}.`;
  if (day.actual === null) return `${when}: ${LABEL[metric]} ${NO_VALUE}, ${plan}. ${day.note ?? ""}`.trim();
  const verdict = day.target === null ? "" : day.actual >= day.target ? ", at or above plan" : ", below plan";
  return `${when}: ${LABEL[metric]} ${money(day.actual, currency)}, ${plan}${verdict}.`;
}

function Meter({ day }: { day: StripDay }) {
  const ratio = day.actual !== null && day.target !== null && day.target > 0 ? day.actual / day.target : null;
  const fill = ratio === null ? 0 : Math.max(0, Math.min(METER_MAX, ratio)) / METER_MAX;
  const tick = 1 / METER_MAX;
  const met = ratio !== null && ratio >= 1;
  return (
    <span aria-hidden="true" className="relative block w-[6px] rounded-full bg-white/20" style={{ height: METER_H }}>
      {ratio !== null && (
        <span
          className="absolute inset-x-0 bottom-0 rounded-full"
          style={{ height: `${fill * 100}%`, background: met ? SUN : "rgba(255,255,255,0.92)" }}
        />
      )}
      {day.target !== null && (
        <span
          className="absolute left-[-4px] right-[-4px] h-[2px] rounded-full bg-white"
          style={{ bottom: `calc(${tick * 100}% - 1px)`, opacity: day.state === "future" ? 0.55 : 0.95 }}
        />
      )}
    </span>
  );
}

function Cell({ day, metric, currency, isToday }: { day: StripDay; metric: StripMetric; currency: string; isToday: boolean }) {
  const { weekday, day: n } = dayParts(day.date);
  const met = day.actual !== null && day.target !== null ? day.actual >= day.target : null;
  const future = day.state === "future";
  return (
    <li
      data-today={isToday || undefined}
      aria-label={describe(day, metric, currency)}
      className={`flex w-[54px] flex-none flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 ${
        isToday ? "bg-white/[0.22] ring-1 ring-inset ring-white/60" : ""
      }`}
    >
      <span className={`text-[12px] font-semibold leading-none ${future && !isToday ? "text-white/70" : ""}`}>
        {isToday ? "Today" : weekday}
      </span>
      <span className={`text-[15px] font-semibold leading-none tabular ${future && !isToday ? "text-white/70" : ""}`}>{n}</span>
      <span className="flex h-[24px] items-center justify-center">
        {met === null ? (
          <span aria-hidden="true" className="block h-[5px] w-[5px] rounded-full bg-white/45" />
        ) : (
          <ConditionGlyph condition={met ? "sun" : "cloud"} size={24} sunFill={SUN} className={met ? "text-[#FFD60A]" : "text-white"} />
        )}
      </span>
      <span className={`text-[13px] font-semibold leading-none tabular ${future || day.actual === null ? "text-white/70" : ""}`}>
        {future ? short(day.target) : short(day.actual)}
      </span>
      <Meter day={day} />
    </li>
  );
}

function Toggle({
  value,
  options,
  onChange,
}: {
  value: StripMetric;
  options: StripMetric[];
  onChange: (m: StripMetric) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div role="group" aria-label="Strip metric" className="inline-flex rounded-full bg-black/[0.18] p-[3px]">
      {options.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors duration-fast ${
            value === m ? "bg-white text-[#1c1c1e] [text-shadow:none]" : "text-white/85 hover:text-white"
          }`}
        >
          {LABEL[m]}
        </button>
      ))}
    </div>
  );
}

function Summary({ series }: { series: StripSeries }) {
  const { currency } = series;
  return (
    <span className="text-[12px] font-medium leading-[1.35] text-white/85 tabular">
      Month to date {formatMoney(series.monthActual, currency, { compact: true })} of{" "}
      {formatMoney(series.monthTargetToDate, currency, { compact: true })} planned ·{" "}
      {series.clients.join(", ")}
    </span>
  );
}

export function DailyStrip({ strip, today }: { strip: StripData; today: string }) {
  const options = (["cm3", "revenue"] as const).filter((m) => strip[m] !== null);
  // CM3 first: it is what the profit share is paid on, and the ring's metric
  // when the plan targets it. Revenue when no plan targets CM3.
  const [metric, setMetric] = useState<StripMetric>(options[0] ?? "revenue");
  const series = strip[metric];
  const scroller = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = scroller.current;
    const cell = list?.querySelector<HTMLElement>("[data-today]");
    if (!list || !cell) return;
    list.scrollLeft = Math.max(0, cell.offsetLeft - list.clientWidth / 2 + cell.clientWidth / 2);
  }, [metric]);

  const tip = series
    ? [
        `Each day's ${LABEL[metric]} against the Goals daily plan, summed over ${series.clients.join(", ")}, in ${series.currency}.`,
        "Sun: at or above plan. Cloud: below.",
        series.excluded.length ? `Left out (other currency): ${series.excluded.join(", ")}.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : strip.note ?? "No client has a Goals plan this month.";

  return (
    <section
      aria-label="Daily results against plan"
      className="rounded-[20px] bg-[rgba(8,18,40,0.24)] backdrop-blur-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/20 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/85">
            <TileGlyph icon="calendar" size={13} />
            {strip.monthLabel ?? "This month"} · Daily {LABEL[metric]} vs plan
            <InfoTip text={tip} label="About the daily strip" />
          </span>
          {series && <Summary series={series} />}
        </div>
        <Toggle value={metric} options={[...options]} onChange={setMetric} />
      </div>

      {series ? (
        <ol
          ref={scroller}
          className="flex list-none gap-0.5 overflow-x-auto px-2 py-2.5 [scrollbar-width:thin]"
          style={{ scrollbarColor: "rgba(255,255,255,0.35) transparent" }}
        >
          {series.days.map((day) => (
            <Cell key={day.date} day={day} metric={metric} currency={series.currency} isToday={day.date === today} />
          ))}
        </ol>
      ) : (
        <p className="m-0 px-4 py-6 text-center text-[13px] font-medium text-white/85">
          {NO_VALUE}
        </p>
      )}
    </section>
  );
}
