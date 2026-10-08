"use client";

/**
 * The top of the Forecast Home, after Apple Weather's opening screen: a sky
 * that follows the time of day and the weather outside, the greeting, the
 * real local weather, and one big reading in the place of the temperature.
 *
 * That reading is the share of clients with a Goals plan this month whose
 * ring metric is on track or ahead, the warehouse's own status. "H" and "L"
 * are the best and worst pace against the plan to date among them.
 *
 * The weather runs in the browser, as on the current Home: the location goes
 * only to Open-Meteo and BigDataCloud, never to our server, and Prague stands
 * in until (or unless) the browser shares one. A failed forecast reads n/a.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { Skeleton } from "@/components/ui/Skeleton";
import { NO_VALUE, formatPercent } from "@/lib/format";
import { HOME_TIME_ZONE, hourIn, longDate, partOfDay } from "@/lib/home/greeting";
import {
  FALLBACK_PLACE,
  describeCode,
  forecastUrl,
  parseForecast,
  parsePlace,
  placeUrl,
  type Weather,
  type WeatherKind,
} from "@/lib/home/weather";
import type { AgencyReading } from "@/lib/home/weather/model";
import { ConditionGlyph, type Condition } from "./Glyphs";

/* ------------------------------------------------------------------------ */
/* Sky                                                                      */
/* ------------------------------------------------------------------------ */

type DayPart = "dawn" | "day" | "dusk" | "night";

function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/**
 * Two stops per part of the day, greyed under cloud and rain. Every stop is
 * dark enough for white text at 4.5:1 or better.
 */
function sky(part: DayPart, kind: WeatherKind | null): string {
  const overcast = kind !== null && kind !== "clear" && kind !== "partly";
  if (part === "night") return "linear-gradient(180deg, #0b1630 0%, #1d2d55 60%, #2b3c69 100%)";
  if (part === "dawn")
    return overcast
      ? "linear-gradient(180deg, #34476b 0%, #5b6684 100%)"
      : "linear-gradient(180deg, #27457f 0%, #5a5f93 62%, #8a5f78 100%)";
  if (part === "dusk")
    return overcast
      ? "linear-gradient(180deg, #2f3c5c 0%, #5a5a73 100%)"
      : "linear-gradient(180deg, #23336a 0%, #5a4677 60%, #8e4f62 100%)";
  return overcast
    ? "linear-gradient(180deg, #3f5774 0%, #5a7088 100%)"
    : "linear-gradient(180deg, #1667c4 0%, #2f7fd3 55%, #3a86cf 100%)";
}

/* ------------------------------------------------------------------------ */
/* Local weather                                                            */
/* ------------------------------------------------------------------------ */

type WeatherState = { status: "loading" } | { status: "ready"; place: string; weather: Weather | null };

