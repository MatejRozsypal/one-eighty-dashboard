/**
 * Action chips and recommendation cards, from explicit rules. Pure.
 *
 * Every sentence is assembled from a figure a source returned; a rule whose
 * figure is missing does not fire. Nothing here estimates, projects or scores.
 *
 * ── The rules ──────────────────────────────────────────────────────────────
 * Behind plan       a Goals pacing row (revenue or CM3) is behind or off track
 *                   this month. At stake: target to date minus actual.
 * Below last year   no plan, and revenue month to date is 10% or more under the
 *                   same days a year earlier. At stake: that difference.
 * Unmapped ads      Meta ads with spend and no ClickUp task (the Creative
 *                   queue). At stake: their spend to date.
 * aMER behind plan  the aMER pacing row is behind and no money rule fired for
 *                   the client. No money figure.
 * Over capacity     new ads in 30 days above what the budget brings to a
 *                   verdict (Velocity). No money figure.
 * Slow verdicts     a new pack needs more than 30 days to a verdict.
 * Briefs to write   Velocity capacity minus the ClickUp queue is above zero.
 * Missing cost data CM3 cannot be measured this month.
 *
 * Cards are ordered by money at stake in CZK (latest rate in ref.fx_rates),
 * then by the rule order above, at most two per rule and six in all.
 */

import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { OVER_CAPACITY_X } from "@/lib/creative/capacity";
import { planStatusLabel, toneOfRow } from "@/lib/plan/health";
import { fmtPace } from "@/lib/plan/format";
import type { PacingRow } from "@/lib/plan/types";
import type { ClientHealth } from "@/lib/home/types";
import type { ActionChip, RecTone, Recommendation } from "./types";

export interface VelocityFact {
  clientId: string;
  name: string;
  /** Meta account currency. */
  currency: string;
  /** Capacity at the saved Plan inputs minus the queue. */
  brief: number | null;
  /** New ads a month at the saved Plan inputs. */
  capacity: number | null;
  /** New ads a month at the last 30 days' actual spend. */
  actualCapacity: number | null;
  queued: number | null;
  newAds30d: number | null;
  /** newAds30d / actualCapacity. */
  production: number | null;
  windowDays: number | null;
  longWindow: boolean;
}

export interface UnmappedFact {
  clientId: string;
  name: string;
  ads: number;
  spend: number;
  currency: string;
}

export interface RuleInput {
  clients: ClientHealth[];
  velocity: VelocityFact[] | null;
  velocityNote: string | null;
  unmapped: UnmappedFact[] | null;
  unmappedNote: string | null;
  /** CZK per unit, latest month in ref.fx_rates. CZK itself is 1. */
  czkRates: Map<string, number>;
}

export const MAX_CARDS = 6;
export const MAX_PER_RULE = 2;
/** Revenue this far under last year fires "Below last year". */
export const LY_DROP = -0.1;

const RULE_ORDER = ["plan", "ly", "unmapped", "amer", "capacity", "window", "brief", "cost"] as const;

const money = (v: number, c: string) => formatMoney(v, c);
const whole = (v: number) => formatNumber(Math.round(v));
const perMonth = (v: number | null) => (v === null ? null : `${formatNumber(v, { decimals: v < 10 ? 1 : 0 })} a month`);

function toCzk(value: number, currency: string, rates: Map<string, number>): number | null {
  if (currency === "CZK") return value;
  const r = rates.get(currency);
  return r ? value * r : null;
}

function isBehind(row: PacingRow | null): row is PacingRow {
  if (!row) return false;
  const tone = toneOfRow(row);
  return tone === "negative" || tone === "warning";
}

function toneOf(row: PacingRow): RecTone {
  return toneOfRow(row) === "negative" ? "negative" : "warning";
}

