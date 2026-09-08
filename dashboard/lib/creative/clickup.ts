import "server-only";

/**
 * ClickUp write-back — the step that makes the join fill itself.
 *
 * ── Why the dashboard writes and the workflow does not ─────────────────────
 * Every other integration in this repo is one-directional: n8n reads, BigQuery
 * stores, the dashboard renders. This is the exception, and it is a deliberate
 * one. The `Creative ID` field is the authoritative join between a Meta ad and
 * the concept that produced it, and today it holds the literal string
 * "Creative ID" on all 65 Manami tasks — it has never been filled once. Asking
 * a human to copy eighteen-digit ad ids out of Ads Manager is asking for a
 * field that stays empty forever, and the whole product rests on it.
 *
 * So the dashboard proposes a match, a person presses Confirm, and this writes
 * the id back. From then on the sync resolves that ad at full confidence and
 * the fuzzy matcher is never consulted for it again.
 *
 * ── Rules, in the order they matter ────────────────────────────────────────
 * 1. APPEND, never overwrite. Post-ID graduation gives one creative a second
 *    ad_id — the original in its test ad set, the duplicate in Scale — and both
 *    belong to the same task. Overwriting silently detaches whichever one was
 *    mapped first, and the spend it carries then reads as untagged.
 * 2. ClickUp first, local record second. If the write fails, nothing changes
 *    anywhere, so the two systems cannot disagree about what happened.
 * 3. The token is a workspace-wide WRITE credential. It never leaves the
 *    server, never appears in a client component, and never lives in a
 *    NEXT_PUBLIC_ variable.
 */

/** Space-level, shared across clients. Verified against the workspace 8 Sep 2026. */
export const CREATIVE_ID_FIELD = "a80bdd5a-b4e5-4e70-81ce-0be80d57b768";

const API = "https://api.clickup.com/api/v2";

export class ClickUpNotConfigured extends Error {
  constructor() {
    super(
      "CLICKUP_API_TOKEN is not set, so the dashboard cannot write the ad id " +
        "back to ClickUp. Add it to the Vercel project's environment."
    );
    this.name = "ClickUpNotConfigured";
  }
}

export class ClickUpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = "ClickUpError";
  }
}

export function clickUpConfigured(): boolean {
  return Boolean(process.env.CLICKUP_API_TOKEN);
}

function token(): string {
  const t = process.env.CLICKUP_API_TOKEN;
  if (!t) throw new ClickUpNotConfigured();
  return t;
}

/**
 * ClickUp personal tokens are sent bare.
 *
 * `Authorization: pk_...` with NO `Bearer` prefix. Adding one returns
 * OAUTH_019, which reads like a scope problem rather than a header problem and
 * sends you looking in the wrong place.
 */
function headers(): HeadersInit {
  return {
    Authorization: token(),
    "Content-Type": "application/json",
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: headers(),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ClickUpError(
      `ClickUp ${init?.method ?? "GET"} ${path} failed: ${res.status}`,
      res.status,
      body.slice(0, 400)
    );
  }
  return (await res.json()) as T;
}

interface TaskResponse {
  id: string;
  name: string;
  url: string;
  custom_fields?: Array<{ id: string; name: string; value?: unknown }>;
}

/** Read one task, so the current `Creative ID` value can be appended to. */
export async function getTask(taskId: string): Promise<TaskResponse> {
  return call<TaskResponse>(`/task/${encodeURIComponent(taskId)}`);
}

/**
 * The ad ids already on a task, cleaned.
 *
 * Two things are stripped. The placeholder — a value equal to the field's own
 * name — is a label somebody typed over, not data. And anything that is not a
 * long run of digits is a note, not a Meta ad id; letting one through would
 * create a phantom ad that joins to nothing and shows up in every breakdown as
 * an untagged row nobody can trace.
 */
export function parseCreativeIds(value: unknown, fieldName = "Creative ID"): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== fieldName && /^\d{6,}$/.test(s));
}

export interface WriteBackResult {
  taskId: string;
  /** Ids on the field after the write. */
  ids: string[];
  /** True when the ad id was already there and nothing was sent. */
  alreadyPresent: boolean;
}

/**
 * Append one Meta ad id to a task's `Creative ID` field.
 *
 * Reads first, appends, writes the whole list back — ClickUp's field endpoint
 * replaces the value rather than merging, so the merge has to happen here.
 * There is a small race if two people confirm different ads on the same task in
 * the same second; the loser's id is lost and reappears in the queue on the
 * next sync, which is the correct failure. Locking a ClickUp field to close
 * that window would cost far more than the window is worth.
 */
export async function appendCreativeId(
  taskId: string,
  adId: string,
  fieldId: string = CREATIVE_ID_FIELD
): Promise<WriteBackResult> {
  if (!/^\d{6,}$/.test(adId)) {
    throw new Error(`Refusing to write "${adId}" — that is not a Meta ad id.`);
  }

  const task = await getTask(taskId);
  const field = task.custom_fields?.find((f) => f.id === fieldId);
  const existing = parseCreativeIds(field?.value, field?.name ?? "Creative ID");

  if (existing.includes(adId)) {
    return { taskId, ids: existing, alreadyPresent: true };
  }

  const ids = [...existing, adId];
  await call(`/task/${encodeURIComponent(taskId)}/field/${fieldId}`, {
    method: "POST",
    body: JSON.stringify({ value: ids.join(",") }),
  });

  return { taskId, ids, alreadyPresent: false };
}
