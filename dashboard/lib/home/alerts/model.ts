/**
 * Home "For you": alert keys, dismissals and the order the cards show in. Pure,
 * safe in client components (the For you section re-runs it after every
 * optimistic dismiss).
 *
 * ── Where the cards come from ─────────────────────────────────────────────
 * Daily snapshot   mart.home_alerts, written at 05:10 by
 *                  mart.sp_refresh_home_alerts (infra/bigquery/282): the rules
 *                  plan, ly, amer, cost, unmapped and promo_end, each with
 *                  first_seen / last_seen.
 * Live, always     capacity, window, brief (Velocity). They read inputs saved
 *                  in Postgres, which BigQuery cannot read.
 * Live, fallback   every rule, when the snapshot is missing or older than 36
 *                  hours (lib/home/shopify/rules.ts and promoEndingCards()).
 *
 * ── alert_key ─────────────────────────────────────────────────────────────
 * `<rule>:<client_id>`, plus `:<entity id>` where one client can have several
 * (promo_end:<client>:<promo task id>). Never a date, so a dismissal keeps
 * matching the same alert day after day.
 *
 * ── Dismissals (Postgres home_alert_dismissals, per person) ───────────────
 * A dismissal hides the card only for the person who dismissed it; the (i)
 * on the card still says when a teammate dismissed it. It stays hidden until
 *   (a) its snooze ends (plain dismiss: no end), or
 *   (b) it materially worsens: money at stake more than 25 % above the value
 *       at dismissal, or the severity escalates. It then returns marked
 *       "back: worse since dismissed".
 * An alert that stopped firing and opened again after the dismissal (its
 * first_seen is later than the dismissal day) is a new occurrence and shows.
 * A ClickUp task card stays hidden until its due date or status changes
 * (the dismissal's fingerprint), or the snooze ends.
 */

import type { Recommendation, RecTone } from "@/lib/home/shopify/types";

/** Rules the warehouse computes daily (282). */
export const SNAPSHOT_RULES = ["plan", "ly", "amer", "cost", "unmapped", "promo_end"] as const;
/** Rules only the app can compute: they read Postgres. */
export const APP_RULES = ["capacity", "window", "brief"] as const;

/** Tie order for cards without money at stake (rules.ts order, promo_end after unmapped). */
export const RULE_ORDER = ["plan", "ly", "unmapped", "promo_end", "amer", "capacity", "window", "brief", "cost"] as const;

export const MAX_CARDS = 6;
export const MAX_PER_RULE = 2;
/** Money at stake this far above the dismissed value brings a card back. */
export const WORSE_GROWTH = 0.25;
export const SNOOZE_DAYS = 7;
/** A snapshot older than this is not trusted; the page computes live. */
export const SNAPSHOT_MAX_AGE_HOURS = 36;

const SEVERITY_RANK: Record<RecTone, number> = { neutral: 0, info: 1, warning: 2, negative: 3 };

export function severityRank(tone: string | null | undefined): number {
  return tone && tone in SEVERITY_RANK ? SEVERITY_RANK[tone as RecTone] : -1;
}

export function isSeverity(v: unknown): v is RecTone {
  return typeof v === "string" && v in SEVERITY_RANK;
}

/** A card with its key and history. */
export interface AlertCard extends Recommendation {
  alertKey: string;
  ruleId: string;
  /** First day of the current open run (Europe/Prague), from the snapshot. Null when live. */
  firstSeen: string | null;
  /** Days open including today, from the snapshot. Null when live. */
  daysOpen: number | null;
  source: "snapshot" | "live";
}

export interface Dismissal {
  alertKey: string;
  /** The person the dismissal applies to. */
  userEmail: string;
  dismissedAt: string;
  /** ISO timestamp; null for a plain dismiss. */
  snoozeUntil: string | null;
  /** Money at stake in the alert's own currency when dismissed. */
  valueAtDismiss: number | null;
  severityAtDismiss: RecTone | null;
  /** Task cards: due date and status when dismissed. Null for client alerts. */
  fingerprint: string | null;
}

export type DismissState = "none" | "hidden" | "back";

/** `plan-ethia` -> `plan`. */
export function ruleOfId(id: string): string {
  const i = id.indexOf("-");
  return i < 0 ? id : id.slice(0, i);
}