function planCard(c: ClientHealth, rates: Map<string, number>): Recommendation | null {
  const currency = c.currency!;
  const candidates = [
    { metric: "CM3", row: c.cm3.row },
    { metric: "Revenue", row: c.revenue.row },
  ]
    .filter((x): x is { metric: string; row: PacingRow } => isBehind(x.row))
    .filter((x) => x.row.actual !== null && x.row.targetToDate !== null && x.row.targetToDate > x.row.actual)
    .map((x) => ({ ...x, short: x.row.targetToDate! - x.row.actual! }))
    .sort((a, b) => b.short - a.short);
  const top = candidates[0];
  if (!top) return null;
  return {
    id: `plan-${c.key}`,
    rule: "Behind plan",
    client: c.name,
    clientId: c.clientId!,
    fact: `${top.metric} is ${money(top.short, currency)} short of plan to date.`,
    detail: `${money(top.row.actual!, currency)} of ${money(top.row.targetToDate!, currency)} · ${fmtPace(top.row.pacePct)} of plan · ${planStatusLabel(top.row)}`,
    stake: { value: top.short, currency, label: "Short of plan" },
    stakeCzk: toCzk(top.short, currency, rates),
    href: `/goals?client=${encodeURIComponent(c.clientId!)}`,
    action: "Open Goals",
    tone: toneOf(top.row),
  };
}

function amerCard(c: ClientHealth): Recommendation | null {
  const row = c.amer.row;
  if (!isBehind(row) || row.actual === null || row.targetToDate === null) return null;
  return {
    id: `amer-${c.key}`,
    rule: "Behind plan",
    client: c.name,
    clientId: c.clientId!,
    fact: `aMER is ${formatRatio(row.actual)} against ${formatRatio(row.targetToDate)} planned to date.`,
    detail: `${planStatusLabel(row)} · ${row.label}`,
    stake: null,
    stakeCzk: null,
    href: `/goals?client=${encodeURIComponent(c.clientId!)}`,
    action: "Open Goals",
    tone: toneOf(row),
  };
}

function lastYearCard(c: ClientHealth, rates: Map<string, number>): Recommendation | null {
  const f = c.revenueVsLastYear.value;
  const now = c.revenue.actual;
  if (c.focus || f === null || now === null || f > LY_DROP || f <= -1) return null;
  const currency = c.currency!;
  const before = now / (1 + f);
  const gap = before - now;
  return {
    id: `ly-${c.key}`,
    rule: "Below last year",
    client: c.name,
    clientId: c.clientId!,
    fact: `Revenue month to date is ${formatPercent(Math.abs(f))} below the same days last year.`,
    detail: `${money(now, currency)} against ${money(before, currency)}`,
    stake: { value: gap, currency, label: "Gap to last year" },
    stakeCzk: toCzk(gap, currency, rates),
    href: `/snapshot?client=${encodeURIComponent(c.clientId!)}`,
    action: "Open Snapshot",
    tone: "warning",
  };
}

function costCard(c: ClientHealth): Recommendation | null {
  if (c.cm3.actual !== null || c.revenue.actual === null) return null;
  return {
    id: `cost-${c.key}`,
    rule: "Missing cost data",
    client: c.name,
    clientId: c.clientId!,
    fact: "CM3 is n/a this month: cost data is missing on at least one day.",
    detail: c.amer.actual === null ? "aMER is n/a too." : null,
    stake: null,
    stakeCzk: null,
    href: "/health",
    action: "Open Data Health",
    tone: "neutral",
  };
}

function unmappedCard(u: UnmappedFact, rates: Map<string, number>): Recommendation | null {
  if (u.ads <= 0) return null;
  return {
    id: `unmapped-${u.clientId}`,
    rule: "Unmapped ads",
    client: u.name,
    clientId: u.clientId,
    fact: `${whole(u.ads)} Meta ${u.ads === 1 ? "ad has" : "ads have"} no ClickUp task.`,
    detail: "Their spend is missing from every tag breakdown.",
    stake: u.spend > 0 ? { value: u.spend, currency: u.currency, label: "Spent to date" } : null,
    stakeCzk: u.spend > 0 ? toCzk(u.spend, u.currency, rates) : null,
    href: `/creative?client=${encodeURIComponent(u.clientId)}#unmapped`,
    action: "Map ads",
    tone: "info",
  };
}

