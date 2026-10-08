/**
 * Home For you and Promotions: the pure rules, without the warehouse.
 *
 *   npm run check:home-alerts
 *
 * Covers the alert_key scheme, the per-person dismissal semantics (hide,
 * snooze, worse by money or severity, reopened occurrence, task changed), the
 * six-card cap after dismissals, the snapshot / app merge, the ClickUp task
 * ranking, the urgency interleave and the promo window maths.
 */

import assert from "node:assert/strict";
import {
  APP_RULES,
  arrange,
  interleave,
  splitDismissals,
  taskHidden,
  alertKey,
  dismissState,
  isFresh,
  liveCard,
  mergeCards,
  rankCards,
  snapshotCard,
  ALERT_KEY_PATTERN,
  type AlertCard,
  type Dismissal,
} from "../lib/home/alerts/model";
import { promoEndingCards, promoItems, type PromoRow } from "../lib/home/alerts/promos";
import { OVERDUE_ORDER, rankTasks, taskFingerprint, type RawTask } from "../lib/home/alerts/tasks";
import type { Recommendation } from "../lib/home/shopify/types";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const NOW = "2026-10-08T12:00:00.000Z";

function card(over: Partial<AlertCard> & { ruleId: string; clientId: string }): AlertCard {
  const key = over.alertKey ?? alertKey(over.ruleId, over.clientId);
  return {
    id: key,
    alertKey: key,
    rule: over.rule ?? over.ruleId,
    client: over.client ?? over.clientId,
    fact: "fact",
    detail: null,
    stake: null,
    stakeCzk: null,
    href: "/",
    action: "Open",
    tone: "warning",
    firstSeen: "2026-10-05",
    daysOpen: 4,
    source: "snapshot",
    ...over,
  };
}

function dismissal(over: Partial<Dismissal> & { alertKey: string }): Dismissal {
  return {
    userEmail: "matej@oneeighty.cz",
    dismissedAt: "2026-10-07T09:00:00.000Z",
    snoozeUntil: null,
    valueAtDismiss: null,
    severityAtDismiss: "warning",
    fingerprint: null,
    ...over,
  };
}

check("alert keys are rule + client (+ entity), never a date", () => {
  assert.equal(alertKey("plan", "ethia"), "plan:ethia");
  assert.equal(alertKey("promo_end", "manami", "123ymga0zez"), "promo_end:manami:123ymga0zez");
  assert.ok(ALERT_KEY_PATTERN.test("promo_end:manami:123ymga0zez"));
  assert.ok(ALERT_KEY_PATTERN.test("unmapped:venev"));
  assert.ok(!ALERT_KEY_PATTERN.test("plan:ethia:x:y"));
  assert.ok(!ALERT_KEY_PATTERN.test("DROP TABLE"));
  const rec: Recommendation = {
    id: "capacity-rawbark", rule: "Over capacity", client: "RawBark", clientId: "rawbark", fact: "", detail: null,
    stake: null, stakeCzk: null, href: "/", action: "", tone: "warning",
  };
  assert.equal(liveCard(rec).alertKey, "capacity:rawbark");
  assert.equal(liveCard({ ...rec, id: "plan-ethia", clientId: "ethia" }).alertKey, "plan:ethia");
});

check("a dismissed card stays hidden while nothing worsens", () => {
  const c = card({ ruleId: "plan", clientId: "ethia", stake: { value: 10_000, currency: "CZK", label: "" } });
  const d = dismissal({ alertKey: c.alertKey, valueAtDismiss: 10_000 });
  assert.equal(dismissState(c, d, NOW), "hidden");
  assert.equal(dismissState({ ...c, stake: { value: 12_500, currency: "CZK", label: "" } }, d, NOW), "hidden");
});

check("money growth above 25 % brings it back", () => {
  const c = card({ ruleId: "plan", clientId: "ethia", stake: { value: 12_501, currency: "CZK", label: "" } });
  const d = dismissal({ alertKey: c.alertKey, valueAtDismiss: 10_000 });
  assert.equal(dismissState(c, d, NOW), "back");
});

