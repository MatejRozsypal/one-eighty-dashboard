"use client";

/**
 * The weather as one chip beside the greeting: a swatch of the sky, the
 * temperature, the condition and the place.
 *
 * Same sources and privacy as `components/home/WeatherCard.tsx`: Prague first,
 * the reader's own location if the browser grants it, read in the browser from
 * Open-Meteo and BigDataCloud only. A failed forecast reads n/a.
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
} from "@/lib/home/weather";

type State = { status: "loading" } | { status: "ready"; place: string; weather: Weather | null };

function degrees(v: number | null | undefined): string {
  return v === null || v === undefined ? NO_VALUE : `${Math.round(v)}°`;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

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

export function WeatherChip() {
  const [state, setState] = useState<State>({ status: "loading" });

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

  if (state.status === "loading") {
    return <span aria-busy="true" className="inline-block h-9 w-[168px] animate-pulse rounded-pill bg-[var(--gray-100)]" />;
  }

  const { place, weather } = state;
  const described = describeCode(weather?.code ?? null);
  const label = described?.label ?? NO_VALUE;

  return (
    <span
      className="inline-flex h-9 max-w-full items-center gap-2 rounded-pill border border-hairline bg-surface-card pl-1.5 pr-3.5 text-[13px] shadow-xs"
      aria-label={`Weather in ${place}: ${degrees(weather?.temperature)}, ${label}`}
    >
      <span
        aria-hidden="true"
        className="h-6 w-6 flex-none rounded-full"
        style={{ background: skyGradient(described?.kind ?? null, weather?.isDay ?? true) }}
      />
      <span className="font-semibold tabular text-content-strong">{degrees(weather?.temperature)}</span>
      <span className="truncate text-content-muted">
        {label} · {place}
      </span>
      <span className="hidden tabular text-content-muted sm:inline">
        H {degrees(weather?.high)} L {degrees(weather?.low)}
      </span>
    </span>
  );
}