function velocityCards(v: VelocityFact): Recommendation[] {
  const out: Recommendation[] = [];
  const plan = `/creative/velocity/plan?client=${encodeURIComponent(v.clientId)}`;
  if (v.production !== null && v.production > OVER_CAPACITY_X && v.newAds30d !== null && v.actualCapacity !== null) {
    out.push({
      id: `capacity-${v.clientId}`,
      rule: "Over capacity",
      client: v.name,
      clientId: v.clientId,
      fact: `${whole(v.newAds30d)} new ads in 30 days; the budget brings ${perMonth(v.actualCapacity)} to a verdict.`,
      detail: `${formatNumber(v.production, { decimals: 1 })}x capacity`,
      stake: null,
      stakeCzk: null,
      href: `/creative/velocity/month?client=${encodeURIComponent(v.clientId)}`,
      action: "Open This month",
      tone: "warning",
    });
  }
  if (v.longWindow && v.windowDays !== null) {
    out.push({
      id: `window-${v.clientId}`,
      rule: "Slow verdicts",
      client: v.name,
      clientId: v.clientId,
      fact: `A new pack needs ${whole(v.windowDays)} days to reach a verdict.`,
      detail: "Over 30 days at the planned spend",
      stake: null,
      stakeCzk: null,
      href: plan,
      action: "Open Velocity plan",
      tone: "warning",
    });
  }
  if (v.brief !== null && v.brief > 0) {
    out.push({
      id: `brief-${v.clientId}`,
      rule: "Briefs to write",
      client: v.name,
      clientId: v.clientId,
      fact: `Brief ${whole(v.brief)} new ${v.brief === 1 ? "ad" : "ads"} for next month.`,
      detail: [v.capacity !== null ? `Capacity ${perMonth(v.capacity)}` : null, v.queued !== null ? `${whole(v.queued)} queued in ClickUp` : null]
        .filter(Boolean)
        .join(" · ") || null,
      stake: null,
      stakeCzk: null,
      href: plan,
      action: "Open Velocity plan",
      tone: "info",
    });
  }
  return out;
}

function ruleRank(id: string): number {
  const i = RULE_ORDER.indexOf(id.split("-")[0] as (typeof RULE_ORDER)[number]);
  return i < 0 ? RULE_ORDER.length : i;
}

/** Every card the rules fire, before ordering and the cap (Home For you dismisses and caps them itself). */
export function allRecommendations(input: RuleInput): Recommendation[] {
  const all: Recommendation[] = [];
  for (const c of input.clients) {
    if (!c.clientId || !c.currency) continue;
    const plan = planCard(c, input.czkRates);
    const ly = lastYearCard(c, input.czkRates);
    if (plan) all.push(plan);
    if (ly) all.push(ly);
    if (!plan && !ly) {
      const amer = amerCard(c);
      if (amer) all.push(amer);
    }
    const cost = costCard(c);
    if (cost) all.push(cost);
  }
  for (const u of input.unmapped ?? []) {
    const card = unmappedCard(u, input.czkRates);
    if (card) all.push(card);
  }
  for (const v of input.velocity ?? []) all.push(...velocityCards(v));
  return all;
}

export function recommendations(input: RuleInput): Recommendation[] {
  const all = allRecommendations(input);
  const sorted = all.sort((a, b) => {
    if (a.stakeCzk !== null && b.stakeCzk !== null) return b.stakeCzk - a.stakeCzk;
    if (a.stakeCzk !== null) return -1;
    if (b.stakeCzk !== null) return 1;
    return ruleRank(a.id) - ruleRank(b.id) || a.client.localeCompare(b.client);
  });
  // At most two cards per rule, so one busy rule cannot fill the page; the
  // chips above still count every case.
  const perRule = new Map<string, number>();
  const out: Recommendation[] = [];
  for (const r of sorted) {
    const n = perRule.get(r.rule) ?? 0;
    if (n >= MAX_PER_RULE) continue;
    perRule.set(r.rule, n + 1);
    out.push(r);
    if (out.length === MAX_CARDS) break;
  }
  return out;
}

