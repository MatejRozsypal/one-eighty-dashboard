/**
 * POST /api/reports/query: one widget's data for the Reports builder (design 3.2).
 *
 * The single, deliberate exception to "no data API routes" (TENANCY section 4):
 * Next 14 runs server actions from one client one at a time, so a 10-widget
 * report would load in sequence, and the builder has to refetch one widget
 * without re-rendering the page.
 *
 * Why it is safe:
 *   - The gate runs first, before the body is read or any cache is touched.
 *     Admin and agency roles on an internal domain only (lib/authz.ts).
 *   - Everyone else gets 404 with an empty body, never 401 or 403, and every
 *     other method answers 404 too (Next would otherwise answer 405 and an
 *     OPTIONS listing "POST"), so a refused caller learns nothing about what
 *     exists. The same 404 covers a report id that is missing, deleted or
 *     private to someone else, so report ids cannot be probed either.
 *   - The body is untrusted: size-capped, then zod-parsed against
 *     ReportQueryRequest. Metric ids are a closed enum, client ids and
 *     verticals are slugs intersected with the active registry, and no user
 *     text ever reaches SQL (compile.ts builds SQL from registry constants;
 *     user values travel as typed params).
 *   - The lib functions on the path (clients, run, benchmarks) re-check the
 *     gate themselves, so this handler is not the only line of defence.
 *   - `Cache-Control: private, no-store` on every response: never in a CDN or
 *     the browser HTTP cache. Server-side caches hold role-independent results
 *     and are only read after the gate.
 *
 * Flow: gate (404) -> parse (400) -> report visibility (404) -> clients ->
 * resolve (413) -> compile -> run (422 / 504 / 500) -> benchmarks and stated
 * cost rates -> evaluate -> access log -> 200.
 *
 * Stated cost rates (CM3 and CM1 parity with Snapshot): read from Postgres
 * `client_settings` per request, only when a metric of the widget needs one,
 * and merged into the widget's clients as `costRates`. They never reach SQL,
 * so cached rows stay valid and a Settings edit applies on the next request.
 */

import { reportsAccessOrNull, type Access } from "@/lib/authz";
import { recordAccess } from "@/lib/users/accessLog";
import { getReportClients } from "@/lib/reports/clients";
import { getBenchmarks } from "@/lib/reports/benchmarks";
import { resolveWidget } from "@/lib/reports/resolve";
import { compileWidget } from "@/lib/reports/compile";
import { runCached } from "@/lib/reports/run";
import { evaluateWidget } from "@/lib/reports/evaluate";
import { getReport } from "@/lib/reports/store";
import { getComponent } from "@/lib/reports/registry/components";
import type { ComponentId, ReportClient } from "@/lib/reports/registry/types";
import { listClientSettings } from "@/lib/users/settings";
import {
  isReportsError,
  type CompileWidget,
  type EvaluateWidget,
  type GetBenchmarks,
  type GetReportClients,
  type ReportStore,
  type ResolveWidget,
  type RunCached,
} from "@/lib/reports/contracts";
import {
  REPORT_ERROR_STATUS,
  ReportQueryRequest,
  type ReportErrorBody,
  type ReportErrorCode,
} from "@/lib/reports/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds. Literal on purpose: Next reads segment config statically. Same value as ROUTE_MAX_DURATION_S. */
export const maxDuration = 30;

// Each dependency is bound through its contract type, so a signature that
// drifts in WP1, WP2 or WP4 fails the build here rather than at runtime.
const clientsFn: GetReportClients = getReportClients;
const resolveFn: ResolveWidget = resolveWidget;
const compileFn: CompileWidget = compileWidget;
const runFn: RunCached = runCached;
const benchmarksFn: GetBenchmarks = getBenchmarks;
const evaluateFn: EvaluateWidget = evaluateWidget;
const getReportFn: ReportStore["getReport"] = getReport;

/** A request body is a few hundred bytes; anything far larger is not a widget query. */
const MAX_BODY_BYTES = 32 * 1024;

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

function fail(code: Exclude<ReportErrorCode, "not_found" | "forbidden">, body: Omit<ReportErrorBody, "code"> = {}): Response {
  const payload: ReportErrorBody = { code, ...body };
  return Response.json(payload, { status: REPORT_ERROR_STATUS[code], headers: NO_STORE });
}

// ---------------------------------------------------------------------------
// Access log: one "view" row per client whose data was read
// ---------------------------------------------------------------------------

/**
 * A widget query is the only place that sees every read of client data
 * through Reports, including ad-hoc queries that never open a saved report,
 * so the audit row is written here. One row per client (client_id set), so
 * listAccessLog({ clientId }) answers "who saw this client" for Reports too.
 *
 * Deduplicated per lambda for 10 minutes on (email, report, clients, range):
 * a report open fires several widget queries over the same clients and
 * period, and repeating identical rows adds noise, not evidence. The log is
 * evidence, not enforcement (lib/users/accessLog.ts): recordAccess never
 * throws.
 */
const AUDIT_DEDUPE_MS = 10 * 60 * 1000;
const globalForAudit = globalThis as unknown as { oeReportsAudit?: Map<string, number> };

