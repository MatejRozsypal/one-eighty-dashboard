import "server-only";

/**
 * Report persistence (Postgres, lazy DDL). Design 4.1, work package RS4.
 *
 * Follows lib/goals/store.ts: its own ensureTable(), never added to the shared
 * ensureSchema (a DDL mistake there locks everyone out of sign-in), and the
 * race errors 23505, 42P07 and 42710 count as success. Emails are stored
 * lower-cased.
 *
 * Access: every exported function calls assertReportsAccess() first and acts
 * as that user. None takes the actor as a parameter, so a future page for
 * client-role users that imports this module by mistake fails closed.
 *
 * Concurrency: every versioned write is ONE guarded UPDATE on `reports`
 * (id, not deleted, version matches, caller may edit) that bumps `version`.
 * Zero rows means the write did not happen; classify() then reads the row once
 * to say why: not_found, forbidden or conflict (with the current version).
 * Multi-row writes run that UPDATE first inside withTransaction(), so the row
 * lock serialises concurrent editors and a failure rolls everything back.
 *
 * Testability: the logic lives in createReportStore(deps). The module-level
 * exports bind it to the real pool; scripts/check-reports-store.ts binds it
 * to an in-memory fake. Each statement starts with a "reports.<op>" comment
 * tag so a fake can dispatch on it and slow-query logs name the operation.
 */

import { z } from "zod";
import { assertReportsAccess, type Access } from "@/lib/authz";
import { pool, sql, userStoreConfigured } from "@/lib/users/db";
import { recordAccess } from "@/lib/users/accessLog";
import { TEMPLATE_KEYS, type NewWidget, type ReportListItem, type ReportMeta, type ReportPermissions, type ReportStore, type StoredWidget, type StoreFailureCode, type StoreResult, type TemplateKey } from "./contracts";
import { GRID, MAX_REPORT_NAME, MAX_WIDGETS_PER_REPORT } from "./limits";
import { getTemplate } from "./templates";
import {
  DEFAULT_REPORT_FILTERS,
  LayoutItem,
  ReportFilters,
  ReportName,
  Visibility,
  WIDGET_TYPES,
  WidgetConfig,
  type ReportFilters as ReportFiltersT,
  type WidgetType,
} from "./types";

// ---------------------------------------------------------------------------
// DDL (design 4.1)
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  owner_email     TEXT NOT NULL,
  visibility      TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'team_view', 'team_edit')),
  filters         JSONB NOT NULL,
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  version         INTEGER NOT NULL DEFAULT 1,
  template_key    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT NOT NULL,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reports_owner_idx
  ON reports (owner_email, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_team_idx
  ON reports (updated_at DESC) WHERE deleted_at IS NULL AND visibility <> 'private';

CREATE TABLE IF NOT EXISTS report_widgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('kpi', 'line', 'bar', 'table', 'ranked', 'scatter')),
  config      JSONB NOT NULL,
  x           SMALLINT NOT NULL CHECK (x BETWEEN 0 AND 11),
  y           SMALLINT NOT NULL CHECK (y BETWEEN 0 AND 999),
  w           SMALLINT NOT NULL CHECK (w BETWEEN 1 AND 12),
  h           SMALLINT NOT NULL CHECK (h BETWEEN 2 AND 24),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_widgets_fits_grid CHECK (x + w <= 12)
);
CREATE INDEX IF NOT EXISTS report_widgets_report_idx ON report_widgets (report_id);

