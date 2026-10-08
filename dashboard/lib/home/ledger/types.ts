/**
 * Home, variant "ledger": the partnership seen from both sides.
 *
 * Pure types, safe in client components. Every figure is a `Figure` from the
 * Home model: a value from a named source, or null with the note that says
 * which source is missing. Money between us and a client is in CZK, because
 * the retainer and the profit share are invoiced in CZK; a client's own CM3 is
 * converted at the month's rate in `ref.fx_rates` before it is set against
 * them.
 */

import type { Figure, SourceState } from "@/lib/home/types";
import type { PacingRow } from "@/lib/plan/types";

export type { Figure, SourceState };

/** Where a fee for the settled month comes from. */
export type FeeSource =
  /** The ClickUp Invoice Tracker holds an invoice for that month. */
  | "invoiced"
  /** No invoice: the retainer agreed today (ref.contracts, else ClickUp Retainer CZK). */
  | "agreed"
  /** ops.profit_share_statements or mart_profit_share_monthly for that month. */
  | "statement"
  /** The billing type carries no profit share (Monthly Retainer). */
  | "none_by_terms";

export interface Fee extends Figure {
  source: FeeSource | null;
}

/** The last complete month, set out as a split of the client's CM3. */
export interface SettledMonth {
  /** "2026-09-01". Null when there is no complete month to read. */
  month: string | null;
  /** "September". */
  label: string | null;
  /** The client's CM3 that month, in CZK. */
  cm3Czk: Figure;
  retainer: Fee;
  profitShare: Fee;
  /** Retainer plus profit share, when both are known. */
  fees: Figure;
  /** CM3 minus the retainer: what is left before any profit share. */
  afterRetainer: Figure;
  /** CM3 minus both fees. */
  keeps: Figure;
  /** Kept per 1 CZK paid to us: keeps / fees. */
  perKoruna: Figure;
  /**
   * When only the profit share is unknown: (CM3 - retainer) / retainer. Any
   * profit share lowers the ratio, so this is its upper bound. Null otherwise.
   */
  perKorunaCeiling: number | null;
}

export interface TrendMonth {
  /** "2026-09-01". */
  month: string;
  /** "Sep". */
  label: string;
  /** Client CM3 that month in CZK, or null with the note. */
  cm3Czk: number | null;
  note: string | null;
  /** Invoice amount plus profit share invoiced for that month (ClickUp), CZK. */
  invoicedCzk: number | null;
  /** The invoice period as the tracker names it ("04/26"). */
  invoicePeriod: string | null;
}

export interface Partnership {
  key: string;
  clientId: string | null;
  name: string;
  /** Trading currency; null for a client the warehouse does not hold. */
  currency: string | null;
  billingType: string | null;
  crmStatus: string | null;
  crmUrl: string | null;

  /** Month to date from the Goals actuals, in the client's own currency. */
  thisMonth: {
    label: string | null;
    asOf: string | null;
    revenue: Figure;
    cm3: Figure;
    /** The Goals pacing row of the ring metric, when the month has a plan. */
    focus: PacingRow | null;
  };

  agreedRetainer: Fee;
  settled: SettledMonth;
  trend: TrendMonth[];
  /** Why there is no trend at all. Null when `trend` is filled. */
  trendNote: string | null;
  /** CM3 over the frozen baseline since the contract began (mart_profit_share_monthly). */
  generated: Figure & { months: number };
}

export interface SetupItem {
  id: string;
  title: string;
  done: boolean;
  /** "0 of 5". Null when the item is not counted per client. */
  progress: string | null;
  /** Where the input is entered. */
  where: string;
  href: string | null;
  /** The figures on this page the item turns from n/a into numbers. */
  unlocks: string;
  /** The (i): what exactly is missing. At most a couple of sentences. */
  tip: string;
  /** Clients still missing the input. */
  clients: string[];
}

export interface LedgerHero {
  /** "October 2026". */
  monthLabel: string;
  retainers: Figure & { clients: number };
  profitShareLast: Figure & { period: string | null; clients: number };
  generated: Figure & { clients: number };
  /** The setup items that stand between today and a value-generated figure. */
  generatedSetup: SetupItem[];
}

export interface LedgerData {
  hero: LedgerHero;
  /** "September". The month every card's split is read for. */
  settledLabel: string | null;
  partnerships: Partnership[];
  setup: SetupItem[];
}
