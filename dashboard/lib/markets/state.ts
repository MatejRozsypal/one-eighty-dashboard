/**
 * Markets view state carried in the URL: view, map metric, currency mode and
 * the open market. Pure, so the server page and the client view share it.
 */

import { MAP_METRICS, type MapMetric } from "@/lib/markets/model";
import type { CurrencyMode } from "@/lib/markets/display";

export type MarketsViewKey = "sold" | "scout";

export interface MarketsViewState {
  view: MarketsViewKey;
  map: MapMetric;
  ccy: CurrencyMode;
  market: string | null;
}

export function parseMarketsState(sp: Record<string, string | string[] | undefined>): MarketsViewState {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const map = one(sp.map);
  return {
    view: one(sp.view) === "scout" ? "scout" : "sold",
    map: MAP_METRICS.some((m) => m.key === map) ? (map as MapMetric) : "gpa",
    ccy: one(sp.mccy) === "local" ? "local" : "base",
    market: one(sp.market) ?? null,
  };
}

