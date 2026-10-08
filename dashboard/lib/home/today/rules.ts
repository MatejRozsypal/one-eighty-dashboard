/**
 * Home, Today variant: the rules that turn source rows into the day's list.
 *
 * Pure. No database, no React, no server-only import, so a fixture can run it.
 * Each rule reads one source, fires on an explicit condition, and prints the
 * figure that fired it as the source gave it. The page computes only sums,
 * differences and the FX conversion used for ordering.
 *
 *   plan          Goals pacing, current month: revenue or CM3 Behind or Off
 *                 track (shortfall = plan to date minus actual), aMER below its
 *                 target (shortfall = new customer revenue the target needs at
 *                 the spend so far, minus what came in)
 *   cm3_negative  no CM3 target and CM3 month to date below zero
 *   packs         ad sets first delivered in the last 60 days, still spending:
 *                   ready     7+ days live and paid N x CPA (or N purchases),
 *                             reached in the last 7 days
 *                   past      older than the verdict window, not yet paid N x CPA
 *                   starving  3+ days live, under the SOP floor of 0.5 x CPA per
 *                             ad a day over the last 7 days
 *   briefs        Velocity brief quota above zero; production above capacity
 *   unmapped      ads with spend and no brief since the pipeline started
 *   sync          ClickUp sync errors and warnings of the latest run
 *   feeds         every row of ops.v_pipeline_alerts
 *   tasks         Founder Responsibilities, open, due today or earlier
 *
 * Order: money at stake (in CZK) first, then urgency, then client.
 */

import { formatMoney, formatNumber, formatRatio, plainDashes } from "@/lib/format";
import { fmtGap, fmtPace, fmtValue } from "@/lib/plan/format";
import { toneOfRow, type HealthTone } from "@/lib/plan/health";
import type { PacingRow } from "@/lib/plan/types";
import type { ClientHealth } from "@/lib/home/types";
import type { AlertRow, FounderTask, PackRow, Read, SyncIssueRow, UnmappedRow } from "./sources";
import type { ClientLine, ItemDetail, RuleKey, SourceCheck, TodayItem, Urgency } from "./types";

/* ------------------------------------------------------------------------ */
/* Inputs                                                                   */
/* ------------------------------------------------------------------------ */

/** What the pack and brief rules need from Velocity, per client with Meta. */
export interface VelocityLite {
  clientId: string;
  name: string;
  /** The Meta account currency: every amount here is in it. */
  currency: string;
  /** Purchases a pack needs for a verdict (Creative Settings, read at). */
  verdictN: number | null;
  /** 90-day CPA, or the saved Plan input. */
  cpa: number | null;
  /** Days to a verdict at the Plan inputs. */
  windowDays: number | null;
  /** New ads a month at the Plan inputs. */
  capacity: number | null;
  /** Capacity at the actual 30-day spend. */
  actualCapacity: number | null;
  newAds30d: number | null;
  /** New ads 30d over actual capacity. */
  production: number | null;
  queued: number | null;
  brief: number | null;
  /** Ads per ad set from the launch table; null when the table is not ready. */
  adsByAdset: Record<string, number> | null;
}

