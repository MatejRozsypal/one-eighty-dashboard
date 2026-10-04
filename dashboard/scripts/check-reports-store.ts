/**
 * npm run check:reports-store
 *
 * RS4: report persistence without a database. createReportStore(deps) runs
 * against an in-memory fake of the query function that interprets each tagged
 * statement the way the SQL is written to behave. This proves the TypeScript
 * around the SQL: permission helpers, version conflicts, failure
 * classification, rollback, limits, soft delete, pin order, templates and the
 * access gate on every action. It does NOT prove the SQL text itself; that
 * needs a Postgres (see the RS4 report).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_WIDGETS_PER_REPORT, WIDGET_SIZE, GRID } from "@/lib/reports/limits";
import { METRIC_IDS } from "@/lib/reports/registry/ids";
import { TEMPLATE_KEYS, type NewWidget } from "@/lib/reports/contracts";
import { createReportStore, canEdit, canView, isOwner, reportPermissions, clientsDetail, type Queryable, type StoreDeps } from "@/lib/reports/store";
import { TEMPLATES, getTemplate } from "@/lib/reports/templates";
import { DEFAULT_REPORT_FILTERS, WidgetConfig } from "@/lib/reports/types";

const DASH = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { if (!String(a[0]).startsWith("[reports] filters of report")) realWarn(...a); };

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed += 1;
  else failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}
const eq = (name: string, actual: unknown, expected: unknown) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

// ---------------------------------------------------------------------------
// In-memory fake of the query function
// ---------------------------------------------------------------------------

interface R { id: string; name: string; owner_email: string; visibility: string; filters: string; schema_version: number; version: number; template_key: string | null; created_at: Date; updated_at: Date; updated_by: string; deleted_at: Date | null }
interface W { id: string; report_id: string; type: string; config: string; x: number; y: number; w: number; h: number; created_at: Date; updated_at: Date }
interface S { user_email: string; report_id: string; pinned: boolean; pin_position: number; last_opened_at: Date | null }
interface State { reports: R[]; widgets: W[]; states: S[]; seq: number; clock: number }

function newState(): State { return { reports: [], widgets: [], states: [], seq: 0, clock: 0 }; }
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

class FakeDb implements Queryable {
  state = newState();
  log: string[] = [];

  private tick(): Date { this.state.clock += 1; return new Date(Date.UTC(2026, 9, 1, 0, 0, this.state.clock)); }
  private id(): string { this.state.seq += 1; return uuid(this.state.seq); }

  async query(text: string, params: unknown[] = []) {
    const tag = /^\/\* (reports\.[\w.]+) \*\//.exec(text)?.[1];
    if (!tag) throw new Error(`untagged statement: ${text.slice(0, 40)}`);
    this.log.push(tag);
    const p = params;
    const s = this.state;
    const rows = (rs: unknown[]) => ({ rows: rs as Record<string, unknown>[], rowCount: rs.length });
    const rep = (id: unknown) => s.reports.find((r) => r.id === id);

    if (tag === "reports.classify") {
      const r = rep(p[0]);
      return rows(r ? [{ owner_email: r.owner_email, visibility: r.visibility, version: r.version, deleted_at: r.deleted_at }] : []);
    }
    if (tag.startsWith("reports.update.")) {
      const op = tag.slice("reports.update.".length);
      const [id, email, expected] = p as [string, string, number | null];
      const ownerOnly = op === "delete" || op === "visibility";
      const r = rep(id);
      if (!r || r.deleted_at || (expected !== null && r.version !== expected)) return rows([]);
      if (ownerOnly ? r.owner_email !== email : !(r.owner_email === email || r.visibility === "team_edit")) return rows([]);
      r.version += 1; r.updated_at = this.tick(); r.updated_by = email;
      if (op === "rename") r.name = String(p[3]);
      if (op === "delete") r.deleted_at = this.tick();
      if (op === "visibility") r.visibility = String(p[3]);
      if (op === "filters") r.filters = String(p[3]);
      return rows([{ version: r.version }]);
    }
    if (tag === "reports.restore") {
      const r = rep(p[0]);
      if (!r || !r.deleted_at || r.owner_email !== p[1]) return rows([]);
      r.deleted_at = null; r.version += 1;
      return rows([{ version: r.version }]);
    }
    if (tag === "reports.get") {
      const r = rep(p[0]);
      return rows(r && !r.deleted_at ? [r] : []);
    }
    if (tag === "reports.create") {
      const r: R = { id: this.id(), name: String(p[0]), owner_email: String(p[1]), visibility: "private", filters: String(p[2]), schema_version: 1, version: 1, template_key: p[3] as string, created_at: this.tick(), updated_at: this.tick(), updated_by: String(p[1]), deleted_at: null };
      s.reports.push(r);
      return rows([{ id: r.id, version: 1 }]);
    }
    if (tag === "reports.create.widget" || tag === "reports.widgets.insert") {
      if (!rep(p[0])) throw new Error("fk violation");
      const w: W = { id: p[7] ? String(p[7]) : this.id(), report_id: String(p[0]), type: String(p[1]), config: String(p[2]), x: Number(p[3]), y: Number(p[4]), w: Number(p[5]), h: Number(p[6]), created_at: this.tick(), updated_at: this.tick() };
      s.widgets.push(w);
      return rows([{ id: w.id }]);
    }
    if (tag === "reports.duplicate.source") {
      const r = rep(p[0]);
      return rows(r && !r.deleted_at && (r.owner_email === p[1] || r.visibility !== "private") ? [{ name: r.name }] : []);
    }
    if (tag === "reports.duplicate.report") {
      const src = rep(p[0]);
      if (!src || src.deleted_at || !(src.owner_email === p[1] || src.visibility !== "private")) return rows([]);
      const r: R = { ...src, id: this.id(), name: String(p[2]), owner_email: String(p[1]), visibility: "private", version: 1, updated_by: String(p[1]), created_at: this.tick(), updated_at: this.tick() };
      s.reports.push(r);
      return rows([{ id: r.id, version: 1 }]);
    }
    if (tag === "reports.duplicate.widgets") {
      for (const w of s.widgets.filter((x) => x.report_id === p[0])) s.widgets.push({ ...w, id: this.id(), report_id: String(p[1]) });
      return rows([]);
    }
    if (tag === "reports.widgets.count") return rows([{ n: s.widgets.filter((w) => w.report_id === p[0]).length }]);
    if (tag === "reports.widgets.update") {
      const w = s.widgets.find((x) => x.id === p[1] && x.report_id === p[0]);
      if (!w) return rows([]);
      w.type = String(p[2]); w.config = String(p[3]);
      return rows([{ id: w.id }]);
    }
    if (tag === "reports.widgets.delete") {
      const i = s.widgets.findIndex((x) => x.id === p[1] && x.report_id === p[0]);
      if (i < 0) return rows([]);
      const [gone] = s.widgets.splice(i, 1);
      return rows([{ id: gone.id }]);
    }
    if (tag === "reports.layout.items") {
      const [id, ids, xs, ys, ws, hs] = p as [string, string[], number[], number[], number[], number[]];
      const hit: unknown[] = [];
      ids.forEach((wid, i) => {
        const w = s.widgets.find((x) => x.id === wid && x.report_id === id);
        if (w) { w.x = xs[i]; w.y = ys[i]; w.w = ws[i]; w.h = hs[i]; hit.push({ id: wid }); }
      });
      return rows(hit);
    }
    if (tag === "reports.widgets") return rows(s.widgets.filter((w) => w.report_id === p[0]).sort((a, b) => a.y - b.y || a.x - b.x));
    if (tag === "reports.state") return rows(s.states.filter((x) => x.user_email === p[0] && x.report_id === p[1]));
    if (tag === "reports.pin") {
      const [email, id, pinned] = p as [string, string, boolean];
      const cur = s.states.find((x) => x.user_email === email && x.report_id === id);
      const next = pinned ? Math.max(-1, ...s.states.filter((x) => x.user_email === email && x.pinned).map((x) => x.pin_position)) + 1 : 0;
      if (!cur) s.states.push({ user_email: email, report_id: id, pinned, pin_position: next, last_opened_at: null });
      else { const keep = cur.pinned && pinned; cur.pinned = pinned; cur.pin_position = keep ? cur.pin_position : next; }
      return rows([]);
    }
    if (tag === "reports.touch") {
      const [email, id] = p as [string, string];
      const cur = s.states.find((x) => x.user_email === email && x.report_id === id);
      if (cur) cur.last_opened_at = this.tick();
      else s.states.push({ user_email: email, report_id: id, pinned: false, pin_position: 0, last_opened_at: this.tick() });
      return rows([]);
    }
    if (tag === "reports.list") {
      const email = String(p[0]);
      const mine = /r\.owner_email = \$1/.test(text);
      const out = s.reports
        .filter((r) => !r.deleted_at && (mine ? r.owner_email === email : r.visibility !== "private"))
        .map((r) => {
          const st = s.states.find((x) => x.user_email === email && x.report_id === r.id);
          return { ...r, widget_count: s.widgets.filter((w) => w.report_id === r.id).length, pinned: st?.pinned ?? false, pin_position: st?.pin_position ?? 0, last_opened_at: st?.last_opened_at ?? null };
        });
      const t = (d: Date | null) => (d ? d.getTime() : -1);
      out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.pinned && b.pinned ? a.pin_position - b.pin_position : 0) || t(b.last_opened_at) - t(a.last_opened_at) || t(b.updated_at) - t(a.updated_at));
      return rows(out);
    }
    throw new Error(`fake does not know ${tag}`);
  }
}

interface Harness {
  db: FakeDb;
  as(email: string | null): ReturnType<typeof createReportStore>;
  audit: Array<{ email: string; role: string; detail: string }>;
}

function harness(): Harness {
  const db = new FakeDb();
  const audit: Harness["audit"] = [];
  const as = (email: string | null) => {
    const deps: StoreDeps = {
      db,
      async transaction(fn) {
        const snapshot = structuredClone(db.state);
        try { return await fn(db); } catch (e) { db.state = snapshot; throw e; }
      },
      ensureTable: async () => true,
      assertAccess: async () => { if (!email) throw new Error("Not authorised."); return { email, role: "agency" }; },
      recordAccess: async (entry) => { audit.push(entry); },
    };
    return createReportStore(deps);
  };
  return { db, as, audit };
}

const ID_MISSING = uuid(999);
const WIDGET_KPI: NewWidget = { type: "kpi", config: WidgetConfig.parse({ v: 1, query: { metrics: ["mer"], grain: "total", split: "combined" }, view: { type: "kpi" } }), x: 0, y: 0, w: 3, h: 3 };

async function main() {
  // -------------------------------------------------------------------------
  // Permission helpers (pure)
  // -------------------------------------------------------------------------
  const owner = "owner@oneeighty.cz";
  const other = "other@oneeighty.cz";
  for (const [vis, view, edit] of [["private", false, false], ["team_view", true, false], ["team_edit", true, true]] as const) {
    const r = { ownerEmail: owner, visibility: vis };
    check(`owner sees and edits ${vis}`, canView(r, owner) && canEdit(r, owner) && isOwner(r, owner));
    check(`other canView ${vis}`, canView(r, other) === view);
    check(`other canEdit ${vis}`, canEdit(r, other) === edit);
    check(`other is never owner ${vis}`, !isOwner(r, other));
  }
  check("email compare is case-insensitive", isOwner({ ownerEmail: owner, visibility: "private" }, "Owner@OneEighty.CZ"));
  eq("reportPermissions shape", reportPermissions({ ownerEmail: owner, visibility: "team_view" }, other), { canView: true, canEdit: false, isOwner: false });
  eq("clientsDetail all", clientsDetail(DEFAULT_REPORT_FILTERS), "all");
  eq("clientsDetail list", clientsDetail({ ...DEFAULT_REPORT_FILTERS, clients: { mode: "list", ids: ["a", "b"] } }), "a,b");
  eq("clientsDetail vertical", clientsDetail({ ...DEFAULT_REPORT_FILTERS, clients: { mode: "vertical", verticals: ["pet"] } }), "vertical:pet");

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------
  const queryable = new Set<string>(METRIC_IDS);
  for (const key of TEMPLATE_KEYS) {
    const t = TEMPLATES[key];
    check(`template ${key} registered`, getTemplate(key) === t && t.key === key);
    check(`template ${key} has at most ${MAX_WIDGETS_PER_REPORT} widgets`, t.widgets.length <= MAX_WIDGETS_PER_REPORT);
    for (const [i, w] of t.widgets.entries()) {
      const where = `${key}[${i}] ${w.type}`;
      check(`${where} config valid`, WidgetConfig.safeParse(w.config).success);
      check(`${where} type matches view`, w.config.view.type === w.type);
      check(`${where} only phase-1 metrics`, w.config.query.metrics.every((m) => queryable.has(m)));
      const min = WIDGET_SIZE[w.type];
      check(`${where} fits grid`, w.x >= 0 && w.x + w.w <= GRID.cols && w.y <= GRID.maxY);
      check(`${where} respects min size`, w.w >= min.minW && w.h >= min.minH && w.h <= GRID.maxH, { w: w.w, h: w.h });
    }
    // No overlap.
    const boxes = t.widgets;
    let overlap = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
    }
    check(`template ${key} has no overlapping widgets`, !overlap);
    check(`template ${key} text has no em dash`, !DASH.test(JSON.stringify(t)));
  }
  eq("blank has no widgets", TEMPLATES.blank.widgets.length, 0);
  check("unknown template key", getTemplate("nope") === null);
  check("template filters are not shared references", TEMPLATES.blank.filters !== DEFAULT_REPORT_FILTERS && TEMPLATES.blank.filters.clients !== TEMPLATES.paid_efficiency.filters.clients);

  // -------------------------------------------------------------------------
  // No access: every store function rejects, nothing touches the database
  // -------------------------------------------------------------------------
  {
    const h = harness();
    const none = h.as(null);
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["listReports", () => none.listReports("mine")],
      ["getReport", () => none.getReport(ID_MISSING)],
      ["createReport", () => none.createReport({ name: "x" })],
      ["renameReport", () => none.renameReport(ID_MISSING, "x")],
      ["duplicateReport", () => none.duplicateReport(ID_MISSING)],
      ["deleteReport", () => none.deleteReport(ID_MISSING)],
      ["restoreReport", () => none.restoreReport(ID_MISSING)],
      ["setVisibility", () => none.setVisibility(ID_MISSING, "team_view")],
      ["saveReportFilters", () => none.saveReportFilters(ID_MISSING, 1, DEFAULT_REPORT_FILTERS)],
      ["saveLayout", () => none.saveLayout(ID_MISSING, 1, [])],
      ["addWidget", () => none.addWidget(ID_MISSING, 1, WIDGET_KPI)],
      ["updateWidget", () => none.updateWidget(ID_MISSING, 1, ID_MISSING, WIDGET_KPI.config)],
      ["removeWidget", () => none.removeWidget(ID_MISSING, 1, ID_MISSING)],
      ["pinReport", () => none.pinReport(ID_MISSING, true)],
      ["touchOpened", () => none.touchOpened(ID_MISSING)],
    ];
    for (const [name, fn] of calls) {
      let msg = "";
      try { await fn(); } catch (e) { msg = (e as Error).message; }
      check(`${name} throws without access`, msg === "Not authorised.", msg);
    }
    eq("no statements ran without access", h.db.log, []);
  }

  // -------------------------------------------------------------------------
  // Create, read, list
  // -------------------------------------------------------------------------
  const h = harness();
  const A = h.as(owner);
  const B = h.as(other);

  const created = await A.createReport({ name: "  Weekly  ", templateKey: "portfolio_overview" });
  check("create ok", created.ok === true && created.version === 1, created);
  const id = created.ok ? created.id : "";
  const got = await A.getReport(id);
  eq("create trims the name", got?.report.name, "Weekly");
  eq("create stores the template key", got?.report.templateKey, "portfolio_overview");
  eq("template widgets are copied", got?.widgets.length, TEMPLATES.portfolio_overview.widgets.length);
  check("stored widgets parse", got?.widgets.every((w) => w.config !== null) === true);
  eq("owner permissions", got?.permissions, { canView: true, canEdit: true, isOwner: true });
  eq("new report is private and owned by caller", [got?.report.visibility, got?.report.ownerEmail], ["private", owner]);
  eq("create defaults to CZK", got?.report.filters.currency, "CZK");

  eq("blank by default", (await (async () => { const r = await A.createReport({ name: "Empty" }); return r.ok ? (await A.getReport(r.id))?.widgets.length : -1; })()), 0);
  eq("empty name is invalid", (await A.createReport({ name: "   " })).ok, false);
  eq("overlong name is invalid", (await A.createReport({ name: "x".repeat(121) })).ok, false);
  eq("unknown template is invalid", (await A.createReport({ name: "x", templateKey: "nope" as never })).ok, false);

  check("private report invisible to others (get)", (await B.getReport(id)) === null);
  eq("private report absent from team list", (await B.listReports("team")).length, 0);
  eq("bad uuid reads as null", await A.getReport("not-a-uuid"), null);

  // -------------------------------------------------------------------------
  // Optimistic concurrency
  // -------------------------------------------------------------------------
  const f2 = { ...DEFAULT_REPORT_FILTERS, compare: "none" as const };
  const s1 = await A.saveReportFilters(id, 1, f2);
  eq("save with the right version bumps it", s1, { ok: true, version: 2 });
  const s2 = await A.saveReportFilters(id, 1, DEFAULT_REPORT_FILTERS);
  eq("stale version returns conflict with the server version", s2, { ok: false, code: "conflict", message: "Updated elsewhere", version: 2 });
  eq("a conflict changes nothing", (await A.getReport(id))?.report.filters.compare, "none");
  eq("version-less ops still bump", await A.renameReport(id, "Weekly v2"), { ok: true, version: 3 });
  const stale = await A.saveLayout(id, 2, []);
  check("rename invalidated the earlier token", stale.ok === false && stale.code === "conflict" && stale.version === 3, stale);
  eq("bad expected version is invalid", (await A.saveLayout(id, 0, [])).ok, false);
  eq("fractional expected version is invalid", (await A.saveLayout(id, 1.5, [])).ok, false);

  // -------------------------------------------------------------------------
  // Visibility and edit permission
  // -------------------------------------------------------------------------
  const widgetIds = (await A.getReport(id))!.widgets.map((w) => w.id);
  eq("other cannot edit a private report (not_found, existence hidden)", (await B.saveLayout(id, 3, [])), { ok: false, code: "not_found" });
  eq("other cannot set visibility on a private report", (await B.setVisibility(id, "team_edit")), { ok: false, code: "not_found" });
  eq("owner sets team_view", await A.setVisibility(id, "team_view"), { ok: true, version: 4 });
  check("team_view is readable", (await B.getReport(id))?.permissions.canEdit === false);
  eq("team_view appears in the team list", (await B.listReports("team")).map((r) => r.id), [id]);
  eq("team_view is not in the viewer's mine list", (await B.listReports("mine")).length, 0);
  const ro = await B.saveLayout(id, 4, []);
  check("viewer write is forbidden", ro.ok === false && ro.code === "forbidden", ro);
  check("viewer cannot add widgets", (await B.addWidget(id, 4, WIDGET_KPI)).ok === false);
  check("viewer cannot rename", (await B.renameReport(id, "mine now")).ok === false);
  check("viewer cannot set visibility", (await B.setVisibility(id, "team_edit")).ok === false);
  eq("viewer cannot delete (forbidden)", await B.deleteReport(id), { ok: false, code: "forbidden", message: "Owner only" });
  eq("nothing changed after refused writes", (await A.getReport(id))?.report.name, "Weekly v2");

  await A.setVisibility(id, "team_edit");
  const v5 = (await A.getReport(id))!.report.version;
  const editorAdd = await B.addWidget(id, v5, WIDGET_KPI);
  check("team_edit editor can add a widget", editorAdd.ok === true, editorAdd);
  eq("updated_by records the editor", (await A.getReport(id))?.report.updatedBy, other);
  eq("team_edit editor cannot delete", (await B.deleteReport(id)).ok, false);
  eq("team_edit editor cannot change visibility", (await B.setVisibility(id, "private")).ok, false);

  // -------------------------------------------------------------------------
  // Widget writes, limits, rollback
  // -------------------------------------------------------------------------
  let cur = (await A.getReport(id))!;
  const before = JSON.stringify(h.db.state);
  const mismatch = await A.addWidget(id, cur.report.version, { ...WIDGET_KPI, type: "line" });
  check("type must match config.view.type", mismatch.ok === false && mismatch.code === "invalid", mismatch);
  const offGrid = await A.addWidget(id, cur.report.version, { ...WIDGET_KPI, x: 11, w: 3 });
  check("widget must fit the grid", offGrid.ok === false && offGrid.code === "invalid", offGrid);
  eq("invalid widget changed nothing", JSON.stringify(h.db.state), before);
  const badId = await A.addWidget(id, cur.report.version, { ...WIDGET_KPI, id: "not-a-uuid" });
  check("client widget id must be a uuid", badId.ok === false && badId.code === "invalid", badId);
  const chosen = uuid(4242);
  const withId = await A.addWidget(id, cur.report.version, { ...WIDGET_KPI, id: chosen });
  check("client-chosen widget id is used (undo of a removal restores the same id)", withId.ok === true && withId.widgetId === chosen, withId);
  cur = (await A.getReport(id))!;
  if (withId.ok) {
    const gone = await A.removeWidget(id, cur.report.version, chosen);
    check("the chosen widget can be removed again", gone.ok === true, gone);
    cur = (await A.getReport(id))!;
  }

  const target = cur.widgets[0];
  const bogus = uuid(777);
  const badLayout = await A.saveLayout(id, cur.report.version, [{ id: target.id, x: 0, y: 20, w: 3, h: 3 }, { id: bogus, x: 3, y: 0, w: 3, h: 3 }]);
  check("layout with an unknown widget is invalid", badLayout.ok === false && badLayout.code === "invalid", badLayout);
  eq("failed layout rolled back (version and positions)", [(await A.getReport(id))!.report.version, (await A.getReport(id))!.widgets[0].y], [cur.report.version, target.y]);
  check("duplicate layout ids rejected", (await A.saveLayout(id, cur.report.version, [{ id: target.id, x: 0, y: 0, w: 3, h: 3 }, { id: target.id, x: 3, y: 0, w: 3, h: 3 }])).ok === false);
  check("layout x + w over 12 rejected", (await A.saveLayout(id, cur.report.version, [{ id: target.id, x: 10, y: 0, w: 4, h: 3 }])).ok === false);

  const okLayout = await A.saveLayout(id, cur.report.version, [{ id: target.id, x: 3, y: 20, w: 4, h: 4 }]);
  check("valid layout saves", okLayout.ok === true && okLayout.version === cur.report.version + 1, okLayout);
  cur = (await A.getReport(id))!;
  const moved = cur.widgets.find((w) => w.id === target.id);
  eq("layout applied", [moved?.x, moved?.y, moved?.w, moved?.h], [3, 20, 4, 4]);

  const newCfg = WidgetConfig.parse({ v: 1, query: { metrics: ["cac", "mer"], grain: "week", split: "client" }, view: { type: "line" } });
  const up = await A.updateWidget(id, cur.report.version, target.id, newCfg);
  check("updateWidget ok", up.ok === true, up);
  cur = (await A.getReport(id))!;
  eq("update changes config and type", [cur.widgets.find((w) => w.id === target.id)?.type, cur.widgets.find((w) => w.id === target.id)?.config?.query.metrics], ["line", ["cac", "mer"]]);
  const upMissing = await A.updateWidget(id, cur.report.version, bogus, newCfg);
  check("update of a missing widget is not_found and rolls back", upMissing.ok === false && upMissing.code === "not_found" && (await A.getReport(id))!.report.version === cur.report.version, upMissing);
  const stalePut = await A.updateWidget(id, cur.report.version - 1, target.id, newCfg);
  check("stale updateWidget is a conflict", stalePut.ok === false && stalePut.code === "conflict" && stalePut.version === cur.report.version, stalePut);

  const rm = await A.removeWidget(id, cur.report.version, target.id);
  check("removeWidget ok", rm.ok === true, rm);
  eq("widget removed", (await A.getReport(id))!.widgets.some((w) => w.id === target.id), false);
  const rmMissing = await A.removeWidget(id, (await A.getReport(id))!.report.version, target.id);
  check("removing twice is not_found", rmMissing.ok === false && rmMissing.code === "not_found", rmMissing);

  // widget cap
  for (let guard = 0; guard < 40; guard++) {
    const g = (await A.getReport(id))!;
    if (g.widgets.length >= MAX_WIDGETS_PER_REPORT) break;
    const r = await A.addWidget(id, g.report.version, WIDGET_KPI);
    if (!r.ok) { check("filling to the cap works", false, r); break; }
  }
  const full = (await A.getReport(id))!;
  eq(`report holds ${MAX_WIDGETS_PER_REPORT} widgets`, full.widgets.length, MAX_WIDGETS_PER_REPORT);
  const over = await A.addWidget(id, full.report.version, WIDGET_KPI);
  check("widget 25 is refused", over.ok === false && over.code === "invalid", over);
  eq("refused add rolled back (version, count)", [(await A.getReport(id))!.report.version, (await A.getReport(id))!.widgets.length], [full.report.version, MAX_WIDGETS_PER_REPORT]);

  // broken stored config renders as null, never throws
  h.db.state.widgets[0].config = JSON.stringify({ v: 1, query: { metrics: ["not_a_metric"] } });
  const broken = (await A.getReport(id))!.widgets.find((w) => w.id === h.db.state.widgets[0].id);
  check("outdated widget config reads as null with raw kept", broken?.config === null && broken.rawConfig !== undefined);
  // broken stored filters fall back to defaults
  h.db.state.reports[0].filters = JSON.stringify({ nope: true });
  eq("outdated filters fall back to defaults", (await A.getReport(id))?.report.filters, DEFAULT_REPORT_FILTERS);

  // -------------------------------------------------------------------------
  // Duplicate
  // -------------------------------------------------------------------------
  const dup = await B.duplicateReport(id);
  check("viewer can duplicate a team_edit report", dup.ok === true, dup);
  const copy = dup.ok ? await B.getReport(dup.id) : null;
  eq("copy is private and owned by the duplicator", [copy?.report.visibility, copy?.report.ownerEmail, copy?.report.version], ["private", other, 1]);
  eq("copy name", copy?.report.name, "Weekly v2 copy");
  eq("copy has the widgets", copy?.widgets.length, MAX_WIDGETS_PER_REPORT);
  check("copy widgets are new rows", copy?.widgets.every((w) => !full.widgets.some((o) => o.id === w.id)) === true);
  const priv = await A.createReport({ name: "Secret" });
  eq("cannot duplicate someone else's private report", await B.duplicateReport(priv.ok ? priv.id : ""), { ok: false, code: "not_found" });
  const longName = await A.createReport({ name: "n".repeat(120) });
  const longCopy = await A.duplicateReport(longName.ok ? longName.id : "");
  eq("duplicate keeps the name within 120 chars", longCopy.ok ? (await A.getReport(longCopy.id))?.report.name.length : -1, 120);

  // -------------------------------------------------------------------------
  // Soft delete and restore
  // -------------------------------------------------------------------------
  const secretId = priv.ok ? priv.id : "";
  const del = await A.deleteReport(secretId);
  check("owner deletes", del.ok === true, del);
  eq("deleted report is not readable", await A.getReport(secretId), null);
  check("deleted report leaves the list", !(await A.listReports("mine")).some((r) => r.id === secretId));
  check("row is kept (soft delete)", h.db.state.reports.some((r) => r.id === secretId && r.deleted_at !== null));
  eq("writes on a deleted report are not_found", (await A.renameReport(secretId, "x")), { ok: false, code: "not_found" });
  eq("deleting twice is not_found", await A.deleteReport(secretId), { ok: false, code: "not_found" });
  eq("someone else cannot restore it", await B.restoreReport(secretId), { ok: false, code: "not_found" });
  const res = await A.restoreReport(secretId);
  check("owner restores", res.ok === true, res);
  check("restored report is readable again", (await A.getReport(secretId)) !== null);
  const again = await A.restoreReport(secretId);
  check("restoring a live report is refused", again.ok === false && again.code === "invalid", again);
  eq("restoring a missing report is not_found", await A.restoreReport(ID_MISSING), { ok: false, code: "not_found" });
  eq("malformed id is not_found", await A.deleteReport("nope"), { ok: false, code: "not_found" });

  // -------------------------------------------------------------------------
  // Pin and last opened
  // -------------------------------------------------------------------------
  const n1 = await A.createReport({ name: "N1" });
  const n2 = await A.createReport({ name: "N2" });
  const n3 = await A.createReport({ name: "N3" });
  const ids = [n1, n2, n3].map((r) => (r.ok ? r.id : ""));
  await A.touchOpened(ids[0]);
  await A.touchOpened(ids[1]);
  const order1 = (await A.listReports("mine")).map((r) => r.name).filter((n) => /^N\d$/.test(n));
  eq("last opened first among unpinned", order1.slice(0, 2), ["N2", "N1"]);
  await A.pinReport(ids[2], true);
  await A.pinReport(ids[0], true);
  const order2 = (await A.listReports("mine")).filter((r) => /^N\d$/.test(r.name));
  eq("pinned first, in pin order", order2.slice(0, 3).map((r) => r.name), ["N3", "N1", "N2"]);
  eq("pinned flag and position surface", [order2[0].pinned, order2[0].pinPosition, order2[1].pinPosition], [true, 0, 1]);
  await A.pinReport(ids[2], true);
  eq("re-pinning keeps the position", (await A.listReports("mine")).find((r) => r.name === "N3")?.pinPosition, 0);
  await A.pinReport(ids[2], false);
  eq("unpin", (await A.getReport(ids[2]))?.pinned, false);
  check("pin state is per user", (await B.getReport(id))?.pinned === false);
  eq("pin of a hidden report is not_found", await B.pinReport(ids[0], true), { ok: false, code: "not_found" });
  eq("pin returns the report version", (await A.pinReport(ids[0], true)), { ok: true, version: 1 });
  check("pin does not bump the version", (await A.getReport(ids[0]))?.report.version === 1);
  check("lastOpenedAt is set", (await A.getReport(ids[0]))?.lastOpenedAt !== null);
  eq("access_log rows for opens", h.audit.map((a) => a.detail), [`report:${ids[0]} clients=all`, `report:${ids[1]} clients=all`]);
  check("access_log rows carry the actor", h.audit.every((a) => a.email === owner && a.role === "agency"));
  const auditCount = h.audit.length;
  await B.touchOpened(ids[0]);
  eq("opening a hidden report records nothing", h.audit.length, auditCount);
  await A.touchOpened("not-a-uuid");
  eq("opening a bad id records nothing", h.audit.length, auditCount);

  // emails are case-insensitive at the gate
  const Mixed = harness();
  const M1 = Mixed.as("Owner@OneEighty.cz");
  const m = await M1.createReport({ name: "Case" });
  eq("owner email stored lower-cased", Mixed.db.state.reports[0].owner_email, "owner@oneeighty.cz");
  check("create returns an id", m.ok === true);

  // -------------------------------------------------------------------------
  // The actions file: every exported action opens with the access gate
  // -------------------------------------------------------------------------
  const actionsPath = join(process.cwd(), "app/(app)/reports/actions.ts");
  const src = readFileSync(actionsPath, "utf8");
  const exported = [...src.matchAll(/export async function (\w+)\([\s\S]*?\{\n([\s\S]*?)\n/g)];
  const expectedNames = ["createReport", "renameReport", "duplicateReport", "deleteReport", "restoreReport", "setVisibility", "saveReportFilters", "saveLayout", "addWidget", "updateWidget", "removeWidget", "pinReport", "touchOpened", "refreshReportData"];
  eq("actions file exports the contract's actions", exported.map((e) => e[1]).sort(), [...expectedNames].sort());
  for (const [, name, firstLine] of exported) {
    check(`${name} starts with assertReportsAccess()`, /assertReportsAccess\(\)/.test(firstLine), firstLine);
  }
  check("actions file starts with 'use server'", src.startsWith('"use server";'));
  check("actions import the gate from @/lib/authz", /import \{ assertReportsAccess \} from "@\/lib\/authz";/.test(src));
  check("actions file has no non-async exports", !/export (const|let|function|class|type|interface)\b/.test(src.replace(/export async function/g, "")));
  for (const file of ["lib/reports/store.ts", "lib/reports/templates.ts", "app/(app)/reports/actions.ts", "scripts/check-reports-store.ts"]) {
    check(`${file} has no em or en dash`, !DASH.test(readFileSync(join(process.cwd(), file), "utf8")));
  }

  if (failures.length > 0) {
    console.error(`FAIL ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log(`check:reports-store ${passed}/${passed} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