export function alertKey(rule: string, clientId: string, entityId?: string | null): string {
  return entityId ? `${rule}:${clientId}:${entityId}` : `${rule}:${clientId}`;
}

/** What a server action accepts as a key: rule, client, optional entity. */
export const ALERT_KEY_PATTERN = /^[a-z_]{2,20}:[A-Za-z0-9_.-]{1,80}(:[A-Za-z0-9_.-]{1,80})?$/;
export const FINGERPRINT_PATTERN = /^[0-9]{0,16}\|.{1,120}$/;

/** A live card from rules.ts, keyed. */
export function liveCard(r: Recommendation): AlertCard {
  const ruleId = ruleOfId(r.id);
  return { ...r, ruleId, alertKey: alertKey(ruleId, r.clientId), firstSeen: null, daysOpen: null, source: "live" };
}

/** YYYY-MM-DD of an instant in Europe/Prague. */
export function pragueDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );
}

export function isWorse(card: AlertCard, d: Dismissal): boolean {
  const now = card.stake?.value ?? null;
  if (d.valueAtDismiss !== null && d.valueAtDismiss > 0 && now !== null && now > d.valueAtDismiss * (1 + WORSE_GROWTH)) return true;
  if (d.severityAtDismiss !== null && severityRank(card.tone) > severityRank(d.severityAtDismiss)) return true;
  return false;
}

export function dismissState(card: AlertCard, d: Dismissal | undefined, nowIso: string): DismissState {
  if (!d) return "none";
  // Opened again after the dismissal: a new occurrence.
  if (card.firstSeen && card.firstSeen > pragueDate(d.dismissedAt)) return "none";
  if (d.snoozeUntil && nowIso >= d.snoozeUntil) return "none";
  return isWorse(card, d) ? "back" : "hidden";
}

function ruleRank(ruleId: string): number {
  const i = RULE_ORDER.indexOf(ruleId as (typeof RULE_ORDER)[number]);
  return i < 0 ? RULE_ORDER.length : i;
}

/** Money at stake in CZK first, then rule order, then client; at most two per rule and six in all. */
export function rankCards<T extends AlertCard>(cards: T[]): T[] {
  const sorted = [...cards].sort((a, b) => {
    if (a.stakeCzk !== null && b.stakeCzk !== null) return b.stakeCzk - a.stakeCzk;
    if (a.stakeCzk !== null) return -1;
    if (b.stakeCzk !== null) return 1;
    return ruleRank(a.ruleId) - ruleRank(b.ruleId) || a.client.localeCompare(b.client);
  });
  const perRule = new Map<string, number>();
  const out: T[] = [];
  for (const c of sorted) {
    const n = perRule.get(c.rule) ?? 0;
    if (n >= MAX_PER_RULE) continue;
    perRule.set(c.rule, n + 1);
    out.push(c);
    if (out.length === MAX_CARDS) break;
  }
  return out;
}

export interface ArrangedCard extends AlertCard {
  back: boolean;
  /** Teammates' dismissals of the same card, newest first, for the (i). */
  others: Dismissal[];
}

export interface Arranged {
  cards: ArrangedCard[];
  /** Firing alerts hidden by the person's own dismissal. */
  dismissed: Array<{ card: AlertCard; dismissal: Dismissal }>;
}

/** Splits every dismissal row into the person's own (by key) and everyone else's. */
export function splitDismissals(rows: Dismissal[], me: string): { mine: Map<string, Dismissal>; others: Map<string, Dismissal[]> } {
  const mine = new Map<string, Dismissal>();
  const others = new Map<string, Dismissal[]>();
  const self = me.toLowerCase();
  for (const d of rows) {
    if (d.userEmail.toLowerCase() === self) mine.set(d.alertKey, d);
    else others.set(d.alertKey, [...(others.get(d.alertKey) ?? []), d]);
  }
  for (const list of others.values()) list.sort((a, b) => b.dismissedAt.localeCompare(a.dismissedAt));
  return { mine, others };
}