export interface RuleInputs {
  /** Prague date, `YYYY-MM-DD`. */
  today: string;
  home: { status: "ok"; clients: ClientHealth[] } | { status: "na"; note: string };
  velocity: { status: "ok"; clients: VelocityLite[] } | { status: "na"; note: string };
  packs: Read<PackRow>;
  unmapped: Read<UnmappedRow>;
  /** Ad ids a person has already confirmed a mapping for, per client. */
  confirmed: Record<string, string[]>;
  sync: Read<SyncIssueRow>;
  alerts: Read<AlertRow>;
  tasks: Read<FounderTask>;
  /** Registry names and Meta currency, by client id. */
  clients: Record<string, { name: string; metaCurrency: string | null; currency: string }>;
  /** USD per one unit of a currency (ref.fx_rates). */
  usdRates: Record<string, number>;
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function toCzk(value: number | null, currency: string | null, usd: Record<string, number>): number | null {
  if (value === null || !Number.isFinite(value) || !currency) return null;
  if (currency === "CZK") return value;
  const from = usd[currency];
  const czk = usd.CZK;
  return from && czk ? (value * from) / czk : null;
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** `YYYY-MM-DD` of an instant in Prague. */
export function pragueDay(at: Date | number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** "2026-10-07" -> "7 Oct". */
export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "duplicate_period" -> "Duplicate period". */
function humanKind(kind: string): string {
  const s = kind.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Issue";
}

/** A ClickUp task id ("86c1abc2d"): lowercase letters and digits with at least one letter. */
function clickupTask(id: string | null): string | null {
  return id && /^(?=.*[a-z])[0-9a-z]{6,12}$/.test(id) ? `https://app.clickup.com/t/${id}` : null;
}

const PLAN_KINDS = /^(plan|promo|quarter|month|daily|duplicate_period|gate|amer|missing_level|missing_field|name_mismatch|not_measured)/;

function clean(text: string | null | undefined): string {
  return plainDashes(String(text ?? "")).trim();
}

/* ------------------------------------------------------------------------ */
/* Rules                                                                    */
/* ------------------------------------------------------------------------ */

const TIP = {
  plan: "Goals pacing for the month (mart.plan_pacing). Fires when the status is Behind or Off track. The figure is actual to date minus the plan to date.",
  amer: "Goals pacing for the month (mart.plan_pacing). Money at stake: target aMER times paid spend so far, minus new customer revenue so far.",
  cm3Negative: "CM3 month to date from mart.plan_actuals_daily, for a client whose plan has no CM3 target. Fires below zero.",
  packsReady: "Ad sets first delivered in the last 60 days and still spending (mart.mart_creative_adset_perf). Ready: 7 days live and paid N x CPA or N purchases, reached in the last 7 days.",
  packsPast: "Still spending after the verdict window (Velocity, at the Plan inputs) without having been paid N x CPA.",
  packsStarving: "3 or more days live and under the SOP floor of 0.5 x CPA per ad a day over the last 7 days. Ads per pack from the launch table.",
  briefs: "Velocity brief quota: capacity at the Plan inputs minus the ClickUp queue (ready plus in works).",
  overCapacity: "New ads in the last 30 days over capacity at the actual 30-day spend (Velocity). Above 1.0x some new ads cannot reach a verdict.",
  unmapped: "Ads with spend and no ClickUp brief, first delivered after the client's ad pipeline started (mart.mart_creative_unmapped).",
  sync: "Rows of the latest ClickUp sync run (ops.clickup_sync_issues), errors and warnings.",
  feeds: "Open alerts in ops.v_pipeline_alerts: stale or never-loaded feeds, the freshness monitor, FX rates and Google Ads coverage.",
  tasks: "Open tasks in ClickUp Company > Founder Responsibilities, due today or earlier.",
} as const;

function planItems(clients: ClientHealth[], usd: Record<string, number>): TodayItem[] {
  const out: TodayItem[] = [];
  for (const c of clients) {
    if (!c.clientId || !c.currency) continue;
    const id = c.clientId;
    const cur = c.currency;
    const href = `/goals?client=${encodeURIComponent(id)}`;
    const behind = (row: PacingRow | null): row is PacingRow =>
      !!row && (row.status === "behind" || row.status === "off_track");

    for (const [metric, label] of [
      ["revenue", "Revenue"],
      ["cm3", "CM3"],
    ] as const) {
      const row = c[metric].row;
      if (!behind(row)) continue;
      const shortfall = row.gap !== null && row.gap < 0 ? -row.gap : null;
      const projected =
        row.projected !== null && row.target !== null
          ? `Projected ${fmtValue(row.projected, metric, cur)} of ${fmtValue(row.target, metric, cur)}`
          : null;
      out.push({
        id: `plan:${id}:${metric}:${row.periodId}`,
        rule: "plan",
        clientId: id,
        clientName: c.name,
        title: row.status === "off_track" ? `${label} off track` : `${label} behind plan`,
        figure: fmtGap(row.gap, metric, cur),
        tone: toneOfRow(row),
        context: [`${fmtPace(row.pacePct)} of plan to date`, projected].filter(Boolean).join(" · "),
        action: "Open Goals",
        href,
        external: false,
        stakeCzk: toCzk(shortfall, cur, usd),
        urgency: row.status === "off_track" ? 0 : 1,
        tip: TIP.plan,
        details: [],
      });
    }

    const amer = c.amer.row;
    if (behind(amer)) {
      const need =
        amer.targetToDate !== null && amer.ratioDenActual !== null && amer.ratioNumActual !== null
          ? amer.targetToDate * amer.ratioDenActual - amer.ratioNumActual
          : null;
      out.push({
        id: `plan:${id}:amer:${amer.periodId}`,
        rule: "plan",
        clientId: id,
        clientName: c.name,
        title: "aMER below target",
        figure: formatRatio(amer.actual),
        tone: toneOfRow(amer),
        context: [
          `Target ${formatRatio(amer.targetToDate)}`,
          need !== null && need > 0 ? `${formatMoney(need, cur)} new customer revenue short` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        action: "Open Goals",
        href,
        external: false,
        stakeCzk: need !== null && need > 0 ? toCzk(need, cur, usd) : null,
        urgency: amer.status === "off_track" ? 0 : 1,
        tip: TIP.amer,
        details: [],
      });
    }

    if (!c.cm3.row && c.cm3.actual !== null && c.cm3.actual < 0) {
      out.push({
        id: `cm3neg:${id}:${c.monthLabel ?? ""}`,
        rule: "cm3_negative",
        clientId: id,
        clientName: c.name,
        title: "CM3 below zero this month",
        figure: fmtValue(c.cm3.actual, "cm3", cur),
        tone: "negative",
        context: [c.monthLabel, c.asOf ? `to ${shortDate(c.asOf)}` : null, "No CM3 target"].filter(Boolean).join(" · "),
        action: "Open Snapshot",
        href: `/snapshot?client=${encodeURIComponent(id)}`,
        external: false,
        stakeCzk: toCzk(-c.cm3.actual, cur, usd),
        urgency: 1,
        tip: TIP.cm3Negative,
        details: [],
      });
    }
  }
  return out;
}

interface PackJudged {
  row: PackRow;
  age: number;
  verdict: "ready" | "past" | "starving" | null;
  perAdDaily: number | null;
}

/** Judge one pack. Null verdict: nothing to do, or the inputs to judge it are missing. */
export function judgePack(row: PackRow, v: VelocityLite): PackJudged {
  const age = daysBetween(row.firstDay, row.through);
  const V = v.verdictN !== null && v.cpa !== null && v.verdictN > 0 && v.cpa > 0 ? v.verdictN * v.cpa : null;
  const ads = v.adsByAdset?.[row.adsetId] ?? null;
  const window = Math.min(7, age + 1);
  const perAdDaily = ads && ads > 0 ? row.spend7d / window / ads : null;
  if (V === null || v.verdictN === null) return { row, age, verdict: null, perAdDaily };

  const read = row.spend >= V || row.purchases >= v.verdictN;
  // Reached its read in the last 7 days: the 7-day minimum fell in the last
  // week, or the spend crossed N x CPA in it. Older reads are not today's news.
  if (read && age >= 7 && (age <= 13 || row.spend - row.spend7d < V)) return { row, age, verdict: "ready", perAdDaily };
  if (read) return { row, age, verdict: null, perAdDaily };
  if (v.windowDays !== null && age > Math.ceil(v.windowDays)) return { row, age, verdict: "past", perAdDaily };
  const floor = v.cpa !== null ? v.cpa * 0.5 : null;
  if (age >= 3 && perAdDaily !== null && floor !== null && perAdDaily < floor)
    return { row, age, verdict: "starving", perAdDaily };
  return { row, age, verdict: null, perAdDaily };
}

function packItems(
  packs: PackRow[],
  velocity: VelocityLite[],
  usd: Record<string, number>
): { items: TodayItem[]; unjudged: string[] } {
  const items: TodayItem[] = [];
  const unjudged: string[] = [];
  const byClient = new Map(velocity.map((v) => [v.clientId, v]));
  const clientIds = Array.from(new Set(packs.map((p) => p.clientId)));
  for (const id of clientIds) {
    const v = byClient.get(id);
    if (!v || v.verdictN === null || v.cpa === null) {
      unjudged.push(v?.name ?? id);
      continue;
    }
    const judged = packs.filter((p) => p.clientId === id).map((p) => judgePack(p, v));
    const money = (n: number | null) => formatMoney(n, v.currency);
    const V = v.verdictN * v.cpa;
    const groups: Array<{ key: "ready" | "past" | "starving"; title: (n: number) => string; context: string; tip: string }> = [
      {
        key: "ready",
        title: (n) => (n === 1 ? "Pack ready for a verdict" : `${n} packs ready for a verdict`),
        context: `Read at ${formatNumber(v.verdictN)} purchases or ${money(V)}`,
        tip: TIP.packsReady,
      },
      {
        key: "past",
        title: (n) => (n === 1 ? "Pack past its verdict window" : `${n} packs past their verdict window`),
        context: `Window ${v.windowDays === null ? "n/a" : `${Math.ceil(v.windowDays)} days`} · read at ${money(V)}`,
        tip: TIP.packsPast,
      },
      {
        key: "starving",
        title: (n) => (n === 1 ? "Pack starving" : `${n} packs starving`),
        context: `Under ${money(v.cpa * 0.5)} per ad a day`,
        tip: TIP.packsStarving,
      },
    ];
    for (const g of groups) {
      const hits = judged.filter((j) => j.verdict === g.key).sort((a, b) => b.row.spend - a.row.spend);
      if (!hits.length) continue;
      const spend = hits.reduce((s, j) => s + j.row.spend, 0);
      items.push({
        id: `packs:${id}:${g.key}`,
        rule: "packs",
        clientId: id,
        clientName: v.name,
        title: g.title(hits.length),
        figure: money(spend),
        tone: g.key === "ready" ? "info" : "warning",
        context: g.context,
        action: "Open Creative",
        href: `/creative?client=${encodeURIComponent(id)}`,
        external: false,
        stakeCzk: toCzk(spend, v.currency, usd),
        urgency: 1,
        tip: g.tip,
        details: hits.map((j) => ({
          label: clean(j.row.name) || j.row.adsetId,
          value: [
            `${j.age} ${plural(j.age, "day")}`,
            money(j.row.spend),
            `${formatNumber(j.row.purchases)} ${plural(j.row.purchases, "purchase")}`,
            g.key === "starving" && j.perAdDaily !== null ? `${money(j.perAdDaily)} per ad a day` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
      });
    }
  }
  return { items, unjudged };
}

function briefItems(velocity: VelocityLite[]): TodayItem[] {
  const out: TodayItem[] = [];
  for (const v of velocity) {
    const href = `/creative/velocity/plan?client=${encodeURIComponent(v.clientId)}`;
    if (v.brief !== null && v.brief > 0) {
      out.push({
        id: `briefs:${v.clientId}`,
        rule: "briefs",
        clientId: v.clientId,
        clientName: v.name,
        title: `Write ${v.brief} ${plural(v.brief, "brief")} for next month`,
        figure: formatNumber(v.brief),
        tone: "info",
        context: `Capacity ${formatNumber(v.capacity, { decimals: 1 })} new ads a month · ${formatNumber(v.queued)} queued`,
        action: "Open Velocity",
        href,
        external: false,
        stakeCzk: null,
        urgency: 2,
        tip: TIP.briefs,
        details: [],
      });
    }
    if (v.production !== null && v.production > 1) {
      out.push({
        id: `capacity:${v.clientId}`,
        rule: "briefs",
        clientId: v.clientId,
        clientName: v.name,
        title: "Launching above capacity",
        figure: formatRatio(v.production),
        tone: "warning",
        context: `${formatNumber(v.newAds30d)} new ads in 30 days · capacity ${formatNumber(v.actualCapacity, { decimals: 1 })}`,
        action: "Open This month",
        href: `/creative/velocity/month?client=${encodeURIComponent(v.clientId)}`,
        external: false,
        stakeCzk: null,
        urgency: 2,
        tip: TIP.overCapacity,
        details: [],
      });
    }
  }
  return out;
}

function unmappedItems(rows: UnmappedRow[], confirmed: Record<string, string[]>, inputs: RuleInputs): TodayItem[] {
  const out: TodayItem[] = [];
  const ids = Array.from(new Set(rows.map((r) => r.clientId)));
  for (const id of ids) {
    const done = new Set(confirmed[id] ?? []);
    const ads = rows.filter((r) => r.clientId === id && !done.has(r.adId));
    if (!ads.length) continue;
    const reg = inputs.clients[id];
    const currency = reg?.metaCurrency ?? reg?.currency ?? null;
    const spend = ads.reduce((s, a) => s + a.spend, 0);
    const first = ads.map((a) => a.firstSeen).filter((d): d is string => !!d).sort()[0] ?? null;
    out.push({
      id: `unmapped:${id}`,
      rule: "unmapped",
      clientId: id,
      clientName: reg?.name ?? id,
      title: `${ads.length} unmapped ${plural(ads.length, "ad")}`,
      figure: currency ? formatMoney(spend, currency) : formatNumber(ads.length),
      tone: "warning",
      context: [currency ? "Spend with no brief" : null, first ? `since ${shortDate(first)}` : null].filter(Boolean).join(" "),
      action: "Map ads",
      href: `/creative?client=${encodeURIComponent(id)}#unmapped`,
      external: false,
      stakeCzk: null,
      urgency: 2,
      tip: TIP.unmapped,
      details: ads.slice(0, 6).map((a) => ({
        label: clean(a.adName) || a.adId,
        value: currency ? formatMoney(a.spend, currency) : undefined,
      })),
    });
  }
  return out;
}

function syncItems(rows: SyncIssueRow[], inputs: RuleInputs): TodayItem[] {
  const out: TodayItem[] = [];
  const keyOf = (r: SyncIssueRow) => r.clientId ?? "*";
  const ids = Array.from(new Set(rows.map(keyOf)));
  for (const id of ids) {
    for (const level of ["error", "warning"] as const) {
      const hits = rows.filter(
        (r) => keyOf(r) === id && (level === "error" ? r.severity === "error" : r.severity === "warn" || r.severity === "warning")
      );
      if (!hits.length) continue;
      const counts = new Map<string, number>();
      for (const h of hits) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
      const kinds = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (n > 1 ? `${humanKind(k)} ×${n}` : humanKind(k)));
      const details: ItemDetail[] = hits.slice(0, 8).map((h) => {
        const href = clickupTask(h.entityId);
        return { label: humanKind(h.kind), value: clean(h.detail) || undefined, href: href ?? undefined, external: !!href };
      });
      const allPlan = hits.every((h) => PLAN_KINDS.test(h.kind));
      const firstTask = details.find((d) => d.href)?.href ?? null;
      const clientId = id === "*" ? null : id;
      const action =
        allPlan && clientId
          ? { action: "Open Goals", href: `/goals?client=${encodeURIComponent(clientId)}`, external: false }
          : firstTask
            ? { action: "Fix in ClickUp", href: firstTask, external: true }
            : { action: "Open Data Health", href: "/health", external: false };
      out.push({
        id: `sync:${id}:${level}`,
        rule: "sync",
        clientId,
        clientName: clientId ? inputs.clients[clientId]?.name ?? clientId : null,
        title: `${hits.length} ClickUp sync ${plural(hits.length, level)}`,
        figure: formatNumber(hits.length),
        tone: level === "error" ? "negative" : "warning",
        context: kinds.slice(0, 3).join(" · ") + (kinds.length > 3 ? ` · +${kinds.length - 3}` : ""),
        ...action,
        stakeCzk: null,
        urgency: level === "error" ? 1 : 2,
        tip: TIP.sync,
        details,
      });
    }
  }
  return out;
}

function hours(h: number | null): string | null {
  if (h === null || !Number.isFinite(h)) return null;
  return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`;
}

function alertTitle(a: AlertRow): string {
  if (a.status === "monitor_down") return "Freshness monitor down";
  if (a.status === "fx_missing") return "FX rate missing";
  if (a.status === "never") return `${a.feedKey} never loaded`;
  if (a.feedKey === "google_ads") return "Google Ads coverage";
  return `${a.feedKey} feed stale`;
}

function feedItems(rows: AlertRow[], inputs: RuleInputs): TodayItem[] {
  const out: TodayItem[] = [];
  const ids = Array.from(new Set(rows.map((r) => r.clientId)));
  for (const id of ids) {
    const hits = rows.filter((r) => r.clientId === id);
    const critical = hits.some((h) => h.severity === "critical" || h.status === "never");
    const single = hits.length === 1 ? hits[0] : null;
    const oldest = hits.reduce<number | null>(
      (m, h) => (h.stalenessHours !== null && (m === null || h.stalenessHours > m) ? h.stalenessHours : m),
      null
    );
    const clientId = id === "*" ? null : id;
    out.push({
      id: `feeds:${id}`,
      rule: "feeds",
      clientId,
      clientName: clientId ? inputs.clients[clientId]?.name ?? clientId : null,
      title: single ? alertTitle(single) : `${hits.length} data alerts`,
      figure: single?.status === "never" ? "Never" : hours(oldest) ?? formatNumber(hits.length),
      tone: critical ? "negative" : "warning",
      context: single ? clean(single.message) : hits.map(alertTitle).slice(0, 3).join(" · "),
      action: "Open Data Health",
      href: "/health",
      external: false,
      stakeCzk: null,
      urgency: critical ? 0 : 1,
      tip: TIP.feeds,
      details: single ? [] : hits.map((h) => ({ label: alertTitle(h), value: clean(h.message) })),
    });
  }
  return out;
}

function taskItems(rows: FounderTask[], today: string): TodayItem[] {
  return rows.flatMap((t) => {
    const due = pragueDay(t.due);
    if (due > today) return [];
    const late = daysBetween(due, today);
    const status = t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : null;
    return [
      {
        id: `task:${t.id}`,
        rule: "tasks" as const,
        clientId: null,
        clientName: null,
        title: clean(t.name) || "Untitled task",
        figure: late > 0 ? `${late} ${plural(late, "day")} late` : "Due today",
        tone: (late > 0 ? "negative" : "warning") as HealthTone,
        context: [status, late > 0 ? `Due ${shortDate(due)}` : null].filter(Boolean).join(" · ") || null,
        action: "Open in ClickUp",
        href: t.url,
        external: true,
        stakeCzk: null,
        urgency: (late > 0 ? 0 : 1) as Urgency,
        tip: TIP.tasks,
        details: [],
        assignees: t.assignees,
      },
    ];
  });
}

/* ------------------------------------------------------------------------ */
/* Assembly                                                                 */
/* ------------------------------------------------------------------------ */

export function sortItems(items: TodayItem[]): TodayItem[] {
  return [...items].sort((a, b) => {
    const sa = a.stakeCzk ?? -1;
    const sb = b.stakeCzk ?? -1;
    if (sa !== sb) return sb - sa;
    if (a.urgency !== b.urgency) return a.urgency - b.urgency;
    return (a.clientName ?? "~").localeCompare(b.clientName ?? "~") || a.title.localeCompare(b.title);
  });
}

export function buildToday(inputs: RuleInputs): { items: TodayItem[]; sources: SourceCheck[] } {
  const usd = inputs.usdRates;
  const sources: SourceCheck[] = [];
  const all: TodayItem[] = [];
  const add = (key: RuleKey, label: string, items: TodayItem[] | null, note: string) => {
    if (items) all.push(...items);
    sources.push({ key, label, status: items ? "ok" : "na", items: items?.length ?? 0, note });
  };

  // Goals
  if (inputs.home.status === "ok") {
    const items = planItems(inputs.home.clients, usd);
    const withPlan = inputs.home.clients.filter((c) => c.focus).map((c) => c.name);
    add(
      "plan",
      "Goals",
      items,
      withPlan.length
        ? `Goals pacing, this month. Clients with a plan: ${withPlan.join(", ")}.`
        : "Goals pacing, this month. No client has a plan this month."
    );
  } else {
    add("plan", "Goals", null, inputs.home.note);
  }

  // Packs
  if (inputs.packs.status === "na") add("packs", "Packs", null, inputs.packs.note);
  else if (inputs.velocity.status === "na") add("packs", "Packs", null, `Velocity inputs: ${inputs.velocity.note}`);
  else {
    const { items, unjudged } = packItems(inputs.packs.rows, inputs.velocity.clients, usd);
    add(
      "packs",
      "Packs",
      items,
      unjudged.length
        ? `Not judged for ${unjudged.join(", ")}: no CPA or read threshold in Velocity.`
        : "New ad sets of the last 60 days, judged at each client's read threshold and CPA."
    );
  }

  // Briefs
  if (inputs.velocity.status === "na") add("briefs", "Briefs", null, inputs.velocity.note);
  else {
    const noQueue = inputs.velocity.clients.filter((v) => v.brief === null).map((v) => v.name);
    add(
      "briefs",
      "Briefs",
      briefItems(inputs.velocity.clients),
      noQueue.length
        ? `Brief quota n/a for ${noQueue.join(", ")}: no ClickUp ad queue or no capacity.`
        : "Velocity capacity minus the ClickUp queue."
    );
  }

  // Unmapped
  if (inputs.unmapped.status === "na") add("unmapped", "Unmapped ads", null, inputs.unmapped.note);
  else add("unmapped", "Unmapped ads", unmappedItems(inputs.unmapped.rows, inputs.confirmed, inputs), TIP.unmapped);

  // Sync
  if (inputs.sync.status === "na") add("sync", "ClickUp sync", null, inputs.sync.note);
  else add("sync", "ClickUp sync", syncItems(inputs.sync.rows, inputs), TIP.sync);

  // Feeds
  if (inputs.alerts.status === "na") add("feeds", "Data feeds", null, inputs.alerts.note);
  else add("feeds", "Data feeds", feedItems(inputs.alerts.rows, inputs), TIP.feeds);

  // Founder tasks
  if (inputs.tasks.status === "na") add("tasks", "Founder tasks", null, inputs.tasks.note);
  else add("tasks", "Founder tasks", taskItems(inputs.tasks.rows, inputs.today), TIP.tasks);

  // CM3 below zero is part of the Goals read; its count joins the Goals check.
  const cm3 = all.filter((i) => i.rule === "cm3_negative").length;
  const goals = sources.find((s) => s.key === "plan");
  if (goals && cm3) goals.items += cm3;

  return { items: sortItems(all), sources };
}

/* ------------------------------------------------------------------------ */
/* The client table                                                         */
/* ------------------------------------------------------------------------ */

export function clientLines(clients: ClientHealth[]): ClientLine[] {
  return clients.map((c) => {
    const known = !!c.clientId;
    return {
      key: c.key,
      clientId: c.clientId,
      name: c.name,
      status: c.crmStatus ?? c.registryStatus,
      currency: c.currency,
      focus: c.focus,
      revenueMtd: c.revenue.actual,
      revenueNote: c.revenue.actual !== null ? null : known ? "No revenue in mart.plan_actuals_daily this month." : "Not in the warehouse registry (ref.clients).",
      cm3Mtd: c.cm3.actual,
      cm3Note:
        c.cm3.actual !== null
          ? null
          : known
            ? "CM3 needs cost data on every day this month (mart.plan_actuals_daily)."
            : "Not in the warehouse registry (ref.clients).",
      cm3Row: c.cm3.row,
      asOf: c.asOf,
    };
  });
}

