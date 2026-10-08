/**
 * For you, personal half: the signed-in person's most pressing ClickUp tasks.
 * Pure, safe in client components.
 *
 * Which tasks: assigned to the person anywhere in the workspace, not done or
 * closed (status type), outside the frozen Outreach CRM archive. Ranked
 *   1. overdue, most recently overdue first (OVERDUE_ORDER; then priority)
 *   2. due today
 *   3. due within 2 days (soonest first)
 *   4. priority urgent or high with no due date (urgent first)
 * Everything else is left out. At most five.
 *
 * Each bucket carries a severity so the tasks can be interleaved with the
 * client alerts: overdue ranks with the most severe alerts (negative), due
 * today with warnings, the rest with info.
 */

import type { RecTone } from "@/lib/home/shopify/types";

export const MAX_TASKS = 5;
/**
 * Order inside the overdue bucket. "recent" (default, pending the owner's
 * call): a task due this week ranks above one 90 days stale. "stale": the
 * most days late first.
 */
export const OVERDUE_ORDER: "recent" | "stale" = "recent";
export const SOON_DAYS = 2;
/** ClickUp list 901522795290 (Outreach CRM) is a frozen archive; Pipedrive owns outbound. */
export const EXCLUDED_LISTS = new Set(["901522795290"]);

export interface TaskAssignee {
  id: string;
  name: string;
  initials: string;
  color: string | null;
  avatar: string | null;
}

export interface RawTask {
  id: string;
  name: string;
  url: string;
  status: string;
  statusType: string | null;
  statusColor: string | null;
  /** ms epoch, or null without a due date. */
  dueMs: number | null;
  priority: "urgent" | "high" | "normal" | "low" | null;
  listId: string | null;
  listName: string | null;
  folderName: string | null;
  assignees: TaskAssignee[];
}

export type TaskBucket = "overdue" | "today" | "soon" | "priority";

export interface TaskCard {
  /** `task:<task id>`: dismissals are per person, so the key needs no user. */
  alertKey: string;
  task: RawTask;
  bucket: TaskBucket;
  /** Europe/Prague due date, `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Days past the due date (overdue only). */
  daysLate: number | null;
  /** Days until the due date (today 0). */
  dueIn: number | null;
  tone: RecTone;
  /** Changes when the due date or the status changes: a dismissal only holds while it is the same. */
  fingerprint: string;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const prio = (p: RawTask["priority"]) => (p ? PRIORITY_RANK[p] ?? 4 : 4);

export function pragueDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms)
  );
}

function days(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function taskFingerprint(t: Pick<RawTask, "dueMs" | "status">): string {
  return `${t.dueMs ?? ""}|${t.status}`;
}

export function rankTasks(tasks: RawTask[], today: string): TaskCard[] {
  const cards: TaskCard[] = [];
  for (const t of tasks) {
    if (t.statusType === "done" || t.statusType === "closed") continue;
    if (t.listId && EXCLUDED_LISTS.has(t.listId)) continue;
    const dueDate = t.dueMs !== null ? pragueDay(t.dueMs) : null;
    const dueIn = dueDate ? days(today, dueDate) : null;
    let bucket: TaskBucket | null = null;
    if (dueIn !== null && dueIn < 0) bucket = "overdue";
    else if (dueIn === 0) bucket = "today";
    else if (dueIn !== null && dueIn <= SOON_DAYS) bucket = "soon";
    else if (dueIn === null && (t.priority === "urgent" || t.priority === "high")) bucket = "priority";
    if (!bucket) continue;
    cards.push({
      alertKey: `task:${t.id}`,
      task: t,
      bucket,
      dueDate,
      daysLate: bucket === "overdue" ? -dueIn! : null,
      dueIn,
      tone: bucket === "overdue" ? "negative" : bucket === "today" ? "warning" : t.priority === "urgent" ? "warning" : "info",
      fingerprint: taskFingerprint(t),
    });
  }
  const order: Record<TaskBucket, number> = { overdue: 0, today: 1, soon: 2, priority: 3 };
  cards.sort(
    (a, b) =>
      order[a.bucket] - order[b.bucket] ||
      (a.bucket === "overdue" ? (OVERDUE_ORDER === "recent" ? a.daysLate! - b.daysLate! : b.daysLate! - a.daysLate!) : 0) ||
      (a.bucket === "soon" ? a.dueIn! - b.dueIn! : 0) ||
      prio(a.task.priority) - prio(b.task.priority) ||
      a.task.name.localeCompare(b.task.name)
  );
  return cards;
}

export function lateLabel(c: TaskCard): string {
  if (c.bucket === "overdue") return `${c.daysLate} ${c.daysLate === 1 ? "day" : "days"} late`;
  if (c.bucket === "today") return "Due today";
  if (c.bucket === "soon") return c.dueIn === 1 ? "Due tomorrow" : `Due in ${c.dueIn} days`;
  return "No due date";
}
