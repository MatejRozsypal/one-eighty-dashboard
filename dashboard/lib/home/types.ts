/**
 * Home page data model. Pure types, safe in client components.
 *
 * One card per client answers six questions: status, results against goals,
 * what the client keeps after paying us, what we generated over the contract
 * baseline, what we were paid, and the profit share. Every figure arrives
 * finished from a named source; a figure the sources cannot give is null and
 * travels with the reason (`Gap`), so the card can say n/a and why.
 */

import type { PacingRow } from "@/lib/plan/types";

/**
 * Why a source could not answer. `missing` means the object or the row does
 * not exist, `denied` that the dashboard may not read it, `error` anything
 * else (logged server side). `not_configured` is ClickUp without a token.
 */
export type SourceState = "ok" | "missing" | "empty" | "denied" | "error" | "not_configured";

/** A figure that may be absent, with the tooltip that says why. */
export interface Figure {
  value: number | null;
  /** Shown in the (i) next to the value. Always set when `value` is null. */
  note: string | null;
}

/** One plan metric for the current month. */
export interface MonthMetric {
  /** Actual to date: the pacing row's when there is one, else summed from the daily actuals. */
  actual: number | null;
  /** The month's pacing row when the plan targets this metric, else null. */
  row: PacingRow | null;
}

export interface InvoiceLine {
  /** The tracker task's period, as named ("04/26"). */
  period: string;
  amountCzk: number | null;
  profitShareCzk: number | null;
  status: string | null;
}

export interface ClientHealth {
  /** client_id, or the ClickUp task id for a client the warehouse does not know. */
  key: string;
  clientId: string | null;
  name: string;
  /** Trading currency from the registry. Null for a ClickUp-only client. */
  currency: string | null;
  /** `ref.clients.status` (active, onboarding, paused). */
  registryStatus: string | null;
  /** The task status in ClickUp Client Success > Clients (steady, onboarding, churned). */
  crmStatus: string | null;
  crmUrl: string | null;
  /** Why the ClickUp fields are missing (token refused, list unreadable, no matching task). Null when matched. */
  crmNote?: string | null;
  /** Last day of data in the plan actuals. */
  asOf: string | null;
  /** Month label of the pacing rows ("October 2026"). */
  monthLabel: string | null;

  /** The ring: CM3 when the month has a CM3 target, else revenue, else null (no plan). */
  focus: PacingRow | null;
  revenue: MonthMetric;
  cm3: MonthMetric;
  amer: MonthMetric;
  /** Month to date against the same days a year earlier: a fraction (0.12 = +12%). */
  revenueVsLastYear: Figure;
  /** CM3 month to date minus CM3 over the same days a year earlier, in the client's currency. */
  cm3VsLastYear: Figure;

  /** CM3 of the last complete month after our retainer and profit share, in CZK. */
  keptAfterFees: Figure & { month: string | null };
  /** Sum of CM3 over the frozen baseline, complete months since the contract started. */
  generated: Figure & { months: number };
  /** Money received from the client. No payments source exists yet. */
  received: Figure;
  /** Monthly retainer: the contract's, else ClickUp's Retainer CZK. */
  retainer: Figure & { source: "contract" | "clickup" | null };
  /** Profit share of the latest statement or complete month, in CZK. */
  profitShare: Figure & { month: string | null; pct: number | null };
  billingType: string | null;
  lastInvoice: InvoiceLine | null;
  /** Why there is no last invoice. Null when there is one. */
  lastInvoiceNote: string | null;
}

export interface HomeSummary {
  clients: number;
  /** Clients whose ring row is on track or ahead, of those with a plan this month. */
  onPlan: number;
  withPlan: number;
  /** Sum of monthly retainers, CZK. Null when no client has one. */
  retainersCzk: number | null;
  retainersNote: string | null;
}

export interface HomeData {
  clients: ClientHealth[];
  summary: HomeSummary;
}
