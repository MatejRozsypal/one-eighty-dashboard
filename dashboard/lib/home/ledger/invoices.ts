import "server-only";

/**
 * Every invoice in the ClickUp Invoice Tracker (Billing & Finance), read only.
 *
 * `lib/home/clickup.ts` keeps the latest invoice per client, which is what the
 * main Home needs. The ledger sets each month's invoice against that month's
 * CM3, so it needs all of them. Same list, same token, same field ids; this is
 * a copy rather than an edit so the shared module stays as it is.
 *
 * A failed read comes back as a state, never as zero, and is logged.
 */

import { INVOICE_LIST_ID } from "@/lib/home/clickup";
import type { SourceState } from "@/lib/home/types";

const FIELD = {
  invoiceClient: "ca57d1be-9564-4fbf-95a9-0f591180e37a",
  invoiceAmount: "332bf772-991e-4e70-bea6-b6513c612432",
  profitShare: "bb57aac7-f661-422e-9d2e-869c91af4644",
} as const;

const API = "https://api.clickup.com/api/v2";
const TIMEOUT_MS = 5000;

interface RawField {
  id: string;
  value?: unknown;
}

interface RawTask {
  id: string;
  name: string;
  status?: { status?: string } | string;
  date_created?: string;
  custom_fields?: RawField[];
}

export interface InvoiceRef {
  id: string;
  name: string | null;
}

export interface Invoice {
  taskId: string;
  /** The task name; "Manami | 04/26" carries the client before the bar. */
  name: string;
  /** "04/26". */
  period: string;
  /** "2026-04-01", parsed from the period. Null when the period is not MM/YY. */
  month: string | null;
  amountCzk: number | null;
  profitShareCzk: number | null;
  status: string | null;
  /** Tasks in Client Success > Clients this invoice points at. */
  clients: InvoiceRef[];
}

export interface InvoiceRead {
  state: SourceState;
  invoices: Invoice[];
}

function token(): string | null {
  const t = process.env.CLICKUP_API_TOKEN;
  return t ? t.trim().replace(/^["']|["']$/g, "") : null;
}

function stateOf(status: number): SourceState {
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "missing";
  return "error";
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

function refs(task: RawTask): InvoiceRef[] {
  const v = field(task, FIELD.invoiceClient)?.value;
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item)) return [];
    const o = item as { id: unknown; name?: unknown };
    return [{ id: String(o.id), name: typeof o.name === "string" ? o.name : null }];
  });
}

function periodOf(task: RawTask): string {
  const named = task.name.split("|")[1]?.trim();
  if (named) return named;
  const created = Number(task.date_created);
  if (!Number.isFinite(created)) return task.name;
  const d = new Date(created);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
}

/** "04/26" -> "2026-04-01". */
export function periodMonth(period: string): string | null {
  const m = period.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function statusOf(task: RawTask): string | null {
  const s = typeof task.status === "string" ? task.status : task.status?.status;
  return s ? s.toLowerCase() : null;
}

export async function readInvoices(): Promise<InvoiceRead> {
  const auth = token();
  if (!auth) return { state: "not_configured", invoices: [] };

  const tasks: RawTask[] = [];
  for (let page = 0; page < 5; page++) {
    try {
      const res = await fetch(
        `${API}/list/${INVOICE_LIST_ID}/task?include_closed=true&subtasks=false&page=${page}`,
        { headers: { Authorization: auth }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[home/ledger] ClickUp Invoice Tracker failed: ${res.status} ${body.slice(0, 300)}`);
        return { state: stateOf(res.status), invoices: [] };
      }
      const json = (await res.json()) as { tasks?: RawTask[]; last_page?: boolean };
      tasks.push(...(json.tasks ?? []));
      if (json.last_page !== false || (json.tasks ?? []).length === 0) break;
    } catch (error) {
      console.error(`[home/ledger] ClickUp Invoice Tracker unreachable: ${(error as Error)?.message ?? error}`);
      return { state: "error", invoices: [] };
    }
  }

  const invoices = tasks.map((t) => {
    const period = periodOf(t);
    return {
      taskId: t.id,
      name: t.name,
      period,
      month: periodMonth(period),
      amountCzk: money(t, FIELD.invoiceAmount),
      profitShareCzk: money(t, FIELD.profitShare),
      status: statusOf(t),
      clients: refs(t),
    };
  });
  return { state: invoices.length ? "ok" : "empty", invoices };
}
