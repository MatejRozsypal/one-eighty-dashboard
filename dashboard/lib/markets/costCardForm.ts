/**
 * Market cost card form: the fields and their validation, shared by the
 * Settings form (live messages) and the server action (the check that holds).
 *
 * Pure, client-safe. Empty is allowed everywhere and means "not stated": the
 * Markets page then shows the lines that need it as n/a. A card with every
 * cost empty is refused, because it would only add a row that states nothing.
 */

import type { CostCard } from "@/lib/markets/types";

export type CostField = "shipCostPerOrder" | "payFeePct" | "codFee" | "returnCost" | "fixedMonthly";

export const COST_FIELDS: Array<{ key: CostField; label: (ccy: string) => string; hint: string; pct?: boolean }> = [
  {
    key: "shipCostPerOrder",
    label: (ccy) => `Shipping and fulfilment / order (${ccy})`,
    hint: "Carrier, packaging and pick-and-pack per order, ex VAT. Shipping charged to customers is offset on the page.",
  },
  {
    key: "payFeePct",
    label: () => "Payment fee % of net revenue",
    hint: "Blended card, wallet and gateway fees as a percentage of net revenue incl. shipping charged.",
    pct: true,
  },
  {
    key: "codFee",
    label: (ccy) => `COD fee / COD order (${ccy})`,
    hint: "Extra cost per cash-on-delivery order. Needed once the market has COD orders.",
  },
  {
    key: "returnCost",
    label: (ccy) => `Return handling / refunded order (${ccy})`,
    hint: "Return label, restocking and handling per refunded order. Needed once the market has refunded orders.",
  },
  {
    key: "fixedMonthly",
    label: (ccy) => `Fixed cost / month (${ccy})`,
    hint: "Optional: a cost of running this market regardless of orders (local warehouse, support). Comes off in CM3.",
  },
];

export interface CostCardInput {
  effectiveFrom: string;
  values: Record<CostField, string>;
}

export interface CostCardCheck {
  /** One message per invalid field; `effectiveFrom` and `card` for the date and the whole card. */
  errors: Partial<Record<CostField | "effectiveFrom" | "card", string>>;
  /** The card to store, when there are no errors. Percentages are stored as shares. */
  card: Omit<CostCard, "market" | "updatedAt" | "updatedBy"> | null;
}

/** "2,9" and "2.9" both read as 2.9; empty is null; anything else is NaN. */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function checkCostCard(input: CostCardInput): CostCardCheck {
  const errors: CostCardCheck["errors"] = {};
  const parsed = {} as Record<CostField, number | null>;
  for (const f of COST_FIELDS) {
    const n = parseAmount(input.values[f.key] ?? "");
    parsed[f.key] = n;
    if (n === null) continue;
    if (Number.isNaN(n)) errors[f.key] = "Enter a number";
    else if (n < 0) errors[f.key] = "Cannot be negative";
    else if (f.pct && n > 100) errors[f.key] = "A percentage, 0 to 100";
  }
  const d = input.effectiveFrom.trim();
  if (!ISO_DAY.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    errors.effectiveFrom = "Pick a date";
  }
  if (COST_FIELDS.every((f) => parsed[f.key] === null)) errors.card = "Fill at least one cost";
  if (Object.keys(errors).length > 0) return { errors, card: null };
  return {
    errors,
    card: {
      effectiveFrom: d,
      shipCostPerOrder: parsed.shipCostPerOrder,
      payFeePct: parsed.payFeePct === null ? null : parsed.payFeePct / 100,
      codFee: parsed.codFee,
      returnCost: parsed.returnCost,
      fixedMonthly: parsed.fixedMonthly,
    },
  };
}

/** A stored card as form strings (percent shown as a percentage). */
export function cardToValues(card: CostCard | null): Record<CostField, string> {
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    shipCostPerOrder: s(card?.shipCostPerOrder),
    payFeePct: card?.payFeePct === null || card?.payFeePct === undefined ? "" : String(+(card.payFeePct * 100).toFixed(4)),
    codFee: s(card?.codFee),
    returnCost: s(card?.returnCost),
    fixedMonthly: s(card?.fixedMonthly),
  };
}

/** Markets a card may be saved for: ISO-2 or OTHER. */
export function isCardMarket(m: string): boolean {
  return m === "OTHER" || /^[A-Z]{2}$/.test(m);
}

/** A market Settings shows a card for. */
export interface CostCardMarketRow {
  /** ISO-2, or OTHER for every country pooled into Other. */
  market: string;
  isHome: boolean;
}

/** The collapsed section's one line: which markets still need a card. */
export function marketCostSummary(markets: CostCardMarketRow[], cards: CostCard[]): string {
  if (markets.length === 0) return "No markets found";
  const withCard = markets.filter((m) => cards.some((c) => c.market === m.market));
  if (withCard.length === 0) return "No cards: CM2 and CM3 show n/a";
  if (withCard.length === markets.length) return `All ${markets.length} markets have a card`;
  const missing = markets.filter((m) => !withCard.includes(m)).map((m) => (m.market === "OTHER" ? "Other" : m.market));
  return `${withCard.length} of ${markets.length} have a card · missing ${missing.join(", ")}`;
}
