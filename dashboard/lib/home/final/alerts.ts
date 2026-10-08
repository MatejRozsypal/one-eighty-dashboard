import "server-only";

/**
 * Home "For you": the daily snapshot, the live rules and the team's
 * dismissals, merged for the section (components/home/final/ForYou.tsx).
 *
 * ── Which rule runs where ──────────────────────────────────────────────────
 * mart.home_alerts (282, daily 05:10)   plan, ly, amer, cost, unmapped, promo_end
 * the app, on every load                capacity, window, brief (Velocity: the
 *                                       inputs and settings live in Postgres)
 * the app, fallback                     all of them, when the latest run in
 *                                       mart.home_alerts_runs is missing or older
 *                                       than 36 hours, or the table cannot be read
 *
 * ── Personal ───────────────────────────────────────────────────────────────
 * Dismissals hide a card only for the signed-in person. The person's own
 * ClickUp tasks (lib/home/final/myTasks.ts) join the client alerts; a failed
 * ClickUp read turns only them n/a.
 *
 * The client alerts are the same for everyone. A later "only my clients"
 * filter belongs in `forPerson()` below: read each client's owner from the
 * ClickUp Clients list (the same read as lib/home/clickup.ts readCrm, plus
 * its assignee or Owner field), match it to `member.id` from myTasks, and keep
 * the cards whose clientId the person owns. Nothing else changes.
 *
 * Set HOME_ALERTS_DATASET_OVERRIDE=mart_qa to read the QA copies
 * (mart_qa.ha_home_alerts, mart_qa.ha_home_alerts_runs).
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { guarded } from "@/lib/home/shopify/data";
import { allRecommendations } from "@/lib/home/shopify/rules";
import {
  isFresh,
  splitDismissals,
  liveCard,
  mergeCards,
  snapshotCard,
  type AlertCard,
  type Dismissal,
  type SnapshotRow,
} from "@/lib/home/alerts/model";
import { promoEndingCards } from "@/lib/home/alerts/promos";
import { listDismissals } from "@/lib/home/alerts/store";
import { pragueDay, type TaskCard } from "@/lib/home/alerts/tasks";
import { getSession } from "@/lib/auth";
import { loadMyTasks } from "./myTasks";
import type { ClickUpMember as Member } from "@/lib/home/clickup";
import { ratesForRequest, ruleInput, velocityForRequest } from "./data";
import { loadPromotions } from "./promos";

type Raw = Record<string, unknown>;

export function homeAlertTables(env: Record<string, string | undefined> = process.env) {
  const qa = env.HOME_ALERTS_DATASET_OVERRIDE?.trim() === "mart_qa";
  const q = (dataset: string, table: string) => `\`${PROJECT_ID}.${dataset}.${table}\``;
  return qa
    ? { alerts: q("mart_qa", "ha_home_alerts"), runs: q("mart_qa", "ha_home_alerts_runs"), label: "mart_qa.ha_home_alerts" }
    : { alerts: q("mart", "home_alerts"), runs: q("mart", "home_alerts_runs"), label: "mart.home_alerts" };
}

/** BigQuery TIMESTAMP arrives as `{ value: "..." }` from the client library. */
function timestamp(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const raw = typeof v === "object" && v !== null && "value" in v ? (v as { value: unknown }).value : v;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const day = (v: unknown): string => isoDate(v as Parameters<typeof isoDate>[0]) ?? "";
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

interface Snapshot {
  runAt: string | null;
  rows: SnapshotRow[];
}

async function fetchSnapshot(): Promise<Snapshot> {
  const t = homeAlertTables();
  const rows = await query<Raw>(
    `WITH r AS (SELECT computed_at FROM ${t.runs} ORDER BY computed_at DESC LIMIT 1)
     SELECT r.computed_at AS run_at, a.alert_key, a.client_id, a.client_name, a.rule, a.severity,
            a.money_at_stake, a.money_at_stake_czk, a.currency, a.title, a.detail, a.link,
            a.first_seen, a.last_seen
     FROM r LEFT JOIN ${t.alerts} a ON a.computed_at = r.computed_at`
  );
  const runAt = rows.length ? timestamp(rows[0].run_at) : null;
  const out: SnapshotRow[] = [];
  for (const r of rows) {
    if (r.alert_key === null || r.alert_key === undefined) continue;
    const clientId = String(r.client_id);
    if (isDemo(clientId)) continue;
    out.push({
      alertKey: String(r.alert_key),
      clientId,
      clientName: str(r.client_name),
      rule: String(r.rule),
      severity: String(r.severity),
      moneyAtStake: num(r.money_at_stake),
      moneyAtStakeCzk: num(r.money_at_stake_czk),
      currency: str(r.currency),
      title: String(r.title),
      detail: str(r.detail),
      link: str(r.link),
      firstSeen: day(r.first_seen),
      lastSeen: day(r.last_seen),
    });
  }
  return { runAt, rows: out };
}

export interface ForYouData {
  /** The signed-in person: their dismissals apply, everyone else's show in the (i). */
  me: string;
  /** Every candidate card, before dismissals and the six-card cap. */
  cards: AlertCard[];
  /** The person's own dismissals. */
  mine: Dismissal[];
  /** Teammates' dismissals, for the (i) on a card. */
  others: Dismissal[];
  /** The person's ranked ClickUp tasks, before dismissals and the five-card cap. Null with `tasksNote` when n/a. */
  tasks: TaskCard[] | null;
  tasksNote: string | null;
  member: Member | null;
  /** Null when dismissals can be read and written; else why not, for the (i). */
  dismissNote: string | null;
  mode: "snapshot" | "live";
  /** The snapshot run's time, ISO. */
  updatedAt: string | null;
  /** Why the cards are live, for the (i). Null in snapshot mode. */
  liveNote: string | null;
  /** Server time of the render: the client component judges snoozes against it. */
  now: string;
}

/** Velocity cards only: rules.ts with no clients and no unmapped queue. */
async function appRuleCards(): Promise<AlertCard[]> {
  const [v, r] = await Promise.all([velocityForRequest(), ratesForRequest()]);
  return allRecommendations({
    clients: [],
    velocity: v.value?.facts ?? null,
    velocityNote: v.note,
    unmapped: null,
    unmappedNote: null,
    czkRates: r.value ?? new Map([["CZK", 1]]),
  }).map(liveCard);
}

/** Every rule computed now, the fallback when the snapshot cannot be used. */
async function liveCards(): Promise<AlertCard[]> {
  const [input, promos] = await Promise.all([ruleInput(), loadPromotions()]);
  return [...allRecommendations(input).map(liveCard), ...promoEndingCards(promos.items ?? [], input.czkRates)];
}

/** Where an "only my clients" filter would go; today every person sees every client. */
function forPerson(cards: AlertCard[], member: Member | null): AlertCard[] {
  void member;
  return cards;
}

export async function loadForYou(): Promise<ForYouData> {
  const now = new Date().toISOString();
  const t = homeAlertTables();
  const session = await getSession();
  const me = session?.user?.email ?? "";
  const [snap, dismissals, tasks] = await Promise.all([
    guarded(t.label, fetchSnapshot),
    guarded("home_alert_dismissals (Postgres)", listDismissals),
    loadMyTasks(me || null, pragueDay(Date.parse(now))),
  ]);

  const fresh = snap.value !== null && isFresh(snap.value.runAt, now);
  let cards: AlertCard[];
  let liveNote: string | null = null;
  if (fresh) {
    cards = mergeCards(snap.value!.rows.map(snapshotCard), await appRuleCards());
  } else {
    cards = await liveCards();
    liveNote =
      snap.note ??
      (snap.value?.runAt
        ? `The daily snapshot in ${t.label} is older than 36 hours. Computed live.`
        : `No daily snapshot in ${t.label} yet. Computed live.`);
  }

  const { mine, others } = splitDismissals(dismissals.value ?? [], me);
  return {
    me,
    cards: forPerson(cards, tasks.member),
    mine: [...mine.values()],
    others: [...others.values()].flat(),
    tasks: tasks.cards,
    tasksNote: tasks.note,
    member: tasks.member,
    dismissNote: dismissals.note,
    mode: fresh ? "snapshot" : "live",
    updatedAt: fresh ? snap.value!.runAt : null,
    liveNote,
    now,
  };
}
