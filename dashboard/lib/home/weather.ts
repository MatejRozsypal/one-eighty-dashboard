/**
 * Weather for the Home header, from Open-Meteo (no key). Pure, safe in client
 * components: the fetch runs in the browser, because the location is the
 * browser's and never reaches our server.
 */

/** Used when the browser will not share a location. */
export const FALLBACK_PLACE = { name: "Prague", latitude: 50.0755, longitude: 14.4378 } as const;

export type WeatherKind = "clear" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** WMO weather interpretation codes, as Open-Meteo documents them. */
const CODES: Record<number, { label: string; kind: WeatherKind }> = {
  0: { label: "Clear", kind: "clear" },
  1: { label: "Mainly clear", kind: "partly" },
  2: { label: "Partly cloudy", kind: "partly" },
  3: { label: "Cloudy", kind: "cloud" },
  45: { label: "Fog", kind: "fog" },
  48: { label: "Rime fog", kind: "fog" },
  51: { label: "Light drizzle", kind: "drizzle" },
  53: { label: "Drizzle", kind: "drizzle" },
  55: { label: "Heavy drizzle", kind: "drizzle" },
  56: { label: "Freezing drizzle", kind: "drizzle" },
  57: { label: "Freezing drizzle", kind: "drizzle" },
  61: { label: "Light rain", kind: "rain" },
  63: { label: "Rain", kind: "rain" },
  65: { label: "Heavy rain", kind: "rain" },
  66: { label: "Freezing rain", kind: "rain" },
  67: { label: "Freezing rain", kind: "rain" },
  71: { label: "Light snow", kind: "snow" },
  73: { label: "Snow", kind: "snow" },
  75: { label: "Heavy snow", kind: "snow" },
  77: { label: "Snow grains", kind: "snow" },
  80: { label: "Rain showers", kind: "rain" },
  81: { label: "Rain showers", kind: "rain" },
  82: { label: "Heavy showers", kind: "rain" },
  85: { label: "Snow showers", kind: "snow" },
  86: { label: "Snow showers", kind: "snow" },
  95: { label: "Thunderstorm", kind: "storm" },
  96: { label: "Thunderstorm, hail", kind: "storm" },
  99: { label: "Thunderstorm, hail", kind: "storm" },
};

export function describeCode(code: number | null): { label: string; kind: WeatherKind } | null {
  return code === null ? null : CODES[code] ?? null;
}

export interface Weather {
  temperature: number | null;
  high: number | null;
  low: number | null;
  code: number | null;
  isDay: boolean;
}

export function forecastUrl(latitude: number, longitude: number): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: "temperature_2m,weather_code,is_day",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

/** BigDataCloud's client-side reverse geocoder: keyless, city level. */
export function placeUrl(latitude: number, longitude: number): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    localityLanguage: "en",
  });
  return `https://api.bigdatacloud.net/data/reverse-geocode-client?${q.toString()}`;
}

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseForecast(json: unknown): Weather {
  const j = (json ?? {}) as {
    current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown };
    daily?: { temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[] };
  };
  return {
    temperature: n(j.current?.temperature_2m),
    code: n(j.current?.weather_code),
    isDay: j.current?.is_day !== 0,
    high: n(j.daily?.temperature_2m_max?.[0]),
    low: n(j.daily?.temperature_2m_min?.[0]),
  };
}

export function parsePlace(json: unknown): string | null {
  const j = (json ?? {}) as { city?: unknown; locality?: unknown; principalSubdivision?: unknown };
  for (const v of [j.city, j.locality, j.principalSubdivision]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** The card's sky: two stops per kind, darker at night. Text on it is white. */
export function skyGradient(kind: WeatherKind | null, isDay: boolean): string {
  if (!isDay) return "linear-gradient(160deg, #0f1c3a 0%, #2a3d66 100%)";
  switch (kind) {
    case "clear":
    case "partly":
      return "linear-gradient(160deg, #1d68c2 0%, #3f8bd6 100%)";
    case "snow":
      return "linear-gradient(160deg, #4f6d92 0%, #7790b0 100%)";
    case "rain":
    case "drizzle":
    case "storm":
      return "linear-gradient(160deg, #3a4d60 0%, #5d7186 100%)";
    default:
      return "linear-gradient(160deg, #4a6584 0%, #6e86a1 100%)";
  }
}
