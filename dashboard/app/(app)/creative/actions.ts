"use server";

/**
 * Server actions for the Creative Engine.
 *
 * Mutations only, plus the one on-demand read the ad detail panel needs.
 * Deliberately not API routes, matching the rest of this app: an action is
 * typed end to end and cannot be called without a session, where a route
 * handler is a public URL that has to remember to check.
 *
 * ── Every action re-resolves the client server-side ────────────────────────
 * None of these trust the `clientId` the browser sends. `resolveClient` reads
 * the role from the server-verified session and pins a client-role account to
 * its own client whatever the argument says. Skipping that here would leave a
 * hole exactly where the rest of the app closed one: the pages are confined,
 * and an action that was not would be the way around them.
 */

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClients, resolveClient } from "@/lib/clients";
import { getAdBreakdowns, type AdBreakdowns } from "@/lib/queries/creative";
import {
  appendCreativeId,
  clickUpConfigured,
  ClickUpError,
  ClickUpNotConfigured,
  listNotes,
  postNote,
  type CreativeNote,
} from "@/lib/creative/clickup";
import { recordDecision, recordMapping } from "@/lib/creative/store";
import { recordAccess } from "@/lib/users/accessLog";

async function actor(): Promise<{ email: string; role: string }> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const role = session?.user?.role;
  if (!email || (role !== "admin" && role !== "agency")) {
    throw new Error("Not permitted.");
  }
  return { email, role };
}

async function client(requested: string) {
  const all = await getClients();
  return resolveClient(requested, all);
}

// ---------------------------------------------------------------------------
// Breakdowns, on demand
// ---------------------------------------------------------------------------

/**
 * Fetched when the panel opens rather than with the grid.
 *
 * Forty ads' age and placement splits is forty times twenty rows of data
 * nobody has asked to see. Loading it up front would put a second or two on
 * every visit to the Creatives screen to populate a panel most visits never
 * open.
 */
export async function loadBreakdowns(
  clientId: string,
  adId: string
): Promise<AdBreakdowns> {
  await actor();
  const c = await client(clientId);
  return getAdBreakdowns(c.clientId, adId);
}

// ---------------------------------------------------------------------------
// The unmapped queue
// ---------------------------------------------------------------------------

export interface ConfirmResult {
  ok: boolean;
  message: string;
}

/**
 * Confirm a proposed match: write the Meta ad id into the ClickUp task.
 *
 * ── Order of operations, and why it is not the other way round ─────────────
 * ClickUp first, local record second. If the ClickUp write fails, nothing has
 * changed anywhere and the ad stays in the queue — which is correct, because
 * the alternative is a dashboard that believes a mapping exists while ClickUp
 * does not, and the disagreement would only surface as a persistently
 * "untagged" ad that the queue no longer offers.
 *
 * The write appends rather than replaces. Post-ID graduation gives one creative
 * a second ad_id and both belong to the same task; overwriting would silently
 * detach whichever was mapped first.
 */
export async function confirmMapping(input: {
  clientId: string;
  adId: string;
  taskId: string;
  method: string;
  confidence: number | null;
}): Promise<ConfirmResult> {
  const { email, role } = await actor();
  const c = await client(input.clientId);

  if (!clickUpConfigured()) {
    return {
      ok: false,
      message:
        "CLICKUP_API_TOKEN is not set on this deployment, so the ad id cannot " +
        "be written back. Nothing was changed.",
    };
  }

  try {
    const result = await appendCreativeId(input.taskId, input.adId);

    await recordMapping(
      c.clientId,
      {
        adId: input.adId,
        clickupTaskId: input.taskId,
        method: input.method,
        confidence: input.confidence,
      },
      email
    );

    // The ClickUp token is a workspace-wide WRITE credential. Every use of it
    // is recorded with the person who caused it — the same standard the
    // cross-client read log holds itself to.
    await recordAccess({
      email,
      role,
      event: "view",
      clientId: c.clientId,
      detail: `clickup write: ad ${input.adId} -> task ${input.taskId} (${input.method})`,
    });

    revalidatePath("/creative");

    return {
      ok: true,
      message: result.alreadyPresent
        ? "That ad id was already on the task. Nothing was sent."
        : `Written to ClickUp. The task now carries ${result.ids.length} ad ${result.ids.length === 1 ? "id" : "ids"}.`,
    };
  } catch (error) {
    if (error instanceof ClickUpNotConfigured) {
      return { ok: false, message: error.message };
    }
    if (error instanceof ClickUpError) {
      // Surfaced verbatim rather than softened. A 401 here means the token is
      // wrong and a 404 means the task moved, and those need different fixes.
      return {
        ok: false,
        message: `ClickUp refused the write (${error.status}). Nothing was changed. ${error.body}`,
      };
    }
    console.error("[creative] write-back failed", error);
    return {
      ok: false,
      message: "The write failed and nothing was changed. See the server log.",
    };
  }
}

