import "server-only";

/**
 * Read-only ClickUp lookups for Home: the Clients list in Client Success and
 * the Invoice Tracker in Billing & Finance.
 *
 * Two plain GETs with the same server-side token Creative uses
 * (`CLICKUP_API_TOKEN`); nothing here writes. ClickUp is where the owners keep
 * each client's relationship status, billing type and agreed retainer, and the
 * warehouse holds none of the three, so this is the only source for them.
 *
 * A failed read never takes the page down and never reads as zero: the state
 * comes back with the rows and every affected figure renders n/a with the
 * reason. The status code and body go to the server log.
 *
 * ── One failing call never blanks the others ──────────────────────────────
 * The two lists are read independently and each keeps its own state. Within a
 * list, a page that fails after earlier pages were read keeps those rows (the
 * state then says the list is incomplete). A timeout, a 429 or a 5xx is tried
 * once more before it counts as a failure; a 401, 403 or 404 is final.
 *
 * Read once per request (`perRequest`), so a page that renders several
 * sections from `getHomeData()` asks ClickUp once.
 *
 * `clickupGet` and `readMembers` are the same pattern for other Home reads
 * (the For you task cards, lib/home/final/myTasks.ts).
 *
 * Note (2026-10-08): the n/a on /home that day was a rejected token, not this
 * code: the production logs show `401 Token invalid (OAUTH_025)` only from
 * deployments built before CLICKUP_API_TOKEN was replaced, and Vercel bakes
 * environment variables into a deployment at build time.
 */

import * as React from "react";

import type { InvoiceLine, SourceState } from "./types";

/** Client Success > Clients. */
export const CLIENTS_LIST_ID = "901522365067";
/** Billing & Finance > Invoice Tracker. */
export const INVOICE_LIST_ID = "901522370596";

const FIELD = {
  retainer: "b56121ed-65ad-481e-9534-b8705ba1e7c6",
  billingType: "bbe536ee-a0d8-488e-9475-6a868a645f32",
  /** On the tracker this relationship is named "Client" and points at the Clients list. */
  invoiceClient: "ca57d1be-9564-4fbf-95a9-0f591180e37a",
  invoiceAmount: "332bf772-991e-4e70-bea6-b6513c612432",
  profitShare: "bb57aac7-f661-422e-9d2e-869c91af4644",
} as const;

const API = "https://api.clickup.com/api/v2";
/** Per attempt. ClickUp list reads with custom fields can take several seconds under load. */
const TIMEOUT_MS = 8000;
/** Pause before the single retry of a transient failure. */
const RETRY_MS = 400;

const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn);

interface RawField {
  id: string;
  value?: unknown;
  type_config?: { options?: Array<{ id?: string; name?: string; orderindex?: number | string }> };
}

interface RawTask {
  id: string;
  name: string;
  url?: string;
  status?: { status?: string } | string;
  date_created?: string;
  custom_fields?: RawField[];
}

export interface CrmClient {
  taskId: string;
  name: string;
  url: string | null;
  status: string | null;
  retainerCzk: number | null;
  billingType: string | null;
  lastInvoice: InvoiceLine | null;
}

export interface CrmRead {
  state: SourceState;
  /** Invoice Tracker state, separate: the token may reach one list and not the other. */
  invoiceState: SourceState;
  clients: CrmClient[];
}