export function arrange(
  cards: AlertCard[],
  mine: Map<string, Dismissal>,
  others: Map<string, Dismissal[]>,
  nowIso: string
): Arranged {
  const visible: ArrangedCard[] = [];
  const dismissed: Arranged["dismissed"] = [];
  for (const c of cards) {
    const d = mine.get(c.alertKey);
    const state = dismissState(c, d, nowIso);
    if (state === "hidden") dismissed.push({ card: c, dismissal: d! });
    else visible.push({ ...c, back: state === "back", others: others.get(c.alertKey) ?? [] });
  }
  dismissed.sort((a, b) => b.dismissal.dismissedAt.localeCompare(a.dismissal.dismissedAt));
  return { cards: rankCards(visible), dismissed };
}

/** A task card is hidden while the person's dismissal holds: same due date and status, snooze not over. */
export function taskHidden(fingerprint: string, d: Dismissal | undefined, nowIso: string): boolean {
  if (!d) return false;
  if (d.snoozeUntil && nowIso >= d.snoozeUntil) return false;
  return d.fingerprint === fingerprint;
}

/**
 * Two ranked lists into one by urgency: the next task goes before the next
 * alert only when it is more severe, so an overdue task (negative) ranks with
 * the most severe alerts and each list keeps its own order.
 */
export function interleave<A extends { tone: RecTone }, B extends { tone: RecTone }>(alerts: A[], tasks: B[]): Array<A | B> {
  const out: Array<A | B> = [];
  let i = 0;
  let j = 0;
  while (i < alerts.length || j < tasks.length) {
    if (j >= tasks.length) out.push(alerts[i++]);
    else if (i >= alerts.length) out.push(tasks[j++]);
    else if (severityRank(tasks[j].tone) > severityRank(alerts[i].tone)) out.push(tasks[j++]);
    else out.push(alerts[i++]);
  }
  return out;
}

/** Snapshot cards win for their rules; the app adds only what BigQuery cannot compute. */
export function mergeCards(snapshot: AlertCard[], live: AlertCard[]): AlertCard[] {
  const app = new Set<string>(APP_RULES);
  return [...snapshot, ...live.filter((c) => app.has(c.ruleId))];
}

/* ------------------------------------------------------------------------ */
/* Snapshot rows                                                            */
/* ------------------------------------------------------------------------ */

const RULE_LABEL: Record<string, string> = {
  plan: "Behind plan",
  amer: "Behind plan",
  ly: "Below last year",
  cost: "Missing cost data",
  unmapped: "Unmapped ads",
  promo_end: "Promo ending",
};

const ACTION_LABEL: Record<string, string> = {
  plan: "Open Goals",
  amer: "Open Goals",
  ly: "Open Snapshot",
  cost: "Open Data Health",
  unmapped: "Map ads",
  promo_end: "Open promo",
};

const STAKE_LABEL: Record<string, string> = {
  plan: "Short of plan",
  ly: "Gap to last year",
  unmapped: "Spent to date",
  promo_end: "Left to goal",
};

export interface SnapshotRow {
  alertKey: string;
  clientId: string;
  clientName: string | null;
  rule: string;
  severity: string;
  moneyAtStake: number | null;
  moneyAtStakeCzk: number | null;
  currency: string | null;
  title: string;
  detail: string | null;
  link: string | null;
  firstSeen: string;
  lastSeen: string;
}

export function snapshotCard(r: SnapshotRow): AlertCard {
  const tone: RecTone = isSeverity(r.severity) ? r.severity : "neutral";
  const stake =
    r.moneyAtStake !== null && r.currency
      ? { value: r.moneyAtStake, currency: r.currency, label: STAKE_LABEL[r.rule] ?? "At stake" }
      : null;
  return {
    id: r.alertKey,
    alertKey: r.alertKey,
    ruleId: r.rule,
    rule: RULE_LABEL[r.rule] ?? r.rule,
    client: r.clientName ?? r.clientId,
    clientId: r.clientId,
    fact: r.title,
    detail: r.detail,
    stake,
    stakeCzk: stake ? r.moneyAtStakeCzk : null,
    href: r.link ?? "/home",
    action: ACTION_LABEL[r.rule] ?? "Open",
    tone,
    firstSeen: r.firstSeen,
    daysOpen: daysBetween(r.firstSeen, r.lastSeen) + 1,
    source: "snapshot",
  };
}

/** Whole days from a to b, both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function isFresh(runAtIso: string | null, nowIso: string): boolean {
  if (!runAtIso) return false;
  return Date.parse(nowIso) - Date.parse(runAtIso) <= SNAPSHOT_MAX_AGE_HOURS * 3_600_000;
}
