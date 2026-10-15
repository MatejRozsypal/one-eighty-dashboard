/**
 * Markets, Products for the demo client: rows shaped exactly like
 * lib/queries/marketsProducts.ts returns them.
 *
 * Each market's net sales come from the Markets demo (lib/demo/markets.ts) for
 * the same region and range, so the products of a market add up to the net
 * sales the main Markets page shows for it. That total is split over a fixed
 * catalogue by a per-market mix, wobbled per period so Compare has something
 * to show, and units follow from a per-market price level.
 *
 * The mixes are written to show the one thing the page is for, a market that
 * buys differently from home:
 *
 *   na  CA leans to the supplements (sleep, calm, immunity) and away from the
 *       serum and the starter set, at a lower price level; Other buys the
 *       travel duo and the serum, little that is ingestible.
 *   eu  SK buys the starter set and the mask far more than CZ; PL (a young
 *       test market) is mostly the starter set and the travel duo.
 *
 * Local prices: CA pays CAD and SK pays EUR on almost every order (0.3 % in
 * base), so both show a local price; Other mixes currencies and shows none.
 * Every figure is generated; no row is anyone's data.
 */

import { jitter } from "./random";
import { DEMO_FX_USD_TO_CZK } from "./business";
import { demoMarkets, type DemoRegion } from "./markets";
import { MARKET_OTHER, MARKET_UNALLOCATED } from "@/lib/markets/types";
import type { ProductSalesRow, ProductsRaw } from "@/lib/markets/products";

interface DemoProduct {
  name: string;
  /** List price in USD; CZK is this times the demo rate, rounded to a shelf price. */
  usd: number;
  /** Share of the home market's net sales. */
  weight: number;
}

const CATALOGUE: DemoProduct[] = [
  { name: "Radiance Serum 30ml", usd: 68, weight: 0.17 },
  { name: "Daily Renewal Cream", usd: 54, weight: 0.145 },
  { name: "Calm Balance Capsules", usd: 42, weight: 0.115 },
  { name: "Deep Sleep Tincture", usd: 48, weight: 0.095 },
  { name: "Restore Body Oil", usd: 39, weight: 0.08 },
  { name: "Clarity Cleanser", usd: 32, weight: 0.07 },
  { name: "Immunity Blend Powder", usd: 56, weight: 0.06 },
  { name: "Starter Ritual Set", usd: 129, weight: 0.055 },
  { name: "Overnight Repair Mask", usd: 46, weight: 0.04 },
  { name: "Travel Duo", usd: 74, weight: 0.035 },
  { name: "Vitamin C Drops", usd: 36, weight: 0.03 },
  { name: "Magnesium Night Spray", usd: 29, weight: 0.025 },
  { name: "Hand Cream Mini", usd: 14, weight: 0.02 },
  { name: "Refill Pouch 100ml", usd: 49, weight: 0.018 },
  { name: "Lip Balm Trio", usd: 18, weight: 0.014 },
  { name: "Bamboo Facial Brush", usd: 22, weight: 0.012 },
  { name: "Sample Discovery Kit", usd: 12, weight: 0.01 },
  { name: "Gift Card", usd: 50, weight: 0.006 },
];

interface MarketMix {
  /** Multiplier on a product's home weight; 1 when not listed. */
  tilt: Record<string, number>;
  /** Price level against home, in base currency. */
  priceLevel: number;
}