CREATE TABLE IF NOT EXISTS report_user_state (
  user_email      TEXT NOT NULL,
  report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  pin_position    SMALLINT NOT NULL DEFAULT 0,
  last_opened_at  TIMESTAMPTZ,
  PRIMARY KEY (user_email, report_id)
);
`;

const globalForReports = globalThis as unknown as { oeReportsReady?: Promise<boolean> };

/** Resolves false when the user store is not configured or the DDL failed. Failures are not cached. */
function ensureTable(): Promise<boolean> {
  if (!userStoreConfigured()) return Promise.resolve(false);
  if (!globalForReports.oeReportsReady) {
    globalForReports.oeReportsReady = sql(DDL)
      .then(() => true)
      .catch((error: unknown) => {
        const code = (error as { code?: string })?.code;
        if (code === "23505" || code === "42P07" || code === "42710") return true;
        console.error("[reports] could not create report tables", error);
        globalForReports.oeReportsReady = undefined;
        return false;
      });
  }
  return globalForReports.oeReportsReady;
}

// ---------------------------------------------------------------------------
// Database seam
// ---------------------------------------------------------------------------

/** What pg's Pool and PoolClient both satisfy, and what the check script fakes. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface StoreDeps {
  db: Queryable;
  /** BEGIN, run, COMMIT; ROLLBACK and rethrow on any throw. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ensureTable(): Promise<boolean>;
  assertAccess(): Promise<Pick<Access, "email" | "role">>;
  /** One access_log row per report open, clientId null. Never throws. */
  recordAccess(entry: { email: string; role: string; detail: string }): Promise<void>;
}

/**
 * BEGIN / COMMIT on one pooled connection, ROLLBACK on any throw. The pool has
 * max 3 connections (lib/users/db.ts): keep transactions short and never
 * await anything slow inside one.
 */
export async function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[reports] rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

const realDeps: StoreDeps = {
  db: { query: (text, params) => pool().query(text, params) },
  transaction: withTransaction,
  ensureTable,
  assertAccess: assertReportsAccess,
  recordAccess: (entry) => recordAccess({ email: entry.email, role: entry.role, event: "view", clientId: null, detail: entry.detail }),
};

// ---------------------------------------------------------------------------
// Permissions (pure)
// ---------------------------------------------------------------------------

type PermissionSubject = Pick<ReportMeta, "ownerEmail" | "visibility">;

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isOwner(report: PermissionSubject, email: string): boolean {
  return same(report.ownerEmail, email);
}

/** Owner, or visibility is not private. */
export function canView(report: PermissionSubject, email: string): boolean {
  return isOwner(report, email) || report.visibility !== "private";
}

/** Owner, or visibility is team_edit. */
export function canEdit(report: PermissionSubject, email: string): boolean {
  return isOwner(report, email) || report.visibility === "team_edit";
}

/** Only the owner changes visibility or deletes. */
export function reportPermissions(report: PermissionSubject, email: string): ReportPermissions {
  return { canView: canView(report, email), canEdit: canEdit(report, email), isOwner: isOwner(report, email) };
}

// ---------------------------------------------------------------------------
// Input schemas (shared with actions.ts)
// ---------------------------------------------------------------------------

export const ReportId = z.string().uuid();
export const ExpectedVersion = z.number().int().min(1).max(2_147_483_647);

/** Position and size of a new widget, the report_widgets CHECK constraints. */
const Geometry = z
  .object({
    x: z.number().int().min(0).max(GRID.cols - 1),
    y: z.number().int().min(0).max(GRID.maxY),
    w: z.number().int().min(1).max(GRID.cols),
    h: z.number().int().min(GRID.minH).max(GRID.maxH),
  })
  .refine((g) => g.x + g.w <= GRID.cols, { message: "Item exceeds the grid", path: ["w"] });

/** A widget to insert. The stored type must equal config.view.type. */
export const NewWidgetInput = z
  .object({ type: z.enum(WIDGET_TYPES), config: WidgetConfig })
  .and(Geometry)
  .refine((w) => w.config.view.type === w.type, { message: "Type does not match config", path: ["type"] });

export const LayoutItems = z
  .array(LayoutItem)
  .max(MAX_WIDGETS_PER_REPORT)
  .refine((items) => new Set(items.map((i) => i.id)).size === items.length, "Duplicate widget id");

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : new Date(0).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function templateKeyOf(value: unknown): TemplateKey | null {
  return typeof value === "string" && (TEMPLATE_KEYS as readonly string[]).includes(value) ? (value as TemplateKey) : null;
}

/**
 * Filters are validated on read as well as on write. A stored value that no
 * longer parses (schema drift) falls back to the defaults rather than
 * crashing the report; the next save overwrites it.
 */
function filtersOf(value: unknown, id: unknown): ReportFiltersT {
  const parsed = ReportFilters.safeParse(parseJson(value));
  if (parsed.success) return parsed.data;
  console.warn(`[reports] filters of report ${String(id)} failed validation, using defaults`);
  return structuredClone(DEFAULT_REPORT_FILTERS);
}

function toMeta(r: Row): ReportMeta {
  return {
    id: String(r.id),
    name: String(r.name),
    ownerEmail: String(r.owner_email).toLowerCase(),
    visibility: Visibility.catch("private").parse(r.visibility),
    filters: filtersOf(r.filters, r.id),
    version: Number(r.version),
    templateKey: templateKeyOf(r.template_key),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    updatedBy: String(r.updated_by),
    deletedAt: isoOrNull(r.deleted_at),
  };
}

function toWidget(r: Row): StoredWidget {
  const rawConfig = parseJson(r.config);
  const parsed = WidgetConfig.safeParse(rawConfig);
  return {
    id: String(r.id),
    reportId: String(r.report_id),
    type: r.type as WidgetType,
    config: parsed.success ? parsed.data : null,
    rawConfig,
    x: Number(r.x),
    y: Number(r.y),
    w: Number(r.w),
    h: Number(r.h),
    updatedAt: iso(r.updated_at),
  };
}

const REPORT_COLUMNS =
  "r.id, r.name, r.owner_email, r.visibility, r.filters, r.version, r.template_key, r.created_at, r.updated_at, r.updated_by, r.deleted_at";

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

function fail(code: StoreFailureCode, message?: string, version?: number): Extract<StoreResult, { ok: false }> {
  return { ok: false, code, ...(message ? { message } : {}), ...(version !== undefined ? { version } : {}) };
}

/** Thrown inside a transaction to roll it back and return this failure. */
class TxAbort extends Error {
  constructor(readonly failure: Extract<StoreResult, { ok: false }>) {
    super(failure.code);
  }
}

const isUuid = (id: string) => ReportId.safeParse(id).success;

function errorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input";
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

type Need = "edit" | "owner";

export function createReportStore(deps: StoreDeps): ReportStore {
  const { db } = deps;

  async function actor(): Promise<string> {
    return (await actorWithRole()).email;
  }

  async function actorWithRole(): Promise<{ email: string; role: string }> {
    const access = await deps.assertAccess();
    return { email: access.email.trim().toLowerCase(), role: access.role };
  }

  /** Reads and writes both go through here: false means the store is unavailable. */
  async function ready(): Promise<boolean> {
    return deps.ensureTable();
  }

  async function mustBeReady(): Promise<void> {
    if (!(await ready())) throw new Error("Report store is not available.");
  }

  /** Runs `fn` in a transaction. A TxAbort inside it rolls back and becomes the returned failure. */
  async function runTx<T extends object>(fn: (tx: Queryable) => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    try {
      return await deps.transaction(fn);
    } catch (error) {
      if (error instanceof TxAbort) return error.failure as StoreResult<T>;
      throw error;
    }
  }

  /** Why a guarded UPDATE touched zero rows. One read. */
  async function classify(q: Queryable, id: string, email: string, need: Need): Promise<Extract<StoreResult, { ok: false }>> {
    const res = await q.query(
      `/* reports.classify */ SELECT owner_email, visibility, version, deleted_at FROM reports r WHERE r.id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row || row.deleted_at) return fail("not_found");
    const subject = { ownerEmail: String(row.owner_email), visibility: Visibility.catch("private").parse(row.visibility) };
    if (!canView(subject, email)) return fail("not_found");
    if (need === "owner" ? !isOwner(subject, email) : !canEdit(subject, email)) {
      return fail("forbidden", need === "owner" ? "Owner only" : "Read only");
    }
    return fail("conflict", "Updated elsewhere", Number(row.version));
  }

  /**
   * The versioned, permission-guarded UPDATE that starts every write.
   * `set` is extra SET assignments using $4 and up; `expected` null skips the
   * version check (rename, visibility, delete have no token in the contract).
   */
  async function bump(
    q: Queryable,
    op: string,
    id: string,
    email: string,
    expected: number | null,
    need: Need,
    set = "",
    params: unknown[] = [],
  ): Promise<StoreResult> {
    const guard = need === "owner" ? "owner_email = $2" : "(owner_email = $2 OR visibility = 'team_edit')";
    const res = await q.query(
      `/* reports.update.${op} */ UPDATE reports
          SET version = version + 1, updated_at = NOW(), updated_by = $2${set ? `, ${set}` : ""}
        WHERE id = $1 AND deleted_at IS NULL AND ($3::int IS NULL OR version = $3) AND ${guard}
        RETURNING version`,
      [id, email, expected, ...params],
    );
    const row = res.rows[0];
    if (!row) return classify(q, id, email, need);
    return { ok: true, version: Number(row.version) };
  }

  /** bump() for use inside a transaction: a failure aborts it. */
  async function bumpOrAbort(tx: Queryable, op: string, id: string, email: string, expected: number | null, need: Need, set?: string, params?: unknown[]): Promise<number> {
    const res = await bump(tx, op, id, email, expected, need, set, params);
    if (!res.ok) throw new TxAbort(res);
    return res.version;
  }

  async function loadVisible(id: string, email: string): Promise<ReportMeta | null> {
    if (!isUuid(id)) return null;
    const res = await db.query(`/* reports.get */ SELECT ${REPORT_COLUMNS} FROM reports r WHERE r.id = $1 AND r.deleted_at IS NULL`, [id]);
    const row = res.rows[0];
    if (!row) return null;
    const meta = toMeta(row);
    return canView(meta, email) ? meta : null;
  }

  // -- reads ---------------------------------------------------------------

  async function listReports(scope: "mine" | "team"): Promise<ReportListItem[]> {
    const email = await actor();
    if (!(await ready())) return [];
    const where = scope === "mine" ? "r.owner_email = $1" : "r.visibility <> 'private'";
    const res = await db.query(
      `/* reports.list */ SELECT ${REPORT_COLUMNS},
              (SELECT COUNT(*) FROM report_widgets w WHERE w.report_id = r.id) AS widget_count,
              COALESCE(s.pinned, FALSE) AS pinned, COALESCE(s.pin_position, 0) AS pin_position, s.last_opened_at
         FROM reports r
         LEFT JOIN report_user_state s ON s.report_id = r.id AND s.user_email = $1
        WHERE r.deleted_at IS NULL AND ${where}
        ORDER BY COALESCE(s.pinned, FALSE) DESC,
                 CASE WHEN COALESCE(s.pinned, FALSE) THEN s.pin_position END ASC NULLS LAST,
                 s.last_opened_at DESC NULLS LAST,
                 r.updated_at DESC`,
      [email],
    );
    return res.rows.map((row) => {
      const meta = toMeta(row);
      return {
        ...meta,
        widgetCount: Number(row.widget_count ?? 0),
        pinned: Boolean(row.pinned),
        pinPosition: Number(row.pin_position ?? 0),
        lastOpenedAt: isoOrNull(row.last_opened_at),
        permissions: reportPermissions(meta, email),
      };
    });
  }

  async function getReport(id: string) {
    const email = await actor();
    if (!(await ready())) return null;
    const report = await loadVisible(id, email);
    if (!report) return null;
    const [widgets, state] = await Promise.all([
      db.query(
        `/* reports.widgets */ SELECT id, report_id, type, config, x, y, w, h, updated_at
           FROM report_widgets WHERE report_id = $1 ORDER BY y, x, created_at`,
        [id],
      ),
      db.query(`/* reports.state */ SELECT pinned, last_opened_at FROM report_user_state WHERE user_email = $1 AND report_id = $2`, [email, id]),
    ]);
    const s = state.rows[0];
    return {
      report,
      widgets: widgets.rows.map(toWidget),
      permissions: reportPermissions(report, email),
      pinned: Boolean(s?.pinned),
      lastOpenedAt: s ? isoOrNull(s.last_opened_at) : null,
    };
  }

  // -- create, duplicate ---------------------------------------------------

  async function createReport(input: { name: string; templateKey?: TemplateKey; filters?: ReportFiltersT }) {
    const email = await actor();
    await mustBeReady();
    const name = ReportName.safeParse(input.name);
    if (!name.success) return fail("invalid", errorMessage(name.error));
    const template = getTemplate(input.templateKey ?? "blank");
    if (!template) return fail("invalid", "Unknown template");
    let filters = structuredClone(template.filters);
    if (input.filters !== undefined) {
      const parsed = ReportFilters.safeParse(input.filters);
      if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
      filters = parsed.data;
    }
    return runTx<{ id: string }>(async (tx) => {
      const ins = await tx.query(
        `/* reports.create */ INSERT INTO reports (name, owner_email, visibility, filters, template_key, updated_by)
         VALUES ($1, $2, 'private', $3::jsonb, $4, $2) RETURNING id, version`,
        [name.data, email, JSON.stringify(filters), template.key],
      );
      const created = ins.rows[0];
      if (!created) throw new Error("Report insert returned no row.");
      for (const w of template.widgets) {
        await tx.query(
          `/* reports.create.widget */ INSERT INTO report_widgets (report_id, type, config, x, y, w, h)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
          [created.id, w.type, JSON.stringify(w.config), w.x, w.y, w.w, w.h],
        );
      }
      return { ok: true, version: Number(created.version), id: String(created.id) };
    });
  }

  async function duplicateReport(id: string) {
    const email = await actor();
    await mustBeReady();
    if (!isUuid(id)) return fail("not_found");
    return runTx<{ id: string }>(async (tx) => {
      const src = await tx.query(`/* reports.duplicate.source */ SELECT name FROM reports r WHERE r.id = $1 AND r.deleted_at IS NULL AND (r.owner_email = $2 OR r.visibility <> 'private')`, [id, email]);
      const sourceName = src.rows[0]?.name;
      if (typeof sourceName !== "string") throw new TxAbort(fail("not_found"));
      const name = `${sourceName.slice(0, MAX_REPORT_NAME - 5).trimEnd()} copy`;
      const ins = await tx.query(
        `/* reports.duplicate.report */ INSERT INTO reports (name, owner_email, visibility, filters, schema_version, template_key, updated_by)
         SELECT $3, $2, 'private', filters, schema_version, template_key, $2
           FROM reports WHERE id = $1 AND deleted_at IS NULL AND (owner_email = $2 OR visibility <> 'private')
         RETURNING id, version`,
        [id, email, name],
      );
      const created = ins.rows[0];
      if (!created) throw new TxAbort(fail("not_found"));
      await tx.query(
        `/* reports.duplicate.widgets */ INSERT INTO report_widgets (report_id, type, config, x, y, w, h)
         SELECT $2, type, config, x, y, w, h FROM report_widgets WHERE report_id = $1`,
        [id, created.id],
      );
      return { ok: true, version: Number(created.version), id: String(created.id) };
    });
  }

  // -- report level writes -------------------------------------------------

  async function renameReport(id: string, name: string) {
    const email = await actor();
    await mustBeReady();
    const parsed = ReportName.safeParse(name);
    if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
    if (!isUuid(id)) return fail("not_found");
    return bump(db, "rename", id, email, null, "edit", "name = $4", [parsed.data]);
  }

  async function deleteReport(id: string) {
    const email = await actor();
    await mustBeReady();
    if (!isUuid(id)) return fail("not_found");
    return bump(db, "delete", id, email, null, "owner", "deleted_at = NOW()");
  }

  async function restoreReport(id: string) {
    const email = await actor();
    await mustBeReady();
    if (!isUuid(id)) return fail("not_found");
    const res = await db.query(
      `/* reports.restore */ UPDATE reports
          SET deleted_at = NULL, version = version + 1, updated_at = NOW(), updated_by = $2
        WHERE id = $1 AND deleted_at IS NOT NULL AND owner_email = $2
        RETURNING version`,
      [id, email],
    );
    const row = res.rows[0];
    if (row) return { ok: true as const, version: Number(row.version) };
    // Someone else's report, or a missing one: not_found. Mine and not deleted: nothing to restore.
    const check = await db.query(`/* reports.classify */ SELECT owner_email, visibility, version, deleted_at FROM reports r WHERE r.id = $1`, [id]);
    const existing = check.rows[0];
    if (!existing || !isOwner({ ownerEmail: String(existing.owner_email), visibility: "private" }, email)) return fail("not_found");
    return fail("invalid", "Not deleted", Number(existing.version));
  }

  async function setVisibility(id: string, visibility: z.infer<typeof Visibility>) {
    const email = await actor();
    await mustBeReady();
    const parsed = Visibility.safeParse(visibility);
    if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
    if (!isUuid(id)) return fail("not_found");
    return bump(db, "visibility", id, email, null, "owner", "visibility = $4", [parsed.data]);
  }

  async function saveReportFilters(id: string, expectedVersion: number, filters: ReportFiltersT) {
    const email = await actor();
    await mustBeReady();
    const v = ExpectedVersion.safeParse(expectedVersion);
    if (!v.success) return fail("invalid", errorMessage(v.error));
    const parsed = ReportFilters.safeParse(filters);
    if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
    if (!isUuid(id)) return fail("not_found");
    return bump(db, "filters", id, email, v.data, "edit", "filters = $4::jsonb", [JSON.stringify(parsed.data)]);
  }

  // -- widget level writes (one transaction each) --------------------------

  async function saveLayout(id: string, expectedVersion: number, items: z.input<typeof LayoutItem>[]) {
    const email = await actor();
    await mustBeReady();
    const v = ExpectedVersion.safeParse(expectedVersion);
    if (!v.success) return fail("invalid", errorMessage(v.error));
    const parsed = LayoutItems.safeParse(items);
    if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
    if (!isUuid(id)) return fail("not_found");
    return runTx(async (tx) => {
      const version = await bumpOrAbort(tx, "layout", id, email, v.data, "edit");
      if (parsed.data.length > 0) {
        const res = await tx.query(
          `/* reports.layout.items */ UPDATE report_widgets AS w
              SET x = v.x, y = v.y, w = v.w, h = v.h, updated_at = NOW()
             FROM unnest($2::uuid[], $3::int[], $4::int[], $5::int[], $6::int[]) AS v(id, x, y, w, h)
            WHERE w.id = v.id AND w.report_id = $1
            RETURNING w.id`,
          [
            id,
            parsed.data.map((i) => i.id),
            parsed.data.map((i) => i.x),
            parsed.data.map((i) => i.y),
            parsed.data.map((i) => i.w),
            parsed.data.map((i) => i.h),
          ],
        );
        if (res.rows.length !== parsed.data.length) throw new TxAbort(fail("invalid", "Unknown widget"));
      }
      return { ok: true, version };
    });
  }

  async function addWidget(id: string, expectedVersion: number, widget: NewWidget) {
    const email = await actor();
    await mustBeReady();
    const v = ExpectedVersion.safeParse(expectedVersion);
    if (!v.success) return fail("invalid", errorMessage(v.error));
    const parsed = NewWidgetInput.safeParse(widget);
    if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
    if (!isUuid(id)) return fail("not_found");
    const w = parsed.data;
    return runTx<{ widgetId: string }>(async (tx) => {
      // The versioned UPDATE locks the report row, so two concurrent adds cannot both pass the count.
      const version = await bumpOrAbort(tx, "addWidget", id, email, v.data, "edit");
      const count = await tx.query(`/* reports.widgets.count */ SELECT COUNT(*)::int AS n FROM report_widgets WHERE report_id = $1`, [id]);
      if (Number(count.rows[0]?.n ?? 0) >= MAX_WIDGETS_PER_REPORT) throw new TxAbort(fail("invalid", "Widget limit reached"));
      const ins = await tx.query(
        `/* reports.widgets.insert */ INSERT INTO report_widgets (report_id, type, config, x, y, w, h)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING id`,
        [id, w.type, JSON.stringify(w.config), w.x, w.y, w.w, w.h],
      );
      const widgetId = ins.rows[0]?.id;
      if (!widgetId) throw new Error("Widget insert returned no row.");
      return { ok: true, version, widgetId: String(widgetId) };
    });
  }

  async function updateWidget(id: string, expectedVersion: number, widgetId: string, config: z.input<typeof WidgetConfig>) {
    const email = await actor();
    await mustBeReady();
    const v = ExpectedVersion.safeParse(expectedVersion);
    if (!v.success) return fail("invalid", errorMessage(v.error));
    const parsed = WidgetConfig.safeParse(config);
    if (!parsed.success) return fail("invalid", errorMessage(parsed.error));
    if (!isUuid(id) || !isUuid(widgetId)) return fail("not_found");
    return runTx(async (tx) => {
      const version = await bumpOrAbort(tx, "updateWidget", id, email, v.data, "edit");
      const res = await tx.query(
        `/* reports.widgets.update */ UPDATE report_widgets SET type = $3, config = $4::jsonb, updated_at = NOW()
          WHERE id = $2 AND report_id = $1 RETURNING id`,
        [id, widgetId, parsed.data.view.type, JSON.stringify(parsed.data)],
      );
      if (res.rows.length === 0) throw new TxAbort(fail("not_found", "Widget not found"));
      return { ok: true, version };
    });
  }

  async function removeWidget(id: string, expectedVersion: number, widgetId: string) {
    const email = await actor();
    await mustBeReady();
    const v = ExpectedVersion.safeParse(expectedVersion);
    if (!v.success) return fail("invalid", errorMessage(v.error));
    if (!isUuid(id) || !isUuid(widgetId)) return fail("not_found");
    return runTx(async (tx) => {
      const version = await bumpOrAbort(tx, "removeWidget", id, email, v.data, "edit");
      const res = await tx.query(`/* reports.widgets.delete */ DELETE FROM report_widgets WHERE id = $2 AND report_id = $1 RETURNING id`, [id, widgetId]);
      if (res.rows.length === 0) throw new TxAbort(fail("not_found", "Widget not found"));
      return { ok: true, version };
    });
  }

  // -- per-user state ------------------------------------------------------

  async function pinReport(id: string, pinned: boolean) {
    const email = await actor();
    await mustBeReady();
    if (typeof pinned !== "boolean") return fail("invalid", "pinned must be a boolean");
    const report = await loadVisible(id, email);
    if (!report) return fail("not_found");
    await db.query(
      `/* reports.pin */ INSERT INTO report_user_state (user_email, report_id, pinned, pin_position)
       VALUES ($1, $2, $3::boolean,
               CASE WHEN $3::boolean THEN COALESCE((SELECT MAX(pin_position) + 1 FROM report_user_state WHERE user_email = $1 AND pinned), 0) ELSE 0 END)
       ON CONFLICT (user_email, report_id) DO UPDATE
         SET pinned = EXCLUDED.pinned,
             pin_position = CASE WHEN report_user_state.pinned AND EXCLUDED.pinned THEN report_user_state.pin_position ELSE EXCLUDED.pin_position END`,
      [email, id, pinned],
    );
    return { ok: true as const, version: report.version };
  }

  async function touchOpened(id: string): Promise<void> {
    const { email, role } = await actorWithRole();
    try {
      if (!(await ready())) return;
      const report = await loadVisible(id, email);
      if (!report) return;
      await db.query(
        `/* reports.touch */ INSERT INTO report_user_state (user_email, report_id, last_opened_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_email, report_id) DO UPDATE SET last_opened_at = NOW()`,
        [email, id],
      );
      await deps.recordAccess({ email, role, detail: `report:${id} clients=${clientsDetail(report.filters)}` });
    } catch (error) {
      // Fire and forget: opening a report must never fail because bookkeeping did.
      console.error("[reports] could not record open", error);
    }
  }

  return {
    reportPermissions,
    listReports,
    getReport,
    createReport,
    renameReport,
    duplicateReport,
    deleteReport,
    restoreReport,
    setVisibility,
    saveReportFilters,
    saveLayout,
    addWidget,
    updateWidget,
    removeWidget,
    pinReport,
    touchOpened,
  };
}

/** What `clients=` says in the access_log detail. */
export function clientsDetail(filters: ReportFiltersT): string {
  const c = filters.clients;
  if (c.mode === "all") return "all";
  if (c.mode === "list") return c.ids.join(",");
  return `vertical:${c.verticals.join(",")}`;
}

// ---------------------------------------------------------------------------
// Bound to the real pool
// ---------------------------------------------------------------------------

const store = createReportStore(realDeps);

export const {
  listReports,
  getReport,
  createReport,
  renameReport,
  duplicateReport,
  deleteReport,
  restoreReport,
  setVisibility,
  saveReportFilters,
  saveLayout,
  addWidget,
  updateWidget,
  removeWidget,
  pinReport,
  touchOpened,
} = store;
