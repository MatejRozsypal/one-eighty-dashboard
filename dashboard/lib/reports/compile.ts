/**
 * Widget compiler: one parameterized BigQuery query per widget (design 2.8).
 *
 * Rules this file enforces:
 * - SQL text is built only from registry constants (table, date, currency and
 *   component columns), the fixed BUCKET_SQL map and literals in this file.
 *   Every identifier is checked against IDENTIFIER_RE before it is emitted.
 * - User values travel only as typed params: @clientIds ARRAY<STRING>, the
 *   DATE params and @displayCurrency STRING. They are re-validated here
 *   (defence in depth; resolve.ts has already validated them).
 * - One CTE per mart touched; several marts are joined with
 *   FULL OUTER JOIN USING (client_id, period, bucket).
 * - The SQL returns component sums and row guards only. Every metric formula
 *   is evaluated in TypeScript (evaluate.ts).
 * - Money components are emitted twice: `<alias>__nat` (rows in the client's
 *   registry currency only) and `<alias>__disp` (every row converted per month
 *   into the display currency, FX triangulated through CZK).
 * - The comparison period runs in the same query, tagged `period = 'cmp'`.
 *   A row that falls in both ranges (previous year over a long range) is
 *   counted in both. Without a comparison the simpler variant is compiled.
 * - Every mart CTE carries a date predicate on the mart's dateColumn; the
 *   compiler asserts it on the final SQL text and throws if one is missing.
 *
 * Column aliases (read back by run.ts through componentAlias()):
 *   client_id, period, bucket,
 *   <mart>__n_rows, <mart>__foreign_ccy_rows, <mart>__fx_missing_rows, <mart>__fx_missing_months,
 *   <mart>__<column>__nat and <mart>__<column>__disp for money components,
 *   <mart>__<column> for every other component.
 *
 * The registry is injected: createCompiler({ marts, components }). The
 * registry data lives in registry/components.ts (WP1); see `compileWidget`
 * at the bottom of this file for the integration binding.
 *
 * Owner: WP2 (RS2).
 */

import "server-only";

import { createHash } from "node:crypto";
import { PROJECT_ID } from "@/lib/bigquery";
import {
  TOTAL_BUCKET,
  type BqParamType,
  type CompiledQuery,
  type CompileWidget,
  type ResolvedWidget,
} from "./contracts";
import {
  IDENTIFIER_RE,
  SEMANTIC_VERSION,
  type ComponentDef,
  type ComponentId,
  type MartDef,
  type MartId,
  type QueryGrain,
} from "./registry/types";

// ---------------------------------------------------------------------------
// Registry seam
// ---------------------------------------------------------------------------

/** What the compiler needs from the registry. COMPONENTS and MARTS (registry/components.ts) satisfy it. */
export interface CompilerRegistry {
  marts: Readonly<Partial<Record<MartId, MartDef>>>;
  components: Readonly<Partial<Record<ComponentId, ComponentDef>>>;
}

