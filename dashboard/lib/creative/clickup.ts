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
  // Trimmed, because the usual way this value gets set is by pasting it out of
  // Secret Manager or a file, and a trailing newline or a stray pair of quotes
  // turns every call into a 401 that reads like a permissions problem.
  return t.trim().replace(/^["']|["']$/g, "");
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

// ---------------------------------------------------------------------------
// Comments — the note thread on a creative
// ---------------------------------------------------------------------------

/**
 * ── Why the notes live in ClickUp and not in our own table ────────────────
 * Because that is where the conversation already is. The brief, the reviewer's
 * changes and the "this one is the winner, do six hooks off it" all get typed
 * on the ClickUp task, by people who do not open this dashboard. A second
 * comment box in a second system produces two half-threads and an argument
 * about which is current.
 *
 * So this reads and writes ClickUp's own thread. Verified against the live
 * workspace on 9 Sep 2026: `GET /task/{id}/comment` returns `comment_text`,
 * `user`, `date` and `reply_count`, and 4 of 25 Manami pipeline tasks already
 * carry comments.
 */
export interface CreativeNote {
  id: string;
  text: string;
  author: string;
  /** Epoch milliseconds, as ClickUp returns it (a string). */
  at: number;
  replies: number;
}

interface CommentsResponse {
  comments?: Array<{
    id: string;
    comment_text?: string;
    date?: string | number;
    reply_count?: string | number;
    user?: { username?: string; email?: string };
  }>;
}

export async function listNotes(taskId: string): Promise<CreativeNote[]> {
  const data = await call<CommentsResponse>(
    `/task/${encodeURIComponent(taskId)}/comment`
  );
  return (data.comments ?? []).map((c) => ({
    id: String(c.id),
    text: c.comment_text ?? "",
    // Falls back to the email's local part, then to a neutral label — a note
    // with no name attached is still worth showing, and "undefined" is not.
    author:
      c.user?.username ??
      c.user?.email?.split("@")[0] ??
      "someone",
    at: Number(c.date ?? 0),
    replies: Number(c.reply_count ?? 0),
  }));
}

/**
 * Post a note back onto the task.
 *
 * `notify_all: false` on purpose. A dashboard that pings the whole task's
 * watchers every time somebody jots an observation gets muted within a week,
 * and then the ClickUp notification stops meaning anything for the briefs too.
 *
 * The actor's email is prefixed into the body rather than passed as
 * `assignee`: the token is a workspace credential, so every comment would
 * otherwise be attributed to whoever owns it, and a thread where six people
 * appear as one is worse than no thread.
 */
export async function postNote(
  taskId: string,
  text: string,
  actorEmail: string
): Promise<void> {
  await call(`/task/${encodeURIComponent(taskId)}/comment`, {
    method: "POST",
    body: JSON.stringify({
      comment_text: `${actorEmail}: ${text}`,
      notify_all: false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Activity — what happened to this creative, and when
// ---------------------------------------------------------------------------

/**
 * ── What ClickUp will and will not tell us ────────────────────────────────
 * There is no audit-log endpoint on the v2 API, so a field-by-field history —
 * "Angle changed from X to Y" — is not available at any price. What is:
 *
 *   · the task's creation, with the person who created it
 *   · every status it has been in and how long it sat there
 *   · the comment thread, with authors and dates
 *   · when it was last touched
 *
 * That is enough to answer the question the panel is actually asked, which is
 * "what has happened to this creative and who did it", so it is what gets
 * drawn. The gap is stated in the UI rather than papered over.
 */
export interface TaskActivity {
  name: string | null;
  status: string | null;
  createdAt: number | null;
  createdBy: string | null;
  updatedAt: number | null;
  assignees: string[];
  /** In the order ClickUp reports them, earliest first. */
  statuses: Array<{ status: string; minutes: number; current: boolean }>;
}

interface TaskDetail {
  name?: string;
  date_created?: string | number;
  date_updated?: string | number;
  status?: { status?: string };
  creator?: { username?: string; email?: string };
  assignees?: Array<{ username?: string; email?: string }>;
}

interface TimeInStatus {
  current_status?: { status?: string; total_time?: { by_minute?: number } };
  status_history?: Array<{
    status?: string;
    orderindex?: number;
    total_time?: { by_minute?: number };
  }>;
}

const who = (u?: { username?: string; email?: string }) =>
  u?.username ?? u?.email?.split("@")[0] ?? null;

export async function getActivity(taskId: string): Promise<TaskActivity> {
  const id = encodeURIComponent(taskId);
  // Two calls, in parallel. `time_in_status` is a separate endpoint and the
  // panel wants both or neither.
  const [task, timing] = await Promise.all([
    call<TaskDetail>(`/task/${id}`),
    // A task that has only ever held one status returns no history, and that
    // is not a failure — it resolves to an empty list rather than taking the
    // whole tab down with it.
    call<TimeInStatus>(`/task/${id}/time_in_status`).catch(() => ({} as TimeInStatus)),
  ]);

  const history = (timing.status_history ?? [])
    .slice()
    .sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0))
    .map((h) => ({
      status: h.status ?? "—",
      minutes: Number(h.total_time?.by_minute ?? 0),
      current: false,
    }));

  const current = timing.current_status?.status;
  if (current) {
    const seen = history.find((h) => h.status === current);
    if (seen) seen.current = true;
    else
      history.push({
        status: current,
        minutes: Number(timing.current_status?.total_time?.by_minute ?? 0),
        current: true,
      });
  }

  return {
    name: task.name ?? null,
    status: task.status?.status ?? null,
    createdAt: task.date_created ? Number(task.date_created) : null,
    createdBy: who(task.creator),
    updatedAt: task.date_updated ? Number(task.date_updated) : null,
    assignees: (task.assignees ?? []).map(who).filter((n): n is string => Boolean(n)),
    statuses: history,
  };
}

// ---------------------------------------------------------------------------
// Is the credential actually working?
// ---------------------------------------------------------------------------

export interface ClickUpProbe {
  /** True only when ClickUp answered a real request. */
  ok: boolean;
  /** Whether the variable is set at all, which is a different failure. */
  configured: boolean;
  /** Who the token authenticates as, when it works. */
  user: string | null;
  /** What went wrong, in the words the person fixing it needs. */
  problem: string | null;
}

/**
 * One live call, to answer "is ClickUp working" without opening an ad.
 *
 * ── Why this is on the health page ────────────────────────────────────────
 * The Notes tab already reports each failure precisely, but only to somebody
 * who has opened an ad that happens to be mapped to a task — and most ads are
 * not mapped, so the far more common message there is "this ad has no task",
 * which looks identical to a broken integration from the outside. That gap is
 * how a rejected token went unnoticed: the panel said something reasonable on
 * every ad anybody clicked.
 *
 * `GET /user` is the cheapest call that distinguishes all four states — not
 * set, set but rejected, set and valid, and ClickUp itself being down — and it
 * touches no task, so it works on a deployment where nothing is mapped yet.
 *
 * The token's own identity is reported because a workspace credential that
 * belongs to somebody who has left is valid right up to the day it is not.
 */
export async function probeClickUp(): Promise<ClickUpProbe> {
  if (!clickUpConfigured()) {
    return {
      ok: false,
      configured: false,
      user: null,
      problem:
        "CLICKUP_API_TOKEN is not set on this deployment. Creative notes and " +
        "activity are unavailable until it is.",
    };
  }

  try {
    const data = await call<{ user?: { username?: string; email?: string } }>("/user");
    return {
      ok: true,
      configured: true,
      user: who(data.user) ?? null,
      problem: null,
    };
  } catch (error) {
    if (error instanceof ClickUpError) {
      return {
        ok: false,
        configured: true,
        user: null,
        problem:
          error.status === 401
            ? "ClickUp rejected the token (401). The variable is set but the " +
              "value is not accepted — re-set it from Secret Manager " +
              "(clickup-api-token), then redeploy: an environment change does " +
              "not reach a build that already exists."
            : `ClickUp refused the request (${error.status}).`,
      };
    }
    return {
      ok: false,
      configured: true,
      user: null,
      problem: `Could not reach ClickUp: ${(error as Error).message}`,
    };
  }
}