check("severity escalation brings it back", () => {
  const c = card({ ruleId: "plan", clientId: "ethia", tone: "negative" });
  assert.equal(dismissState(c, dismissal({ alertKey: c.alertKey, severityAtDismiss: "warning" }), NOW), "back");
  assert.equal(dismissState({ ...c, tone: "info" }, dismissal({ alertKey: c.alertKey, severityAtDismiss: "warning" }), NOW), "hidden");
});

check("a snooze ends after its date; a plain dismiss does not", () => {
  const c = card({ ruleId: "unmapped", clientId: "manami" });
  assert.equal(dismissState(c, dismissal({ alertKey: c.alertKey, snoozeUntil: "2026-10-14T09:00:00.000Z" }), NOW), "hidden");
  assert.equal(dismissState(c, dismissal({ alertKey: c.alertKey, snoozeUntil: "2026-10-08T11:00:00.000Z" }), NOW), "none");
  assert.equal(dismissState(c, dismissal({ alertKey: c.alertKey }), "2027-01-01T00:00:00.000Z"), "hidden");
});

check("an alert reopened after the dismissal is a new occurrence", () => {
  const c = card({ ruleId: "cost", clientId: "rawbark", firstSeen: "2026-10-08" });
  assert.equal(dismissState(c, dismissal({ alertKey: c.alertKey, dismissedAt: "2026-10-07T09:00:00.000Z" }), NOW), "none");
  // Same day as the dismissal: still the same occurrence.
  assert.equal(dismissState(c, dismissal({ alertKey: c.alertKey, dismissedAt: "2026-10-08T06:00:00.000Z" }), NOW), "hidden");
});

check("cap applies after dismissals: two per rule, six in all, money first", () => {
  const cards: AlertCard[] = [
    card({ ruleId: "unmapped", rule: "Unmapped ads", clientId: "a", stakeCzk: 900, stake: { value: 900, currency: "CZK", label: "" } }),
    card({ ruleId: "unmapped", rule: "Unmapped ads", clientId: "b", stakeCzk: 800, stake: { value: 800, currency: "CZK", label: "" } }),
    card({ ruleId: "unmapped", rule: "Unmapped ads", clientId: "c", stakeCzk: 700, stake: { value: 700, currency: "CZK", label: "" } }),
    card({ ruleId: "plan", rule: "Behind plan", clientId: "a", stakeCzk: 100, stake: { value: 100, currency: "CZK", label: "" } }),
    card({ ruleId: "amer", rule: "Behind plan", clientId: "b" }),
    card({ ruleId: "amer", rule: "Behind plan", clientId: "c" }),
    card({ ruleId: "cost", rule: "Missing cost data", clientId: "a" }),
    card({ ruleId: "brief", rule: "Briefs to write", clientId: "a" }),
    card({ ruleId: "window", rule: "Slow verdicts", clientId: "a" }),
  ];
  const ranked = rankCards(cards);
  assert.equal(ranked.length, 6);
  assert.deepEqual(ranked.slice(0, 3).map((c) => c.alertKey), ["unmapped:a", "unmapped:b", "plan:a"]);
  assert.equal(ranked.filter((c) => c.rule === "Behind plan").length, 2);
  // Dismissing the top card lets the third unmapped one in.
  const d = new Map([["unmapped:a", dismissal({ alertKey: "unmapped:a", valueAtDismiss: 900 })]]);
  const a = arrange(cards, d, new Map(), NOW);
  assert.deepEqual(a.cards.slice(0, 2).map((c) => c.alertKey), ["unmapped:b", "unmapped:c"]);
  assert.equal(a.dismissed.length, 1);
});

