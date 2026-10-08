import "server-only";

/**
 * For you, personal half: the signed-in person's ClickUp tasks. Read only:
 * this module never writes to ClickUp.
 *
 *   readMembers()                              workspace members (GET /team);
 *                                              the dashboard user is matched
 *                                              by email
 *   GET /team/{team}/task?assignees[]=<member>  their open tasks, every page up
 *                                              to MAX_PAGES (100 a page)
 *
 * Both through lib/home/clickup.ts (server-side CLICKUP_API_TOKEN, timeout,
 * one retry of a timeout, 429 or 5xx). Any failure becomes a note (n/a with
 * the reason) for this half only; the client alerts render regardless. A page
 * failing after earlier pages keeps the tasks already read.
 */

import * as React from "react";
import { CLICKUP_TEAM_ID, clickupGet, clickupToken, readMembers, stateOf, type ClickUpMember } from "@/lib/home/clickup";
import { rankTasks, type RawTask, type TaskAssignee, type TaskCard } from "@/lib/home/alerts/tasks";
import type { SourceState } from "@/lib/home/types";

const MAX_PAGES = 10;

const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn);

interface ApiUser {
  id: number;
  username: string | null;
  email: string | null;
  color: string | null;
  initials: string | null;
  profilePicture: string | null;
}

interface ApiTask {
  id: string;
  name: string;
  url: string;
  status: { status: string; type: string | null; color: string | null };
  due_date: string | null;
  priority: { priority: string } | null;
  list: { id: string; name: string } | null;
  folder: { id: string; name: string; hidden?: boolean } | null;
  assignees: ApiUser[];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function toAssignee(u: ApiUser): TaskAssignee {
  const name = u.username ?? u.email ?? String(u.id);
  return { id: String(u.id), name, initials: u.initials ?? initials(name), color: u.color, avatar: u.profilePicture };
}

function toTask(t: ApiTask): RawTask {
  const p = t.priority?.priority?.toLowerCase();
  const due = t.due_date ? Number(t.due_date) : null;
  return {
    id: t.id,
    name: t.name,
    url: t.url,
    status: t.status.status,
    statusType: t.status.type,
    statusColor: t.status.color,
    dueMs: due !== null && Number.isFinite(due) ? due : null,
    priority: p === "urgent" || p === "high" || p === "normal" || p === "low" ? p : null,
    listId: t.list?.id ?? null,
    listName: t.list?.name ?? null,
    folderName: t.folder && !t.folder.hidden ? t.folder.name : null,
    assignees: (t.assignees ?? []).map(toAssignee),
  };
}

async function openTasks(memberId: string, auth: string): Promise<{ state: SourceState; tasks: RawTask[] }> {
  const tasks: RawTask[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      "assignees[]": memberId,
      subtasks: "true",
      include_closed: "false",
      order_by: "due_date",
      reverse: "true",
      page: String(page),
    });
    const result = await clickupGet<{ tasks?: ApiTask[]; last_page?: boolean }>(`/team/${CLICKUP_TEAM_ID}/task?${q}`, auth);
    if (!result.ok) {
      console.error(`[home] ClickUp tasks page ${page} ${result.status ? `failed: ${result.status}` : "unreachable:"} ${result.detail}`);
      return { state: result.status ? stateOf(result.status) : "error", tasks };
    }
    const batch = result.json.tasks ?? [];
    tasks.push(...batch.map(toTask));
    if (result.json.last_page !== false || batch.length === 0) break;
  }
  return { state: "ok", tasks };
}

export interface MyTasks {
  /** All ranked tasks; the section shows the first five that are not dismissed. Null with `note` when n/a. */
  cards: TaskCard[] | null;
  /** Why the tasks are n/a, or that the list is incomplete. */
  note: string | null;
  member: ClickUpMember | null;
}

function why(state: SourceState, what: string): string {
  if (state === "not_configured") return "ClickUp not connected.";
  if (state === "denied") return `ClickUp refused the token for ${what}.`;
  return `ClickUp could not be read (${what}).`;
}

export const loadMyTasks = perRequest(async (email: string | null, today: string): Promise<MyTasks> => {
  const auth = clickupToken();
  if (!auth) return { cards: null, note: why("not_configured", ""), member: null };
  if (!email) return { cards: null, note: "No email on the session.", member: null };
  const members = await readMembers();
  if (members.state !== "ok") return { cards: null, note: why(members.state, "the workspace members"), member: null };
  const member = members.members.find((m) => m.email === email.toLowerCase()) ?? null;
  if (!member) return { cards: null, note: `No ClickUp member with the email ${email}.`, member: null };
  const read = await openTasks(member.id, auth);
  if (read.state !== "ok" && read.tasks.length === 0) return { cards: null, note: why(read.state, "your tasks"), member };
  return {
    cards: rankTasks(read.tasks, today),
    note: read.state === "ok" ? null : `${why(read.state, "your tasks")} Some tasks may be missing.`,
    member,
  };
});