/** A chip points at the one client when only one is concerned, else the overview. */
function target(ids: string[], one: (id: string) => string, many: string): string {
  return ids.length === 1 ? one(ids[0]) : many;
}

export function actionChips(input: RuleInput): ActionChip[] {
  const behind = input.clients.filter((c) => c.clientId && c.focus && isBehind(c.focus));
  const cost = input.clients.filter((c) => c.clientId && c.currency && c.cm3.actual === null && c.revenue.actual !== null);
  const v = input.velocity;
  const briefs = v?.filter((x) => x.brief !== null) ?? [];
  const briefTotal = briefs.length ? briefs.reduce((s, x) => s + (x.brief ?? 0), 0) : null;
  const over = v?.filter((x) => x.production !== null && x.production > OVER_CAPACITY_X) ?? [];
  const slow = v?.filter((x) => x.longWindow) ?? [];
  const unmapped = [...(input.unmapped ?? [])].filter((u) => u.ads > 0).sort((a, b) => b.ads - a.ads);
  const unmappedTotal = input.unmapped ? unmapped.reduce((s, u) => s + u.ads, 0) : null;
  const q = (id: string) => encodeURIComponent(id);

  return [
    {
      key: "behind",
      label: "Clients behind plan",
      count: behind.length,
      href: target(behind.map((c) => c.clientId!), (id) => `/goals?client=${q(id)}`, "/goals"),
      note: null,
    },
    {
      key: "briefs",
      label: "Briefs to write",
      count: briefTotal,
      href: target(briefs.filter((x) => (x.brief ?? 0) > 0).map((x) => x.clientId), (id) => `/creative/velocity/plan?client=${q(id)}`, "/creative/velocity"),
      note: briefTotal === null ? input.velocityNote ?? "No Velocity capacity or ClickUp queue for any client." : null,
    },
    {
      key: "unmapped",
      label: "Unmapped ads",
      count: unmappedTotal,
      // The Creative queue is per client: the chip opens the longest one.
      href: unmapped.length ? `/creative?client=${q(unmapped[0].clientId)}#unmapped` : "/creative",
      note: unmappedTotal === null ? input.unmappedNote ?? "mart.mart_creative_unmapped could not be read." : null,
    },
    {
      key: "over",
      label: "Over capacity",
      count: v ? over.length : null,
      href: target(over.map((x) => x.clientId), (id) => `/creative/velocity/month?client=${q(id)}`, "/creative/velocity"),
      note: v ? null : input.velocityNote,
    },
    {
      key: "slow",
      label: "Slow verdicts",
      count: v ? slow.length : null,
      href: target(slow.map((x) => x.clientId), (id) => `/creative/velocity/plan?client=${q(id)}`, "/creative/velocity"),
      note: v ? null : input.velocityNote,
    },
    {
      key: "cost",
      label: "Missing cost data",
      count: cost.length,
      href: "/health",
      note: null,
    },
  ];
}

/** "5 clients. 1 of 2 on plan for October." Counts of the cards, nothing else. */
export function greetingLine(clients: ClientHealth[], onPlan: number, withPlan: number): string {
  const n = clients.length;
  const head = `${n} ${n === 1 ? "client" : "clients"}`;
  const month = clients.find((c) => c.focus)?.monthLabel?.split(" ")[0];
  if (!withPlan) return `${head}. None has a plan this month.`;
  return `${head}. ${onPlan} of ${withPlan} on plan${month ? ` for ${month}` : " this month"}.`;
}

