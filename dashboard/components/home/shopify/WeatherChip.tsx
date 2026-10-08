"use client";

/**
 * The weather as one small pill in the corner: place, temperature, condition,
 * on the same sky as the Home weather card. Prague first, the reader's own
 * place once the browser shares it; the location goes only to Open-Meteo and
 * BigDataCloud, never to our server. A failed forecast reads n/a.
 */

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
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
  const [state, setState] = useState<{ place: string; weather: Weather | null } | null>(null);

  useEffect(() => {
    let live = true;
    getJson(forecastUrl(FALLBACK_PLACE.latitude, FALLBACK_PLACE.longitude))
      .then(parseForecast)
      .catch(() => null)
      .then((weather) => {
        if (live) setState((s) => s ?? { place: FALLBACK_PLACE.name, weather });
      });
    (async () => {
      const here = await locate();
      if (!here || !live) return;
      const [weather, place] = await Promise.all([
        getJson(forecastUrl(here.latitude, here.longitude)).then(parseForecast).catch(() => null),
        getJson(placeUrl(here.latitude, here.longitude)).then(parsePlace).catch(() => null),
      ]);
      if (live && weather) setState({ place: place ?? "Your location", weather });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!state) {
    return (
      <span aria-busy="true" className="inline-flex">
        <Skeleton className="h-8 w-[150px] rounded-full" />
      </span>
    );
  }

  const described = describeCode(state.weather?.code ?? null);
  const t = state.weather?.temperature ?? null;
  return (
    <span
      aria-label={`Weather in ${state.place}`}
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-white shadow-xs"
      style={{ background: skyGradient(described?.kind ?? null, state.weather?.isDay ?? true) }}
    >
      <span className="truncate">{state.place}</span>
      <span className="tabular">{t === null ? NO_VALUE : `${Math.round(t)}°`}</span>
      {described && <span className="hidden truncate font-medium opacity-90 sm:inline">{described.label}</span>}
    </span>
  );
}