// ---------------------------------------------------------------------------
// The decisions log
// ---------------------------------------------------------------------------

export interface LogResult {
  ok: boolean;
  message: string;
}

/**
 * Record what a human actually decided.
 *
 * A kill without a learning note is rejected by a CHECK constraint in Postgres,
 * not by a branch here. That is the point: a UI-only rule is a suggestion, and
 * it is bypassed by the next code path, by a script, and by whoever adds a
 * second kill button. The error below is a translation of the database's
 * refusal into a sentence, never a substitute for it.
 */
export async function logDecision(input: {
  clientId: string;
  level: "adset" | "concept" | "ad";
  entityId: string;
  entityName: string | null;
  computedVerdict: string;
  finalVerdict: string;
  overrideReason: string | null;
  learningNote: string | null;
  spend: number | null;
  purchases: number | null;
  roas: number | null;
  ciLow: number | null;
  ciHigh: number | null;
}): Promise<LogResult> {
  const { email } = await actor();
  const c = await client(input.clientId);

  try {
    await recordDecision({
      clientId: c.clientId,
      level: input.level,
      entityId: input.entityId,
      entityName: input.entityName,
      reviewDate: new Date().toISOString().slice(0, 10),
      computedVerdict: input.computedVerdict,
      finalVerdict: input.finalVerdict,
      overrideReason: input.overrideReason,
      learningNote: input.learningNote,
      spend: input.spend,
      purchases: input.purchases,
      roas: input.roas,
      ciLow: input.ciLow,
      ciHigh: input.ciHigh,
      decidedBy: email,
    });

    revalidatePath("/creative/concepts");
    return { ok: true, message: "Decision logged." };
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (message.includes("kill_needs_a_learning_note")) {
      return {
        ok: false,
        message:
          "A kill needs a learning note of at least ten characters. The SOP " +
          "says a kill without a documented learning is invalid, and the " +
          "database enforces it.",
      };
    }
    if (message.includes("override_needs_a_reason")) {
      return {
        ok: false,
        message:
          "Overriding the engine is allowed; doing it silently is not. Give a reason.",
      };
    }
    console.error("[creative] could not log decision", error);
    return { ok: false, message: "Could not record the decision." };
  }
}

// ---------------------------------------------------------------------------
// Notes — the ClickUp thread, in the panel
// ---------------------------------------------------------------------------

export interface NotesResult {
  notes: CreativeNote[];
  /** Why there is nothing to show, when there is nothing to show. */
  unavailable: string | null;
}

/**
 * Read the note thread for one creative.
 *
 * Loaded on demand rather than with the panel: most opens are to look at a
 * number, and a ClickUp round trip on every one of them would put a second on
 * the whole screen for a tab nobody clicked.
 *
 * Every failure resolves to a message rather than an exception. A creative
 * with no ClickUp task, a workspace without a token, a task deleted since the
 * last sync — none of those are errors worth taking the panel down for, and
 * each wants a different sentence.
 */
export async function loadNotes(taskId: string | null): Promise<NotesResult> {
  await actor();
  if (!taskId) {
    return {
      notes: [],
      unavailable:
        "This ad is not mapped to a ClickUp task yet, so it has no thread. Map it in the unmapped queue and the notes appear here.",
    };
  }
  if (!clickUpConfigured()) {
    return {
      notes: [],
      unavailable: "CLICKUP_API_TOKEN is not set on this deployment.",
    };
  }
  try {
    return { notes: await listNotes(taskId), unavailable: null };
  } catch (error) {
    if (error instanceof ClickUpNotConfigured) {
      return { notes: [], unavailable: error.message };
    }
    if (error instanceof ClickUpError) {
      return {
        notes: [],
        unavailable: `ClickUp refused the request (${error.status}). The task may have been deleted.`,
      };
    }
    throw error;
  }
}

/**
 * Add a note, onto the ClickUp task itself.
 *
 * Returns the reloaded thread rather than just an ok, so the panel shows the
 * comment as ClickUp actually stored it — including the author prefix — rather
 * than a local echo that might not match what everyone else will see.
 */
export async function addNote(input: {
  clientId: string;
  taskId: string;
  text: string;
}): Promise<{ ok: boolean; message: string; notes: CreativeNote[] }> {
  const who = await actor();
  const c = await client(input.clientId);

  const text = input.text.trim();
  if (!text) return { ok: false, message: "Nothing to post.", notes: [] };

  try {
    await postNote(input.taskId, text, who.email);
  } catch (error) {
    const message =
      error instanceof ClickUpNotConfigured || error instanceof ClickUpError
        ? error.message
        : "Could not reach ClickUp.";
    return { ok: false, message, notes: [] };
  }

  await recordAccess({
    email: who.email,
    role: who.role,
    event: "view",
    clientId: c.clientId,
    detail: `clickup note: task ${input.taskId}`,
  });
  revalidatePath("/creative");

  return {
    ok: true,
    message: "Posted to ClickUp.",
    notes: await listNotes(input.taskId),
  };
}
