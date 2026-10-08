"use client";

/**
 * Current weather where the reader is, in the manner of the Apple Weather
 * widget: place, temperature, condition, today's high and low, on a sky that
 * follows the condition and the time of day.
 *
 * Everything runs in the browser. The location comes from the Geolocation API
 * and goes only to Open-Meteo (forecast) and BigDataCloud (place name), both
 * keyless; our server never sees it. Refused or unavailable, the card shows
 * Prague instead. A failed forecast reads n/a, never a made-up figure.
 */

import { useEffect, useState } from "react";
import { NO_VALUE } from "@/lib/format";
import {
  FALLBACK_PLACE,
  describeCode,
  forecastUrl,
  parseForecast,
  parsePlace,
  placeUrl,
  skyGradient,
  type Weather,
  type WeatherKind,
} from "@/lib/home/weather";

type State =
  | { status: "loading" }
  | { status: "ready"; place: string; weather: Weather | null };

function degrees(v: number | null): string {
  return v === null ? NO_VALUE : `${Math.round(v)}°`;
}

function locate(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      // City-level weather does not need GPS precision; a cached fix is fine.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 }
    );
  });
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export function WeatherCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      const here = await locate();
      const point = here ?? FALLBACK_PLACE;
      const [weather, place] = await Promise.all([
        getJson(forecastUrl(point.latitude, point.longitude))
          .then(parseForecast)
          .catch(() => null),
        here
          ? getJson(placeUrl(here.latitude, here.longitude))
              .then(parsePlace)
              .catch(() => null)
          : Promise.resolve(FALLBACK_PLACE.name),
      ]);
      if (live) setState({ status: "ready", place: place ?? "Your location", weather });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div
        aria-busy="true"
        className="h-[148px] w-full animate-pulse rounded-[22px] sm:w-[300px]"
        style={{ background: skyGradient("cloud", true), opacity: 0.35 }}
      />
    );
  }

  const { place, weather } = state;
  const described = describeCode(weather?.code ?? null);
  const isDay = weather?.isDay ?? true;

  return (
    <section
      aria-label={`Weather in ${place}`}
      className="flex w-full flex-col justify-between gap-3 rounded-[22px] p-[18px] text-white shadow-sm sm:w-[300px]"
      style={{ background: skyGradient(described?.kind ?? null, isDay), textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="inline-flex min-w-0 items-center gap-1 text-[15px] font-semibold leading-[1.3]">
            <span className="truncate">{place}</span>
            <LocationArrow />
          </span>
          <span className="text-[44px] font-light leading-[1.05] tabular">{degrees(weather?.temperature ?? null)}</span>
        </div>
        <WeatherIcon kind={described?.kind ?? null} isDay={isDay} />
      </div>
      <div className="flex flex-col text-[13px] font-semibold leading-[1.35]">
        <span>{described?.label ?? NO_VALUE}</span>
        <span className="tabular">
          H:{degrees(weather?.high ?? null)} L:{degrees(weather?.low ?? null)}
        </span>
      </div>
    </section>
  );
}

function LocationArrow() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="flex-none">
      <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" />
    </svg>
  );
}

/** Line icons in the SF Symbols manner, white on the sky. */
function WeatherIcon({ kind, isDay }: { kind: WeatherKind | null; isDay: boolean }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "flex-none",
  };
  const cloud = <path d="M10 24h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 15.2 4.5 4.5 0 0 0 10 24z" />;
  const sun = (
    <>
      <circle cx="16" cy="16" r="5" />
      <path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M7.5 24.5l2.1-2.1M22.4 9.6l2.1-2.1" />
    </>
  );
  const moon = <path d="M21 20.5A9 9 0 0 1 11.5 6a9 9 0 1 0 9.5 14.5z" />;

  if (kind === "clear") return <svg {...common}>{isDay ? sun : moon}</svg>;
  if (kind === "partly")
    return (
      <svg {...common}>
        {isDay ? (
          <path d="M11 5v2M4.5 11.5h2M6.4 6.9l1.4 1.4M15.6 6.9l-1.4 1.4M8 13.5a3.5 3.5 0 0 1 6.6-1.6" />
        ) : (
          <path d="M14.5 12.5A5 5 0 0 1 9 6a5 5 0 1 0 5.5 6.5z" />
        )}
        <path d="M11 26h12a4.5 4.5 0 0 0 .5-8.97A6.3 6.3 0 0 0 11.3 18a4 4 0 0 0-.3 8z" />
      </svg>
    );
  if (kind === "fog")
    return (
      <svg {...common}>
        <path d="M5 12h22M7 17h18M5 22h22" />
      </svg>
    );
  if (kind === "drizzle" || kind === "rain")
    return (
      <svg {...common}>
        <path d="M10 20h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 11.2 4.5 4.5 0 0 0 10 20z" />
        <path d={kind === "rain" ? "M12 23l-1.5 4M17 23l-1.5 4M22 23l-1.5 4" : "M12 24v1.5M17 24v1.5M22 24v1.5"} />
      </svg>
    );
  if (kind === "snow")
    return (
      <svg {...common}>
        <path d="M10 20h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 11.2 4.5 4.5 0 0 0 10 20z" />
        <path d="M12 24.5h.01M17 26.5h.01M22 24.5h.01" strokeWidth={3} />
      </svg>
    );
  if (kind === "storm")
    return (
      <svg {...common}>
        <path d="M10 19h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 10.2 4.5 4.5 0 0 0 10 19z" />
        <path d="M17 20l-3 5h4l-3 5" />
      </svg>
    );
  return <svg {...common}>{cloud}</svg>;
}