const MIX: Record<DemoRegion, Record<string, MarketMix>> = {
  na: {
    US: { tilt: {}, priceLevel: 1 },
    CA: {
      tilt: {
        "Calm Balance Capsules": 1.55,
        "Deep Sleep Tincture": 1.6,
        "Immunity Blend Powder": 1.7,
        "Vitamin C Drops": 1.4,
        "Radiance Serum 30ml": 0.62,
        "Starter Ritual Set": 0.5,
        "Daily Renewal Cream": 0.85,
      },
      priceLevel: 0.86,
    },
    [MARKET_OTHER]: {
      tilt: {
        "Travel Duo": 2.6,
        "Radiance Serum 30ml": 1.3,
        "Calm Balance Capsules": 0.4,
        "Deep Sleep Tincture": 0.35,
        "Immunity Blend Powder": 0.3,
        "Vitamin C Drops": 0.4,
        "Magnesium Night Spray": 0.3,
      },
      priceLevel: 1.08,
    },
  },
  eu: {
    CZ: { tilt: {}, priceLevel: 1 },
    SK: {
      tilt: {
        "Starter Ritual Set": 1.9,
        "Overnight Repair Mask": 1.6,
        "Travel Duo": 1.3,
        "Deep Sleep Tincture": 0.6,
        "Radiance Serum 30ml": 0.82,
      },
      priceLevel: 0.95,
    },
    PL: {
      tilt: {
        "Starter Ritual Set": 3.2,
        "Travel Duo": 2.2,
        "Sample Discovery Kit": 2.5,
        "Daily Renewal Cream": 0.6,
        "Restore Body Oil": 0.5,
        "Immunity Blend Powder": 0.3,
      },
      priceLevel: 0.9,
    },
    [MARKET_OTHER]: {
      tilt: { "Radiance Serum 30ml": 1.4, "Travel Duo": 1.8, "Immunity Blend Powder": 0.4 },
      priceLevel: 1.05,
    },
  },
};

/** Share of a local-currency market's orders paid in base currency instead (as in the real marts). */
const BASE_PAID_SHARE = 0.003;

function shelfPrice(p: DemoProduct, region: DemoRegion): number {
  if (region === "na") return p.usd;
  // CZK shelf prices end in 9: 68 USD becomes 1,599 CZK.
  return Math.round((p.usd * DEMO_FX_USD_TO_CZK) / 100) * 100 - 1;
}

function rowsFor(region: DemoRegion, range: { from: string; to: string }): ProductSalesRow[] {
  const raw = demoMarkets(region, range, null);
  const out: ProductSalesRow[] = [];
  for (const m of raw.current) {
    if (m.market === MARKET_UNALLOCATED || m.sums.netSales <= 0) continue;
    const mix = MIX[region][m.market] ?? { tilt: {}, priceLevel: 1 };
    const local = m.market !== MARKET_OTHER && raw.localCurrencyOf[m.market] && m.extras?.localRevenue && m.sums.netRevenue > 0;
    const fx = local ? m.extras!.localRevenue! / m.sums.netRevenue : 1;
    const key = `mkp:${region}:${m.market}:${range.from}:${range.to}`;

    const weights = CATALOGUE.map((p) => p.weight * (mix.tilt[p.name] ?? 1) * jitter(`${key}:${p.name}:w`, 0.14));
    const sum = weights.reduce((t, w) => t + w, 0);
    CATALOGUE.forEach((p, i) => {
      const netSales = (m.sums.netSales * weights[i]) / sum;
      const price = shelfPrice(p, region) * mix.priceLevel * jitter(`${key}:${p.name}:p`, 0.04);
      const units = Math.max(1, Math.round(netSales / price));
      const covered = local ? netSales * (1 - BASE_PAID_SHARE) : 0;
      out.push({
        market: m.market,
        product: p.name,
        netSales,
        units,
        localNetSales: covered * fx,
        localUnits: local ? Math.round(units * (1 - BASE_PAID_SHARE)) : 0,
        localCoveredNetSales: covered,
      });
    });
  }
  return out;
}

export function demoMarketsProducts(
  region: DemoRegion,
  range: { from: string; to: string },
  compareRange: { from: string; to: string } | null
): ProductsRaw {
  const raw = demoMarkets(region, range, null);
  return {
    source: "demo",
    baseCurrency: raw.baseCurrency,
    homeMarket: raw.homeMarket ?? "",
    localCurrencyOf: raw.localCurrencyOf,
    range,
    compareRange,
    current: rowsFor(region, range),
    previous: compareRange ? rowsFor(region, compareRange) : null,
  };
}