function locate(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 }
    );
  });
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function useLocalWeather(): WeatherState {
  const [state, setState] = useState<WeatherState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    getJson(forecastUrl(FALLBACK_PLACE.latitude, FALLBACK_PLACE.longitude))
      .then(parseForecast)
      .catch(() => null)
      .then((weather) => {
        if (live) setState((s) => (s.status === "loading" ? { status: "ready", place: FALLBACK_PLACE.name, weather } : s));
      });
    (async () => {
      const here = await locate();
      if (!here || !live) return;
      const [weather, place] = await Promise.all([
        getJson(forecastUrl(here.latitude, here.longitude)).then(parseForecast).catch(() => null),
        getJson(placeUrl(here.latitude, here.longitude)).then(parsePlace).catch(() => null),
      ]);
      if (live && weather) setState({ status: "ready", place: place ?? "Your location", weather });
    })();
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function degrees(v: number | null | undefined): string {
  return v === null || v === undefined ? NO_VALUE : `${Math.round(v)}°`;
}

/** Open-Meteo's kind, as the glyph set draws it. */
function glyphOf(kind: WeatherKind | null, isDay: boolean): Condition {
  if (kind === "clear") return isDay ? "sun" : "cloud";
  if (kind === "partly") return isDay ? "partly" : "cloud";
  if (kind === "rain" || kind === "drizzle" || kind === "storm") return "rain";
  return "cloud";
}

function OutsideWeather({ state }: { state: WeatherState }) {
  if (state.status === "loading") {
    return (
      <div aria-busy="true">
        <Skeleton className="h-[58px] w-[180px] rounded-2xl opacity-40" />
      </div>
    );
  }
  const { place, weather } = state;
  const described = describeCode(weather?.code ?? null);
  return (
    <section
      aria-label={`Weather in ${place}`}
      className="flex items-center gap-3 rounded-2xl bg-white/[0.14] px-3.5 py-2.5 backdrop-blur-sm"
    >
      <ConditionGlyph
        condition={glyphOf(described?.kind ?? null, weather?.isDay ?? true)}
        size={30}
        sunFill="#FFD60A"
      />
      <div className="flex min-w-0 flex-col leading-[1.25]">
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold">
          <span className="truncate">{place}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="flex-none">
            <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" />
          </svg>
          <span className="ml-1 text-[20px] font-light tabular">{degrees(weather?.temperature)}</span>
        </span>
        <span className="text-[12px] font-medium text-white/85">
          {described?.label ?? NO_VALUE} · H:{degrees(weather?.high)} L:{degrees(weather?.low)}
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Hero                                                                     */
/* ------------------------------------------------------------------------ */

/** Lets the shared (i) read white on the sky: its colours are tokens. */
const ON_SKY = { "--text-muted": "rgba(255,255,255,0.78)", "--text-strong": "#ffffff" } as CSSProperties;

function pace(p: number): string {
  return formatPercent(p / 100, { decimals: 0 });
}

function condition(r: AgencyReading): string {
  if (r.share === null) return "No plan this month";
  if (r.onPlan === r.withPlan) return r.withPlan === 1 ? "On plan" : "All on plan";
  if (r.onPlan === 0) return r.withPlan === 1 ? "Not on plan" : "None on plan";
  return `${r.onPlan} of ${r.withPlan} on plan`;
}

export function ForecastHero({
  name,
  now,
  monthLabel,
  reading,
  children,
}: {
  name: string | null;
  /** Server time, ISO. The first paint uses Prague time; the browser's own clock then takes over. */
  now: string;
  monthLabel: string | null;
  reading: AgencyReading;
  /** The daily strip, on glass at the bottom of the sky. */
  children?: ReactNode;
}) {
  const [moment, setMoment] = useState(() => {
    const d = new Date(now);
    const hour = hourIn(d, HOME_TIME_ZONE);
    return { hour, part: partOfDay(hour), date: longDate(d, HOME_TIME_ZONE) };
  });
  useEffect(() => {
    const local = new Date();
    setMoment({ hour: local.getHours(), part: partOfDay(local.getHours()), date: longDate(local) });
  }, []);

  const weather = useLocalWeather();
  const kind = weather.status === "ready" ? describeCode(weather.weather?.code ?? null)?.kind ?? null : null;
  const background = sky(dayPart(moment.hour), kind);

  const share = reading.share;
  const tip = [
    `Clients with a Goals plan this month whose ring metric (CM3 when targeted, else revenue) is on track or ahead. H and L: best and worst pace against the plan to date.`,
    reading.withoutPlan.length ? `No plan: ${reading.withoutPlan.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      aria-label="Today"
      className="relative rounded-[28px] text-white shadow-md transition-[background] duration-slow"
      style={{ background, textShadow: "0 1px 2px rgba(0,0,0,0.16)", ...ON_SKY }}
    >
      <div className="flex flex-col gap-6 px-5 pb-5 pt-5 sm:px-8 sm:pt-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-white/80">{moment.date}</span>
            <h2 className="m-0 text-[28px] font-bold leading-[1.1] tracking-heading sm:text-[34px]">
              {name ? `${moment.part}, ${name}` : moment.part}
            </h2>
          </div>
          <OutsideWeather state={weather} />
        </div>

        <div className="flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold sm:text-[17px]">
            Clients on plan{monthLabel ? ` · ${monthLabel}` : ""}
            <InfoTip text={tip} label="About clients on plan" />
          </span>
          <span
            className="mt-1 tabular leading-[0.95] tracking-display"
            style={{ fontSize: "clamp(84px, 18vw, 128px)", fontWeight: 200 }}
          >
            {share === null ? (
              NO_VALUE
            ) : (
              <>
                {Math.round(share * 100)}
                <span style={{ fontSize: "0.42em", fontWeight: 300 }} className="align-[0.95em]">
                  %
                </span>
              </>
            )}
          </span>
          <span className="mt-2 text-[17px] font-semibold sm:text-[19px]">{condition(reading)}</span>
          <span className="mt-0.5 text-[15px] font-semibold tabular text-white/90 sm:text-[17px]">
            {reading.high ? `H: ${reading.high.name} ${pace(reading.high.pacePct)}` : `H: ${NO_VALUE}`}
            <span className="mx-2 text-white/50">·</span>
            {reading.low ? `L: ${reading.low.name} ${pace(reading.low.pacePct)}` : `L: ${NO_VALUE}`}
          </span>
        </div>
      </div>

      {children && <div className="px-2.5 pb-2.5 sm:px-4 sm:pb-4">{children}</div>}
    </section>
  );
}