check("dismissals are per person; a teammate's only shows in the (i)", () => {
  const rows = [
    dismissal({ alertKey: "plan:ethia", userEmail: "lukas@oneeighty.cz" }),
    dismissal({ alertKey: "cost:rawbark", userEmail: "Matej@oneeighty.cz" }),
  ];
  const { mine, others } = splitDismissals(rows, "matej@oneeighty.cz");
  assert.deepEqual([...mine.keys()], ["cost:rawbark"]);
  const cards = [card({ ruleId: "plan", clientId: "ethia" }), card({ ruleId: "cost", clientId: "rawbark" })];
  const a = arrange(cards, mine, others, NOW);
  assert.deepEqual(a.cards.map((c) => c.alertKey), ["plan:ethia"]);
  assert.equal(a.cards[0].others[0].userEmail, "lukas@oneeighty.cz");
  assert.equal(a.dismissed[0].card.alertKey, "cost:rawbark");
});

check("snapshot cards win for their rules; the app adds only Velocity", () => {
  const snap = [card({ ruleId: "plan", clientId: "ethia" })];
  const live = [
    card({ ruleId: "plan", clientId: "ethia", source: "live" }),
    card({ ruleId: "capacity", clientId: "rawbark", source: "live" }),
    card({ ruleId: "brief", clientId: "rawbark", source: "live" }),
  ];
  const merged = mergeCards(snap, live);
  assert.deepEqual(merged.map((c) => `${c.source}:${c.alertKey}`), ["snapshot:plan:ethia", "live:capacity:rawbark", "live:brief:rawbark"]);
  assert.deepEqual([...APP_RULES], ["capacity", "window", "brief"]);
});

check("snapshot rows become cards with days open", () => {
  const c = snapshotCard({
    alertKey: "plan:manami", clientId: "manami", clientName: "Manami s.r.o.", rule: "plan", severity: "warning",
    moneyAtStake: 14_803, moneyAtStakeCzk: 14_803, currency: "CZK", title: "Revenue is CZK 14,803 short of plan to date.",
    detail: null, link: "/goals?client=manami", firstSeen: "2026-10-05", lastSeen: "2026-10-08",
  });
  assert.equal(c.daysOpen, 4);
  assert.equal(c.rule, "Behind plan");
  assert.equal(c.stake?.label, "Short of plan");
  assert.equal(c.action, "Open Goals");
});

check("a snapshot older than 36 hours is not used", () => {
  assert.ok(isFresh("2026-10-08T03:10:00.000Z", NOW));
  assert.ok(!isFresh("2026-10-06T23:00:00.000Z", NOW));
  assert.ok(!isFresh(null, NOW));
});

const promo = (over: Partial<PromoRow>): PromoRow => ({
  clientId: "manami", clientName: "Manami s.r.o.", currency: "CZK", taskId: "t1", name: "F13 · Test",
  start: "2026-10-04", end: "2026-10-18", status: "running", mechanic: "Voucher", couponCodes: null,
  targetRevenue: null, targetOrders: null, targetUnits: 35, perf: null, ...over,
});

check("promos: running and the next 7 days, ending soonest first", () => {
  const items = promoItems(
    [
      promo({ taskId: "run", start: "2026-10-04", end: "2026-10-18" }),
      promo({ taskId: "soon", start: "2026-10-09", end: "2026-10-25" }),
      promo({ taskId: "week", start: "2026-10-15", end: "2026-10-16" }),
      promo({ taskId: "late", start: "2026-10-16", end: "2026-10-20" }),
      promo({ taskId: "past", start: "2026-09-21", end: "2026-09-27" }),
      promo({ taskId: "hold", start: "2026-10-04", end: "2026-10-10", status: "on hold" }),
    ],
    "2026-10-08"
  );
  assert.deepEqual(items.map((p) => p.taskId), ["week", "run", "soon"]);
  const run = items.find((p) => p.taskId === "run")!;
  assert.equal(run.state, "running");
  assert.equal(run.day, 5);
  assert.equal(run.totalDays, 15);
  assert.equal(run.endsIn, 10);
  assert.equal(items.find((p) => p.taskId === "soon")!.startsIn, 1);
});

