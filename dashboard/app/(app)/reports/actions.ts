"use server";

/**
 * Report mutations (design 3.3, work package RS4).
 *
 * Server actions are individually addressable POST endpoints: the page they
 * were rendered from is not a gate, so each action opens with
 * assertReportsAccess() (admin or agency on an internal domain, never the
 * client role). It throws "Not authorised." and that error is deliberately
 * NOT turned into a result.
 *
 * Every argument is untrusted: it is parsed with zod before the store sees it.
 * Ownership and edit permission are enforced inside the store's guarded
 * UPDATE (one atomic statement, see lib/reports/store.ts), not in a separate
 * read here, so there is no check-then-act gap. The store also calls
 * assertReportsAccess() itself, so the gate is checked twice per write; the
 * second call is the defence in depth of design 3.1 point 5.
 *
 * Results are { ok: true, version, ...} or { ok: false, code, message?, version? }.
 * A "conflict" carries the current server version so the client can reload.
 * Unexpected errors (database down, bug) are logged and returned as
 * { ok: false, code: "invalid", message: "Could not save" }, never thrown with
 * details to the browser.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { assertReportsAccess } from "@/lib/authz";
import type { ActionResult, NewWidget, TemplateKey } from "@/lib/reports/contracts";
import { TEMPLATE_KEYS } from "@/lib/reports/contracts";
import { CACHE_TAGS, REFRESH_RATE_LIMIT_MS } from "@/lib/reports/limits";
import * as store from "@/lib/reports/store";
import { ExpectedVersion, LayoutItems, NewWidgetInput, ReportId } from "@/lib/reports/store";
import { ReportFilters, ReportName, Visibility, WidgetConfig, type LayoutItem } from "@/lib/reports/types";

type Failure = Extract<ActionResult, { ok: false }>;

const invalid = (message: string): Failure => ({ ok: false, code: "invalid", message });

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input";
}

/** Parses `value` or returns the failure to hand back. */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): { ok: true; data: z.infer<S> } | { ok: false; failure: Failure } {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, data: result.data } : { ok: false, failure: invalid(firstIssue(result.error)) };
}

/** Runs a store call. The access error propagates; anything else becomes a generic failure. */
async function attempt<T extends object>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.message === "Not authorised.") throw error;
    console.error("[reports] action failed", error);
    return invalid("Could not save");
  }
}

/** Refreshes the report list after a write that changes it. */
function listChanged<T extends object>(result: ActionResult<T>): ActionResult<T> {
  if (result.ok) revalidatePath("/reports");
  return result;
}

const CreateInput = z.object({
  name: ReportName,
  templateKey: z.enum(TEMPLATE_KEYS).optional(),
});

export async function createReport(input: { name: string; templateKey?: TemplateKey }): Promise<ActionResult<{ id: string }>> {
  await assertReportsAccess();
  const p = parse(CreateInput, input);
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.createReport({ name: p.data.name, templateKey: p.data.templateKey })));
}

export async function renameReport(id: string, name: string): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, name: ReportName }), { id, name });
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.renameReport(p.data.id, p.data.name)));
}

export async function duplicateReport(id: string): Promise<ActionResult<{ id: string }>> {
  await assertReportsAccess();
  const p = parse(ReportId, id);
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.duplicateReport(p.data)));
}

/** Soft delete, owner only. */
export async function deleteReport(id: string): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(ReportId, id);
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.deleteReport(p.data)));
}

export async function restoreReport(id: string): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(ReportId, id);
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.restoreReport(p.data)));
}

/** Owner only. */
export async function setVisibility(id: string, visibility: "private" | "team_view" | "team_edit"): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, visibility: Visibility }), { id, visibility });
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.setVisibility(p.data.id, p.data.visibility)));
}

export async function saveReportFilters(id: string, expectedVersion: number, filters: ReportFilters): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, v: ExpectedVersion, filters: ReportFilters }), { id, v: expectedVersion, filters });
  if (!p.ok) return p.failure;
  return attempt(() => store.saveReportFilters(p.data.id, p.data.v, p.data.filters));
}

export async function saveLayout(id: string, expectedVersion: number, items: LayoutItem[]): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, v: ExpectedVersion, items: LayoutItems }), { id, v: expectedVersion, items });
  if (!p.ok) return p.failure;
  return attempt(() => store.saveLayout(p.data.id, p.data.v, p.data.items));
}

export async function addWidget(id: string, expectedVersion: number, widget: NewWidget): Promise<ActionResult<{ widgetId: string }>> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, v: ExpectedVersion, widget: NewWidgetInput }), { id, v: expectedVersion, widget });
  if (!p.ok) return p.failure;
  return attempt(() => store.addWidget(p.data.id, p.data.v, p.data.widget as NewWidget));
}

export async function updateWidget(id: string, expectedVersion: number, widgetId: string, config: WidgetConfig): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, v: ExpectedVersion, widgetId: ReportId, config: WidgetConfig }), {
    id,
    v: expectedVersion,
    widgetId,
    config,
  });
  if (!p.ok) return p.failure;
  return attempt(() => store.updateWidget(p.data.id, p.data.v, p.data.widgetId, p.data.config));
}

export async function removeWidget(id: string, expectedVersion: number, widgetId: string): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, v: ExpectedVersion, widgetId: ReportId }), { id, v: expectedVersion, widgetId });
  if (!p.ok) return p.failure;
  return attempt(() => store.removeWidget(p.data.id, p.data.v, p.data.widgetId));
}

export async function pinReport(id: string, pinned: boolean): Promise<ActionResult> {
  await assertReportsAccess();
  const p = parse(z.object({ id: ReportId, pinned: z.boolean() }), { id, pinned });
  if (!p.ok) return p.failure;
  return listChanged(await attempt(() => store.pinReport(p.data.id, p.data.pinned)));
}

/** Fire and forget: the client does not await it, and a bad id is ignored. */
export async function touchOpened(id: string): Promise<void> {
  await assertReportsAccess();
  const p = parse(ReportId, id);
  if (!p.ok) return;
  try {
    await store.touchOpened(p.data);
  } catch (error) {
    if (error instanceof Error && error.message === "Not authorised.") throw error;
    console.error("[reports] touchOpened failed", error);
  }
}

/**
 * Drops the cached report data (tag "reports"). One call per user per
 * REFRESH_RATE_LIMIT_MS. The window lives in this lambda's memory, so it is a
 * brake against a held-down button, not a hard quota.
 */
const lastRefresh = new Map<string, number>();

export async function refreshReportData(): Promise<ActionResult> {
  const access = await assertReportsAccess();
  const key = access.email.trim().toLowerCase();
  const now = Date.now();
  const last = lastRefresh.get(key);
  if (last !== undefined && now - last < REFRESH_RATE_LIMIT_MS) return invalid("Refreshed just now");
  for (const [k, t] of lastRefresh) if (now - t >= REFRESH_RATE_LIMIT_MS) lastRefresh.delete(k);
  lastRefresh.set(key, now);
  revalidateTag(CACHE_TAGS.data);
  return { ok: true, version: 0 };
}
