/**
 * Sidekick home: the data model. Pure types, safe in client components.
 *
 * Three layers, each built only from warehouse or ClickUp figures:
 *   1. the KPI strip, cross-client totals for the last 30 days in CZK,
 *   2. action chips, counts of things a person can resolve on another page,
 *   3. recommendation cards, one explicit rule each, ordered by money at stake.
 * A figure a source cannot give is null and carries the reason (`note`), so
 * the page can say n/a and name what is missing.
 */

import type { ClientHealth, HomeSummary } from "@/lib/home/types";

export type KpiKey = "revenue" | "meta_spend" | "cm3" | "amer" | "new_ads";

export interface Kpi {
  key: KpiKey;
  label: string;
  /** "money" values are CZK; "ratio" is a multiple; "count" a whole number. */
  kind: "money" | "ratio" | "count";
  /** Last 30 days, all contributing clients. Null with `note` when nothing can be summed. */
  value: number | null;
  /** The 30 days before. Null when any contributing client lacks them. */
  previous: number | null;
  /** One point a day, oldest first, over the current 30 days. */
  series: Array<number | null>;
  /** Which way is good, for the delta colour. */
  goodWhen: "up" | "down" | "neutral";
  /** What the figure is and where it comes from, for the (i). */
  tip: string;
  /** Why the value is n/a, or which clients are left out of it. */
  note: string | null;
  /** Clients summed, of those that could be. */
  clients: { included: number; total: number };
  /** Last day in the window, `YYYY-MM-DD`. */
  through: string | null;
}

export interface ActionChip {
  key: string;
  label: string;
  /** Null renders n/a; the chip then carries `note` as its title. */
  count: number | null;
  href: string;
  note: string | null;
}

export type RecTone = "negative" | "warning" | "info" | "neutral";

export interface Recommendation {
  id: string;
  /** Rule name, shown small above the client ("Behind plan", "Unmapped ads"). */
  rule: string;
  client: string;
  clientId: string;
  /** The one-line fact, every figure from a source. */
  fact: string;
  /** Optional second line of figures. */
  detail: string | null;
  /** The money the rule puts at stake, in the client's currency, for display. */
  stake: { value: number; currency: string; label: string } | null;
  /** The same in CZK, for ordering only. Null sorts after every money card. */
  stakeCzk: number | null;
  href: string;
  action: string;
  tone: RecTone;
}

export interface SidekickHome {
  greetingLine: string;
  kpis: Kpi[];
  kpiThrough: string | null;
  chips: ActionChip[];
  recommendations: Recommendation[];
  clients: ClientHealth[];
  summary: HomeSummary;
}