export interface CompilerOptions {
  /** GCP project prefixed to every table. Defaults to PROJECT_ID (lib/bigquery.ts). */
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed bucket expressions per grain, applied to the mart's date column. */
export const BUCKET_SQL: Readonly<Record<QueryGrain, (dateExpr: string) => string>> = {
  day: (d) => d,
  week: (d) => `DATE_TRUNC(${d}, ISOWEEK)`,
  month: (d) => `DATE_TRUNC(${d}, MONTH)`,
  total: () => `DATE '${TOTAL_BUCKET}'`,
};

/** Reference tables the compiler reads besides the marts. */
const REF_CLIENTS = "ref.clients";
const REF_FX = "ref.fx_rates";
/** FX pivot currency: every rate is expressed as "1 unit of X in CZK". */
const PIVOT = "CZK";

const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_ID_RE = /^[a-z0-9_]{1,40}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const COMPONENT_ID_RE = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/;

/** Guard column suffixes per mart, in emitted order. */
export const GUARD_COLUMNS = ["n_rows", "foreign_ccy_rows", "fx_missing_rows", "fx_missing_months"] as const;

// ---------------------------------------------------------------------------
// Helpers shared with run.ts
// ---------------------------------------------------------------------------

/** `kpis.revenue` -> `kpis__revenue`. The base alias of a component's column(s). */
export function componentAlias(id: ComponentId): string {
  const m = COMPONENT_ID_RE.exec(id);
  if (!m) throw new Error(`[reports/compile] Invalid component id ${JSON.stringify(id)}`);
  return `${m[1]}__${m[2]}`;
}

/** `kpis` + `n_rows` -> `kpis__n_rows`. */
export function guardAlias(mart: MartId, guard: (typeof GUARD_COLUMNS)[number]): string {
  return `${mart}__${guard}`;
}

function fail(message: string): never {
  throw new Error(`[reports/compile] ${message}`);
}

function ident(value: string, what: string): string {
  if (!IDENTIFIER_RE.test(value)) fail(`${what} ${JSON.stringify(value)} is not a safe identifier`);
  return value;
}

/** `dataset.table` -> `` `project.dataset.table` `` with every part checked. */
function tableRef(projectId: string, table: string): string {
  const parts = table.split(".");
  if (parts.length !== 2) fail(`Table ${JSON.stringify(table)} must be dataset.table`);
  parts.forEach((p) => ident(p, "Table part"));
  return `\`${projectId}.${parts[0]}.${parts[1]}\``;
}

function checkDate(value: string, what: string): string {
  if (!DATE_RE.test(value)) fail(`${what} ${JSON.stringify(value)} is not YYYY-MM-DD`);
  return value;
}

/** The exact predicate every mart CTE must carry. */
export function datePredicate(mart: Pick<MartDef, "dateColumn">): string {
  return `t.${ident(mart.dateColumn, "Date column")} BETWEEN @scanFrom AND @scanTo`;
}

/**
 * Throws unless every mart CTE in `sql` contains its date predicate.
 * Exported so check:reports can prove that a tampered query is rejected.
 */
export function assertDatePredicates(sql: string, marts: ReadonlyArray<Pick<MartDef, "id" | "dateColumn">>): void {
  for (const mart of marts) {
    const head = `\n${mart.id} AS (\n`;
    const start = sql.indexOf(head);
    if (start < 0) fail(`Mart CTE ${mart.id} not found`);
    const end = sql.indexOf("\n)", start + head.length);
    if (end < 0) fail(`Mart CTE ${mart.id} is not closed`);
    const body = sql.slice(start + head.length, end);
    if (!body.includes(datePredicate(mart))) fail(`Mart CTE ${mart.id} lacks its date predicate on ${mart.dateColumn}`);
  }
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

function fxCtes(projectId: string): string {
  const fx = tableRef(projectId, REF_FX);
  return [
    `fx_pairs AS (`,
    `  SELECT month_start, from_currency, to_currency, rate`,
    `  FROM ${fx}`,
    `  WHERE month_start BETWEEN DATE_TRUNC(@scanFrom, MONTH) AND DATE_TRUNC(@scanTo, MONTH)`,
    `),`,
    `fx_direct AS (`,
    `  SELECT month_start, from_currency AS ccy, rate AS to_czk`,
    `  FROM fx_pairs`,
    `  WHERE to_currency = '${PIVOT}' AND from_currency <> '${PIVOT}'`,
    `),`,
    `fx AS (`,
    `  SELECT month_start, ccy, to_czk`,
    `  FROM (`,
    `    SELECT month_start, ccy, to_czk, 1 AS priority FROM fx_direct`,
    `    UNION ALL`,
    `    SELECT a.month_start, a.from_currency, a.rate * d.to_czk, 2`,
    `    FROM fx_pairs AS a`,
    `    JOIN fx_direct AS d ON d.month_start = a.month_start AND d.ccy = a.to_currency`,
    `    WHERE a.from_currency <> '${PIVOT}'`,
    `    UNION ALL`,
    `    SELECT m, '${PIVOT}', NUMERIC '1', 0`,
    `    FROM UNNEST(GENERATE_DATE_ARRAY(DATE_TRUNC(@scanFrom, MONTH), DATE_TRUNC(@scanTo, MONTH), INTERVAL 1 MONTH)) AS m`,
    `  )`,
    `  WHERE to_czk > 0`,
    `  QUALIFY ROW_NUMBER() OVER (PARTITION BY month_start, ccy ORDER BY priority, to_czk) = 1`,
    `)`,
  ].join("\n");
}

interface MartPlan {
  mart: MartDef;
  components: ComponentDef[];
  money: boolean;
}

function martCte(plan: MartPlan, grain: QueryGrain, hasComparison: boolean, projectId: string): string {
  const { mart } = plan;
  const date = `t.${ident(mart.dateColumn, "Date column")}`;
  const ccyCol = mart.currencyColumn === null ? null : `t.${ident(mart.currencyColumn, "Currency column")}`;
  const fxMissing = `src.to_czk IS NULL OR dst.to_czk IS NULL`;
  const g = (name: (typeof GUARD_COLUMNS)[number]) => guardAlias(mart.id, name);

  const select: string[] = [
    `t.client_id`,
    hasComparison ? `p.period` : `'cur' AS period`,
    `${BUCKET_SQL[grain](date)} AS bucket`,
    `COUNT(*) AS ${g("n_rows")}`,
    ccyCol ? `COUNTIF(${ccyCol} <> c.currency) AS ${g("foreign_ccy_rows")}` : `0 AS ${g("foreign_ccy_rows")}`,
    plan.money ? `COUNTIF(${fxMissing}) AS ${g("fx_missing_rows")}` : `0 AS ${g("fx_missing_rows")}`,
    plan.money
      ? `ARRAY_AGG(DISTINCT IF(${fxMissing}, DATE_TRUNC(${date}, MONTH), NULL) IGNORE NULLS) AS ${g("fx_missing_months")}`
      : `ARRAY<DATE>[] AS ${g("fx_missing_months")}`,
  ];

  for (const c of plan.components) {
    const col = `t.${ident(c.column, "Component column")}`;
    const alias = componentAlias(c.id);
    if (c.money) {
      if (!ccyCol) fail(`Money component ${c.id} on mart ${mart.id} without a currency column`);
      select.push(`SUM(IF(${ccyCol} = c.currency, ${col}, NULL)) AS ${alias}__nat`);
      select.push(`SUM(${col} * src.to_czk / dst.to_czk) AS ${alias}__disp`);
    } else {
      select.push(`SUM(${col}) AS ${alias}`);
    }
  }

  const from: string[] = [`FROM ${tableRef(projectId, mart.table)} AS t`];
  if (ccyCol) from.push(`JOIN ${tableRef(projectId, REF_CLIENTS)} AS c ON c.client_id = t.client_id`);
  if (hasComparison) {
    from.push(
      `CROSS JOIN UNNEST([STRUCT('cur' AS period, @curFrom AS from_date, @curTo AS to_date), STRUCT('cmp', @cmpFrom, @cmpTo)]) AS p`
    );
  }
  if (plan.money) {
    from.push(`LEFT JOIN fx AS src ON src.month_start = DATE_TRUNC(${date}, MONTH) AND src.ccy = ${ccyCol}`);
    from.push(`LEFT JOIN fx AS dst ON dst.month_start = DATE_TRUNC(${date}, MONTH) AND dst.ccy = @displayCurrency`);
  }

  const where = [
    `WHERE t.client_id IN UNNEST(@clientIds)`,
    `  AND ${datePredicate(mart)}`,
    hasComparison ? `  AND ${date} BETWEEN p.from_date AND p.to_date` : `  AND ${date} BETWEEN @curFrom AND @curTo`,
  ];

  return [
    `${mart.id} AS (`,
    `  SELECT`,
    select.map((s) => `    ${s}`).join(",\n"),
    ...from.map((f) => `  ${f}`),
    ...where.map((w) => `  ${w}`),
    `  GROUP BY 1, 2, 3`,
    `)`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/** Compile one resolved widget against an explicit registry. */
export function compileWidgetWith(
  widget: ResolvedWidget,
  registry: CompilerRegistry,
  options: CompilerOptions = {}
): CompiledQuery {
  const projectId = options.projectId ?? PROJECT_ID;
  if (!PROJECT_RE.test(projectId)) fail(`Project id ${JSON.stringify(projectId)} is not valid`);

  const grain = widget.grain;
  if (!(grain in BUCKET_SQL)) fail(`Unknown grain ${JSON.stringify(grain)}`);

  // Components: sorted, unique, all known, each consistent with its id.
  const componentIds = [...new Set(widget.components)].sort();
  if (componentIds.length === 0) fail("Widget has no components");
  const byMart = new Map<MartId, ComponentDef[]>();
  for (const id of componentIds) {
    const def = registry.components[id];
    if (!def) fail(`Unknown component ${id}`);
    const m = COMPONENT_ID_RE.exec(id);
    if (!m || def.id !== id || def.mart !== m[1]) fail(`Component ${id} does not match its definition`);
    ident(def.column, "Component column");
    const list = byMart.get(def.mart) ?? [];
    list.push(def);
    byMart.set(def.mart, list);
  }

  const martIds = [...byMart.keys()].sort();
  for (const id of martIds) {
    if (!widget.marts.includes(id)) fail(`Component mart ${id} is missing from widget.marts`);
  }

  const plans: MartPlan[] = martIds.map((id) => {
    const mart = registry.marts[id];
    if (!mart || mart.id !== id) fail(`Unknown mart ${id}`);
    ident(mart.id, "Mart id");
    if (grain !== "total" && !mart.grains.includes(grain)) fail(`Mart ${id} does not support grain ${grain}`);
    const components = byMart.get(id) ?? [];
    return { mart, components, money: components.some((c) => c.money) };
  });
  const anyMoney = plans.some((p) => p.money);

  // Params: re-validated, sorted, built in a fixed order (the key depends on it).
  const clientIds = [...new Set(widget.queryClientIds)].sort();
  for (const id of clientIds) {
    if (!CLIENT_ID_RE.test(id)) fail(`Client id ${JSON.stringify(id)} is not valid`);
  }
  const { current, comparison } = widget.period;
  const hasComparison = comparison !== null;

  const params: Record<string, string | string[]> = { clientIds };
  const types: Record<string, BqParamType> = { clientIds: ["STRING"] };
  const addDate = (name: string, value: string) => {
    params[name] = checkDate(value, name);
    types[name] = "DATE";
  };
  addDate("curFrom", current.from);
  addDate("curTo", current.to);
  if (comparison) {
    addDate("cmpFrom", comparison.from);
    addDate("cmpTo", comparison.to);
  }
  addDate("scanFrom", widget.scan.from);
  addDate("scanTo", widget.scan.to);
  if (params.scanFrom > params.curFrom || params.scanTo < params.curTo) fail("Scan bounds do not cover the current range");
  if (comparison && (params.scanFrom > comparison.from || params.scanTo < comparison.to)) {
    fail("Scan bounds do not cover the comparison range");
  }
  if (anyMoney) {
    if (!CURRENCY_RE.test(widget.displayCurrency)) fail(`Display currency ${JSON.stringify(widget.displayCurrency)} is not valid`);
    params.displayCurrency = widget.displayCurrency;
    types.displayCurrency = "STRING";
  }

  // SQL.
  const ctes: string[] = [];
  if (anyMoney) ctes.push(fxCtes(projectId));
  for (const plan of plans) ctes.push(martCte(plan, grain, hasComparison, projectId));

  const [first, ...rest] = martIds;
  const fromClause = [first, ...rest.map((id) => `FULL OUTER JOIN ${id} USING (client_id, period, bucket)`)].join("\n");
  const sql = [`WITH`, ctes.join(",\n"), `SELECT *`, `FROM ${fromClause}`, `ORDER BY client_id, period, bucket`].join("\n");

  assertDatePredicates(sql, plans.map((p) => p.mart));

  const key = createHash("sha256").update(JSON.stringify({ sv: SEMANTIC_VERSION, sql, params })).digest("hex");

  return {
    key,
    sql,
    params,
    types,
    marts: martIds,
    components: componentIds,
    hasComparison,
  };
}

/** A CompileWidget bound to one registry. */
export function createCompiler(registry: CompilerRegistry, options: CompilerOptions = {}): CompileWidget {
  return (widget) => compileWidgetWith(widget, registry, options);
}

// ---------------------------------------------------------------------------
// Integration binding
// ---------------------------------------------------------------------------
//
// registry/components.ts (WP1, RS1) is written in parallel and does not exist
// on this branch, so the contract export is bound when the branches meet.
// After merging RS1, replace this section with:
//
//   import { COMPONENTS, MARTS } from "./registry/components";
//   export const compileWidget: CompileWidget = createCompiler({ marts: MARTS, components: COMPONENTS });
//
// Until then compileWidget fails closed with a clear message; createCompiler()
// and compileWidgetWith() are fully usable with any registry.

export const compileWidget: CompileWidget = () =>
  fail("No registry bound: import COMPONENTS and MARTS from registry/components.ts (see the integration note)");
