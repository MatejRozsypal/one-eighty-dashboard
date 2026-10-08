/**
 * Home, Today variant: the data model. Pure types, safe in client components.
 *
 * The page is a list of things that need a founder today. Every item comes
 * from one explicit rule over one named source (`RULES`), carries the figure
 * that triggered it exactly as the source gave it, and links to the page that
 * resolves it. A source that could not be read produces no items and shows up
 * in `sources` as n/a with the reason, so an empty list never hides a failure.
 */

import type { HealthTone } from "@/lib/plan/health";
import type { PacingRow } from "@/lib/plan/types";

/** 0 overdue or critical, 1 today, 2 this week. */
export type Urgency = 0 | 1 | 2;

export type RuleKey =
  | "plan"
  | "cm3_negative"
  | "packs"
  | "briefs"
  | "unmapped"
  | "sync"
  | "feeds"
  | "tasks";

export interface ItemDetail {
  label: string;
  value?: string;
  href?: string;
  external?: boolean;
}

export interface TodayItem {
  /** Stable within a day: rule, client and subject. The done state is keyed on it. */
  id: string;
  rule: RuleKey;
  clientId: string | null;
  /** Client name, or null for agency-wide items (founder tasks, warehouse alerts). */
  clientName: string | null;
  /** What is wrong, in a few words. */
  title: string;
  /** The number, formatted in the source's own unit. */
  figure: string;
  tone: HealthTone;
  /** One short line of supporting figures. */
  context: string | null;
  /** The verb on the button. */
  action: string;
  href: string;
  external: boolean;
  /** Money at stake converted to CZK for ordering only. Null when the rule has no money figure or FX is missing. */
  stakeCzk: number | null;
  urgency: Urgency;
  /** The rule and its source, for the (i). */
  tip: string;
  details: ItemDetail[];
  /** Founder tasks: who it is on. */
  assignees?: string[];
}

export type SourceStatus = "ok" | "na";

/** One source the list was built from, and whether it could be read. */
export interface SourceCheck {
  key: RuleKey;
  label: string;
  status: SourceStatus;
  /** Items this source produced. */
  items: number;
  /** Why it is n/a, or what it reads when ok. */
  note: string;
}

/** One row of the client table under the list. */
export interface ClientLine {
  key: string;
  clientId: string | null;
  name: string;
  status: string | null;
  currency: string | null;
  /** The ring row: CM3 when the plan targets it, else revenue, else null. */
  focus: PacingRow | null;
  revenueMtd: number | null;
  revenueNote: string | null;
  cm3Mtd: number | null;
  cm3Note: string | null;
  /** The month's CM3 pacing row when the plan targets CM3. */
  cm3Row: PacingRow | null;
  asOf: string | null;
}

export interface TodayData {
  items: TodayItem[];
  sources: SourceCheck[];
  clients: ClientLine[];
  /** Why the client table is empty, when it is. */
  clientsNote: string | null;
  /** Prague date the list was built for, `YYYY-MM-DD`; the done state is keyed on it. */
  day: string;
}