check("promo ending: 2 days or less, money left to the revenue goal", () => {
  const rows = [
    promo({
      taskId: "end", start: "2026-10-01", end: "2026-10-10", targetRevenue: 50_000,
      perf: { windowStart: "2026-10-01", windowEnd: "2026-10-10", asOf: "2026-10-07", orders: 4, revenue: 14_510.4, units: 5, isStorewide: false },
    }),
    promo({ taskId: "later", start: "2026-10-01", end: "2026-10-11" }),
  ];
  const cards = promoEndingCards(promoItems(rows, "2026-10-08"), new Map([["CZK", 1]]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].alertKey, "promo_end:manami:end");
  assert.equal(cards[0].fact, "F13 · Test ends in 2 days.");
  assert.equal(Math.round(cards[0].stake!.value), 35_490);
  assert.equal(cards[0].detail, "4 orders · CZK 14,510 of CZK 50,000 through 7 Oct");
});

const task = (over: Partial<RawTask> & { id: string }): RawTask => ({
  name: over.id, url: `https://app.clickup.com/t/${over.id}`, status: "to do", statusType: "open", statusColor: null,
  dueMs: null, priority: null, listId: "1", listName: "List", folderName: null, assignees: [], ...over,
});
// 04:00 Prague on the given day, as ClickUp stores due dates.
const due = (day: string) => Date.parse(`${day}T02:00:00Z`);

check("tasks: overdue (most recently overdue first), today, within 2 days, urgent/high without date", () => {
  const ranked = rankTasks(
    [
      task({ id: "soon2", dueMs: due("2026-10-10") }),
      task({ id: "late1", dueMs: due("2026-10-07"), priority: "urgent" }),
      task({ id: "late90", dueMs: due("2026-07-10") }),
      task({ id: "today", dueMs: due("2026-10-08") }),
      task({ id: "soon1", dueMs: due("2026-10-09") }),
      task({ id: "far", dueMs: due("2026-10-20") }),
      task({ id: "nodate-high", priority: "high" }),
      task({ id: "nodate-urgent", priority: "urgent" }),
      task({ id: "nodate-normal", priority: "normal" }),
      task({ id: "done", dueMs: due("2026-10-01"), statusType: "done" }),
      task({ id: "closed", dueMs: due("2026-10-01"), statusType: "closed" }),
      task({ id: "crm", dueMs: due("2026-10-01"), listId: "901522795290" }),
    ],
    "2026-10-08"
  );
  assert.deepEqual(ranked.map((t) => t.task.id), OVERDUE_ORDER === "recent"
      ? ["late1", "late90", "today", "soon1", "soon2", "nodate-urgent", "nodate-high"]
      : ["late90", "late1", "today", "soon1", "soon2", "nodate-urgent", "nodate-high"]
  );
  assert.equal(ranked.find((t) => t.task.id === "late90")!.daysLate, 90);
  assert.equal(ranked[0].tone, "negative");
  assert.equal(ranked[2].tone, "warning");
});

check("a dismissed task returns when its due date or status changes", () => {
  const t = task({ id: "x", dueMs: due("2026-10-07") });
  const d = dismissal({ alertKey: "task:x", fingerprint: taskFingerprint(t) });
  assert.ok(taskHidden(taskFingerprint(t), d, NOW));
  assert.ok(!taskHidden(taskFingerprint({ ...t, status: "in progress" }), d, NOW));
  assert.ok(!taskHidden(taskFingerprint({ ...t, dueMs: due("2026-10-12") }), d, NOW));
  assert.ok(!taskHidden(taskFingerprint(t), { ...d, snoozeUntil: "2026-10-08T00:00:00.000Z" }, NOW));
});

check("interleave: a task goes first only when it is more severe", () => {
  const alerts = [{ id: "a1", tone: "warning" as const }, { id: "a2", tone: "info" as const }, { id: "a3", tone: "negative" as const }];
  const tasks = [{ id: "t-overdue", tone: "negative" as const }, { id: "t-today", tone: "warning" as const }, { id: "t-soon", tone: "info" as const }];
  assert.deepEqual(interleave(alerts, tasks).map((x) => x.id), ["t-overdue", "a1", "t-today", "a2", "a3", "t-soon"]);
});

console.log(`\n${passed} checks passed.`);