export function clickupToken(): string | null {
  const t = process.env.CLICKUP_API_TOKEN;
  // Same cleaning as lib/creative/clickup.ts: a pasted value often carries a
  // newline or quotes, which turns every call into a 401.
  return t ? t.trim().replace(/^["']|["']$/g, "") : null;
}

export function stateOf(status: number): SourceState {
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "missing";
  return "error";
}

/** Worth one more try: a timeout or dropped connection (status 0), rate limiting, a server error. */
function transient(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export type GetResult<T> = { ok: true; json: T } | { ok: false; status: number; detail: string };

/**
 * One read-only GET with the timeout; a timeout, 429 or 5xx is tried once
 * more after RETRY_MS. Shared by the list reads below and by the For you task
 * read (lib/home/final/myTasks.ts).
 */
export async function clickupGet<T>(path: string, auth: string): Promise<GetResult<T>> {
  const once = async (): Promise<GetResult<T>> => {
    try {
      const res = await fetch(`${API}${path}`, {
        headers: { Authorization: auth },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, status: res.status, detail: body.slice(0, 300) };
      }
      return { ok: true, json: (await res.json()) as T };
    } catch (error) {
      return { ok: false, status: 0, detail: String((error as Error)?.message ?? error) };
    }
  };
  const first = await once();
  if (first.ok || !transient(first.status)) return first;
  await new Promise((r) => setTimeout(r, RETRY_MS));
  return once();
}

type PageResult =
  | { ok: true; tasks: RawTask[]; lastPage: boolean }
  | { ok: false; status: number; detail: string };

async function fetchPage(listId: string, page: number, auth: string): Promise<PageResult> {
  const result = await clickupGet<{ tasks?: RawTask[]; last_page?: boolean }>(
    `/list/${listId}/task?include_closed=true&subtasks=false&page=${page}`,
    auth
  );
  if (!result.ok) return result;
  const tasks = result.json.tasks ?? [];
  return { ok: true, tasks, lastPage: result.json.last_page !== false || tasks.length === 0 };
}

async function listTasks(listId: string, auth: string): Promise<{ state: SourceState; tasks: RawTask[] }> {
  const tasks: RawTask[] = [];
  // A list of clients or monthly invoices is far below one page; the loop is a
  // guard, capped so a misbehaving API cannot hold the page.
  for (let page = 0; page < 5; page++) {
    const result = await fetchPage(listId, page, auth);
    if (!result.ok) {
      console.error(
        `[home] ClickUp list ${listId} page ${page} ${result.status ? `failed: ${result.status}` : "unreachable:"} ${result.detail}`
      );
      // Rows already read stay: a later page failing does not blank them.
      return { state: result.status ? stateOf(result.status) : "error", tasks };
    }
    tasks.push(...result.tasks);
    if (result.lastPage) break;
  }
  return { state: "ok", tasks };
}

function field(task: RawTask, id: string): RawField | undefined {
  return task.custom_fields?.find((f) => f.id === id);
}

function money(task: RawTask, id: string): number | null {
  const v = field(task, id)?.value;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Drop-down value: ClickUp sends the option's orderindex (older lists) or its id. */
function dropDown(task: RawTask, id: string): string | null {
  const f = field(task, id);
  if (f?.value === null || f?.value === undefined || f.value === "") return null;
  const option = f.type_config?.options?.find(
    (o) => o.id === f.value || (o.orderindex !== undefined && Number(o.orderindex) === Number(f.value))
  );
  return option?.name ?? null;
}

function relatedIds(task: RawTask, id: string): string[] {
  const v = field(task, id)?.value;
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) =>
    item && typeof item === "object" && "id" in item ? [String((item as { id: unknown }).id)] : []
  );
}

function statusOf(task: RawTask): string | null {
  const s = typeof task.status === "string" ? task.status : task.status?.status;
  return s ? s.toLowerCase() : null;
}

/** "Manami | 04/26" names its period after the bar; else the creation month. */
function periodOf(task: RawTask): string {
  const named = task.name.split("|")[1]?.trim();
  if (named) return named;
  const created = Number(task.date_created);
  if (!Number.isFinite(created)) return task.name;
  const d = new Date(created);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
}

export const readCrm = perRequest(readCrmOnce);

async function readCrmOnce(): Promise<CrmRead> {
  const auth = clickupToken();
  if (!auth) return { state: "not_configured", invoiceState: "not_configured", clients: [] };

  const [clients, invoices] = await Promise.all([
    listTasks(CLIENTS_LIST_ID, auth),
    listTasks(INVOICE_LIST_ID, auth),
  ]);

  // Latest invoice per client task, by creation time.
  const latest = new Map<string, RawTask>();
  for (const inv of invoices.tasks) {
    for (const clientTaskId of relatedIds(inv, FIELD.invoiceClient)) {
      const seen = latest.get(clientTaskId);
      if (!seen || Number(inv.date_created ?? 0) > Number(seen.date_created ?? 0)) latest.set(clientTaskId, inv);
    }
  }

  return {
    state: clients.state,
    invoiceState: invoices.state,
    clients: clients.tasks.map((t) => {
      const inv = latest.get(t.id);
      return {
        taskId: t.id,
        name: t.name,
        url: t.url ?? null,
        status: statusOf(t),
        retainerCzk: money(t, FIELD.retainer),
        billingType: dropDown(t, FIELD.billingType),
        lastInvoice: inv
          ? {
              period: periodOf(inv),
              amountCzk: money(inv, FIELD.invoiceAmount),
              profitShareCzk: money(inv, FIELD.profitShare),
              status: statusOf(inv),
            }
          : null,
      };
    }),
  };
}

/** The agency's ClickUp workspace. */
export const CLICKUP_TEAM_ID = "90151448219";

export interface ClickUpMember {
  id: string;
  name: string;
  email: string;
}

/**
 * Workspace members (GET /team), read once per request. Used to find the
 * signed-in person's ClickUp member by email.
 */
export const readMembers = perRequest(
  async (): Promise<{ state: SourceState; members: ClickUpMember[] }> => {
    const auth = clickupToken();
    if (!auth) return { state: "not_configured", members: [] };
    type User = { id: number; username: string | null; email: string | null };
    const result = await clickupGet<{ teams?: Array<{ id: string; members?: Array<{ user: User }> }> }>("/team", auth);
    if (!result.ok) {
      console.error(`[home] ClickUp members ${result.status ? `failed: ${result.status}` : "unreachable:"} ${result.detail}`);
      return { state: result.status ? stateOf(result.status) : "error", members: [] };
    }
    const team = result.json.teams?.find((t) => String(t.id) === CLICKUP_TEAM_ID);
    if (!team) return { state: "denied", members: [] };
    return {
      state: "ok",
      members: (team.members ?? [])
        .map((m) => m.user)
        .filter((u) => u.email)
        .map((u) => ({ id: String(u.id), name: u.username ?? u.email!, email: u.email!.toLowerCase() })),
    };
  }
);

/** Lowercase, no diacritics, first word: "Dobias Healing Solutions" -> "dobias". */
export function matchKey(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/)?.[0] ?? ""
  );
}