async function auditRead(access: Access, reportId: string | undefined, clientIds: readonly string[], range: string): Promise<void> {
  if (clientIds.length === 0) return;
  const seen = (globalForAudit.oeReportsAudit ??= new Map());
  const now = Date.now();
  const key = [access.email.toLowerCase(), reportId ?? "adhoc", clientIds.join(","), range].join("|");
  const last = seen.get(key);
  if (last !== undefined && now - last < AUDIT_DEDUPE_MS) return;
  seen.set(key, now);
  if (seen.size > 2000) {
    for (const [k, at] of seen) if (now - at >= AUDIT_DEDUPE_MS) seen.delete(k);
  }
  const detail = `report:${reportId ?? "adhoc"} clients=${clientIds.join(",")} range=${range}`;
  await Promise.all(
    clientIds.map((clientId) => recordAccess({ email: access.email, role: access.role, event: "view", clientId, detail }))
  );
}

// ---------------------------------------------------------------------------
// Stated cost rates
// ---------------------------------------------------------------------------

type CostRates = NonNullable<ReportClient["costRates"]>;

/**
 * Per-order rates stated in Settings for the given clients, or null when no
 * component of the widget needs one. A failed read leaves every rate unstated
 * (0), the same fallback as Snapshot (`optional(getClientSettings)`), and is
 * logged.
 */
async function statedRates(componentIds: readonly ComponentId[], clientIds: readonly string[]): Promise<Map<string, CostRates> | null> {
  if (!componentIds.some((id) => getComponent(id).perClientRate !== undefined)) return null;
  const wanted = new Set(clientIds);
  try {
    const rows = await listClientSettings();
    const out = new Map<string, CostRates>();
    for (const r of rows) {
      if (wanted.has(r.clientId)) out.set(r.clientId, { fulfilment: r.fulfilmentPerOrder, otherCm1: r.otherCm1PerOrder });
    }
    return out;
  } catch (error) {
    console.warn("[reports] client_settings unreadable, stated cost rates count as 0", error instanceof Error ? error.message : "");
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // 1. Gate. Nothing below runs, and nothing is read, for a refused caller.
  const access = await reportsAccessOrNull();
  if (!access) return notFound();

  // 2. Body: size cap, JSON, zod.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail("invalid", { message: "Unreadable body" });
  }
  if (raw.length > MAX_BODY_BYTES) return fail("invalid", { message: "Body too large" });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("invalid", { message: "Invalid JSON" });
  }

  const parsed = ReportQueryRequest.safeParse(json);
  if (!parsed.success) {
    return fail("invalid", {
      message: "Invalid query",
      issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path, message: i.message })),
    });
  }
  const body = parsed.data;

  try {
    // 3. A named report must be visible to this user (owner, or not private).
    if (body.reportId) {
      const report = await getReportFn(body.reportId);
      if (!report || !report.permissions.canView) return notFound();
    }

    // 4. Resolve against the active registry. Unknown client ids are dropped here.
    const clients = await clientsFn();
    const resolved = resolveFn({ filters: body.filters, query: body.query, clients });
    if (!resolved.ok) {
      return fail("too_large", { message: resolved.error.message, suggestion: resolved.error.suggestion });
    }
    const widget = resolved.widget;

    // 5. Compile and run. Benchmarks and stated cost rates load in parallel.
    const compiled = compileFn(widget);
    const [run, benchmarks, rates] = await Promise.all([
      runFn(compiled, { rangeTo: widget.period.current.to, userEmail: access.email, widgetType: body.widgetType }),
      benchmarksFn(widget),
      statedRates(widget.components, widget.clients.map((c) => c.id)),
    ]);

    // 6. Evaluate in TypeScript from the summed components. Rates go into the
    // clients only now: they are not part of the compiled SQL or its key.
    const evaluated = rates === null ? widget : { ...widget, clients: widget.clients.map((c) => ({ ...c, costRates: rates.get(c.id) ?? {} })) };
    const result = evaluateFn({
      widget: evaluated,
      rows: run.rows,
      benchmarks,
      run: { key: compiled.key, cached: run.cached, generatedAt: run.generatedAt },
    });

    const range = `${widget.period.current.from}..${widget.period.current.to}`;
    await auditRead(access, body.reportId, widget.queryClientIds, range);

    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    return mapError(error, access);
  }
}

function mapError(error: unknown, access: Access): Response {
  if (isReportsError(error)) {
    switch (error.code) {
      case "not_found":
      case "forbidden":
        return notFound();
      case "invalid":
      case "too_large":
      case "over_budget":
      case "timeout":
        if (error.code !== "invalid") console.warn(`[reports] ${error.code} for ${access.email}`, error.cause ?? "");
        return fail(error.code, { message: error.message, suggestion: error.suggestion });
      case "conflict":
      case "warehouse_error":
        break;
    }
  }
  // The session changed between the gate and a lib-level assert (role revoked
  // mid-request): same answer as the gate.
  if (error instanceof Error && error.message === "Not authorised.") return notFound();

  // Permission and other warehouse errors: a 500 with a fixed message, never
  // an empty state and never the BigQuery text.
  console.error("[reports] query failed", error);
  return fail("warehouse_error", { message: "Warehouse error" });
}

/**
 * Every other method answers exactly like a refused POST. Without these, Next
 * answers 405 and an automatic OPTIONS lists "OPTIONS, POST", which would
 * confirm the route exists to anyone, signed in or not. HEAD maps to GET.
 */
async function hidden(): Promise<Response> {
  return notFound();
}
export const GET = hidden;
export const PUT = hidden;
export const PATCH = hidden;
export const DELETE = hidden;
export const OPTIONS = hidden;
