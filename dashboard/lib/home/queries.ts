import "server-only";

/**
 * Home: every client's health in one read.
 *
 * ── Where each answer comes from ───────────────────────────────────────────
 * Status          ref.clients.status, and the task status in ClickUp Client
 *                 Success > Clients.
 * Results         The Goals pacing rows for the current month (mart.plan_pacing),
 *                 the same rows and status the Goals page shows. A metric the
 *                 plan does not target falls back to the daily actuals
 *                 (mart.plan_actuals_daily), and so does a client with no plan.
 *                 Month to date against the same days a year earlier comes from
 *                 the same daily actuals.
 * After our fees  Last complete month of mart.mart_profit_share_monthly, minus
 *                 the retainer and profit share in ref.contracts.
 * Generated       Sum of CM3 over the frozen baseline (ref.cm3_baseline), as the
 *                 profit share mart computes it.
 * Received        No source. Payments are in Pohoda, which is not connected.
 * Profit share    Latest ops.profit_share_statements row, else the mart's latest
 *                 complete month. The ClickUp Invoice Tracker's last invoice is
 *                 shown beside it as what was invoiced.
 *
 * ── Never a guessed number ─────────────────────────────────────────────────
 * The page computes only sums and differences of warehouse figures. The ring
 * and its tone are the pacing row's own status. A figure a source cannot give
 * is null with a note naming the source, and the card renders n/a with it.
 *
 * The agency money layer (contracts, baseline, statements) is read through
 * `readState`, which keeps a permission error from taking Home down: it is
 * logged, and every figure that needed the source says it could not be read.
 * The pacing and actuals reads use `optional`, as Goals does.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { getClientsIncludingInactive, type Client } from "@/lib/clients";
import { isMissingObject, optional } from "@/lib/queries/errors";
import { PACING_COLUMNS, RATIO_COLUMNS, toPacingRow, withFallback } from "@/lib/queries/plan";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { planStatusTone } from "@/lib/plan/health";
import type { PacingRow } from "@/lib/plan/types";
import { matchKey, readCrm, type CrmClient, type CrmRead } from "./clickup";
import type { ClientHealth, Figure, HomeData, MonthMetric, SourceState } from "./types";

type Raw = Record<string, unknown>;

const T = (dataset: string, table: string) => `\`${PROJECT_ID}.${dataset}.${table}\``;

/* ------------------------------------------------------------------------ */
/* Reads                                                                    */
/* ------------------------------------------------------------------------ */

/** The current month's pacing rows of every client (the month holding each client's as of). */
async function fetchMonthPacing(): Promise<Array<PacingRow & { clientId: string }>> {
  const read = (columns: string) =>
    query<Raw>(
      `SELECT client_id, ${columns}
       FROM ${PLAN_TABLES.pacing}
       WHERE period_type = 'month' AND period_id = FORMAT_DATE('%Y-%m', as_of)`
    );
  const rows = await withFallback(
    () => read(`${PACING_COLUMNS}, ${RATIO_COLUMNS}`),
    () => read(PACING_COLUMNS)
  );
  return rows.map((r) => ({ ...toPacingRow(r), clientId: String(r.client_id) }));
}

interface ActualsRow {
  clientId: string;
  asOf: string | null;
  revenue: number | null;
  daysLy: number;
  revenueLy: number | null;
  cm3: number | null;
  cm3Gaps: number;
  cm3Ly: number | null;
  cm3GapsLy: number;
  ncr: number | null;
  paid: number | null;
  paidGaps: number;
}

/**
 * Month to date per client, and the same days a year earlier, from the plan's
 * daily actuals. "Month" is the month of each client's own last day of data,
 * which is the as of the pacing rows use.
 */
async function fetchActuals(): Promise<ActualsRow[]> {
  const sql = (withCm3: boolean) => `
    WITH a AS (
      SELECT * FROM ${PLAN_TABLES.actualsDaily}
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 400 DAY)
    ),
    x AS (SELECT client_id, MAX(date) AS last_day FROM a GROUP BY client_id),
    t AS (
      SELECT a.*, x.last_day,
        a.date BETWEEN DATE_TRUNC(x.last_day, MONTH) AND x.last_day AS cur,
        a.date BETWEEN DATE_SUB(DATE_TRUNC(x.last_day, MONTH), INTERVAL 1 YEAR)
                   AND DATE_SUB(x.last_day, INTERVAL 1 YEAR) AS ly
      FROM a JOIN x USING (client_id)
    )
    SELECT client_id, ANY_VALUE(last_day) AS last_day,
      SUM(IF(cur, revenue, NULL)) AS revenue,
      COUNTIF(ly) AS days_ly,
      SUM(IF(ly, revenue, NULL)) AS revenue_ly,
      ${
        withCm3
          ? `SUM(IF(cur, cm3, NULL)) AS cm3,
      COUNTIF(cur AND cm3 IS NULL) AS cm3_gaps,
      SUM(IF(ly, cm3, NULL)) AS cm3_ly,
      COUNTIF(ly AND cm3 IS NULL) AS cm3_gaps_ly,
      SUM(IF(cur, new_customer_revenue, NULL)) AS ncr,
      SUM(IF(cur, paid_spend, NULL)) AS paid,
      COUNTIF(cur AND paid_spend IS NULL) AS paid_gaps`
          : `NULL AS cm3, 1 AS cm3_gaps, NULL AS cm3_ly, 1 AS cm3_gaps_ly,
      NULL AS ncr, NULL AS paid, 1 AS paid_gaps`
      }
    FROM t
    GROUP BY client_id`;
  const rows = await withFallback(
    () => query<Raw>(sql(true)),
    () => query<Raw>(sql(false))
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    asOf: isoDate(r.last_day as Parameters<typeof isoDate>[0]),
    revenue: num(r.revenue),
    daysLy: num(r.days_ly) ?? 0,
    revenueLy: num(r.revenue_ly),
    cm3: num(r.cm3),
    cm3Gaps: num(r.cm3_gaps) ?? 0,
    cm3Ly: num(r.cm3_ly),
    cm3GapsLy: num(r.cm3_gaps_ly) ?? 0,
    ncr: num(r.ncr),
    paid: num(r.paid),
    paidGaps: num(r.paid_gaps) ?? 0,
  }));
}

interface Read<T> {
  state: SourceState;
  rows: T[];
}

/**
 * A read whose failure must not take Home down: a missing object, a refused
 * permission or any other error comes back as a state, and the error is
 * logged. The figures that needed it then say which source could not be read.
 */
async function readState<T>(label: string, run: () => Promise<T[]>): Promise<Read<T>> {
  try {
    const rows = await run();
    return { state: rows.length === 0 ? "empty" : "ok", rows };
  } catch (error) {
    if (isMissingObject(error)) return { state: "missing", rows: [] };
    const message = String((error as { message?: string } | null)?.message ?? error);
    console.error(`[home] ${label} unreadable: ${message}`);
    return { state: /permission|access denied/i.test(message) ? "denied" : "error", rows: [] };
  }
}

interface ContractRow {
  clientId: string;
  retainerCzk: number | null;
  profitSharePct: number | null;
  start: string | null;
}

async function fetchContracts(): Promise<ContractRow[]> {
  const rows = await query<Raw>(
    `SELECT client_id, retainer_czk, profit_share_pct, contract_start_date
     FROM ${T("ref", "contracts")}
     WHERE valid_from <= CURRENT_DATE() AND (valid_to IS NULL OR valid_to >= CURRENT_DATE())`
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    retainerCzk: num(r.retainer_czk),
    profitSharePct: num(r.profit_share_pct),
    start: isoDate(r.contract_start_date as Parameters<typeof isoDate>[0]),
  }));
}

interface ShareMonth {
  clientId: string;
  month: string;
  cm3: number | null;
  cm3Delta: number | null;
  profitSharePct: number | null;
  profitShareCzk: number | null;
  isComplete: boolean;
  hasBaseline: boolean;
}

async function fetchShareMonths(): Promise<ShareMonth[]> {
  const rows = await query<Raw>(
    `SELECT client_id, month, cm3, cm3_delta, profit_share_pct, profit_share_czk,
            is_complete, has_frozen_baseline
     FROM ${T("mart", "mart_profit_share_monthly")}
     ORDER BY client_id, month`
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    month: isoDate(r.month as Parameters<typeof isoDate>[0]) ?? "",
    cm3: num(r.cm3),
    cm3Delta: num(r.cm3_delta),
    profitSharePct: num(r.profit_share_pct),
    profitShareCzk: num(r.profit_share_czk),
    isComplete: r.is_complete === true,
    hasBaseline: r.has_frozen_baseline === true,
  }));
}

interface Statement {
  clientId: string;
  month: string;
  status: string | null;
  profitShareCzk: number | null;
  profitSharePct: number | null;
}

/** The latest statement per client. */
async function fetchStatements(): Promise<Statement[]> {
  const rows = await query<Raw>(
    `SELECT client_id, month, status, profit_share_czk, profit_share_pct
     FROM ${T("ops", "profit_share_statements")}
     WHERE TRUE
     QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY month DESC, generated_at DESC) = 1`
  );
  return rows.map((r) => ({
    clientId: String(r.client_id),
    month: isoDate(r.month as Parameters<typeof isoDate>[0]) ?? "",
    status: r.status === null || r.status === undefined ? null : String(r.status),
    profitShareCzk: num(r.profit_share_czk),
    profitSharePct: num(r.profit_share_pct),
  }));
}

/* ------------------------------------------------------------------------ */
/* Notes: why a figure is n/a                                               */
/* ------------------------------------------------------------------------ */

function unreadable(source: string, state: SourceState): string | null {
  if (state === "denied") return `No read access to ${source}.`;
  if (state === "missing") return `${source} does not exist.`;
  if (state === "error") return `${source} could not be read.`;
  return null;
}

const NO_PAYMENTS =
  "No payments source. Payments are booked in Pohoda, which is not connected; the ClickUp Invoice Tracker records invoices, not payments.";

function figure(value: number | null, note: string | null): Figure {
  return { value, note: value === null ? note ?? "Not available." : null };
}

/** "2026-09-01" -> "September 2026". */
function monthName(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------------------------------ */
/* Assembly                                                                 */
/* ------------------------------------------------------------------------ */

function metric(row: PacingRow | undefined, fallback: number | null): MonthMetric {
  const targeted = row && row.target !== null && row.status !== "no_target";
  return { actual: row?.actual ?? fallback, row: targeted ? row : null };
}

/** Lower is shown first: clients that need attention lead. */
function urgency(c: ClientHealth): number {
  if (!c.clientId) return 5;
  if (!c.focus) return 4;
  const tone = planStatusTone(c.focus.status, c.focus.metric, c.focus.result);
  return tone === "negative" ? 0 : tone === "warning" ? 1 : tone === "neutral" ? 3 : 2;
}

interface Sources {
  pacing: Array<PacingRow & { clientId: string }>;
  actuals: ActualsRow[];
  contracts: Read<ContractRow>;
  share: Read<ShareMonth>;
  statements: Read<Statement>;
  crm: CrmRead;
}

function buildClient(client: Client, crm: CrmClient | undefined, s: Sources): ClientHealth {
  const id = client.clientId;
  const rows = s.pacing.filter((r) => r.clientId === id);
  const byMetric = (m: string) => rows.find((r) => r.metric === m);
  const act = s.actuals.find((a) => a.clientId === id);

  const revenueRow = byMetric("revenue");
  const cm3Row = byMetric("cm3");
  const amerRow = byMetric("amer");

  const revenue = metric(revenueRow, act?.revenue ?? null);
  const cm3 = metric(cm3Row, act && act.cm3Gaps === 0 ? act.cm3 : null);
  const amerFallback = act && act.paidGaps === 0 && act.paid !== null && act.paid > 0 ? (act.ncr ?? 0) / act.paid : null;
  const amer = metric(amerRow, amerFallback);
  // CM3 is what the profit share is paid on, so it carries the ring when the
  // plan targets it and the data can measure it; revenue otherwise.
  const focus = (cm3.row && cm3.row.status !== "not_measured" ? cm3.row : null) ?? revenue.row ?? null;

  // Month to date against the same days a year earlier.
  const revenueVsLastYear =
    act && act.daysLy > 0 && act.revenueLy !== null && act.revenueLy > 0 && act.revenue !== null
      ? figure((act.revenue - act.revenueLy) / act.revenueLy, null)
      : figure(null, act && act.daysLy === 0 ? "No data for the same days last year." : "No revenue on the same days last year.");
  // A year with no sales has a CM3 of zero, which is not a base to compare with.
  const cm3VsLastYear =
    act && act.revenueLy !== null && act.revenueLy > 0 && act.cm3Gaps === 0 && act.cm3GapsLy === 0 && act.cm3 !== null && act.cm3Ly !== null
      ? figure(act.cm3 - act.cm3Ly, null)
      : figure(
          null,
          act && (act.revenueLy === null || act.revenueLy <= 0)
            ? "No revenue on the same days last year."
            : "CM3 needs cost data on every day this month and on the same days last year."
        );

  // ── The agency money layer ──────────────────────────────────────────────
  const contract = s.contracts.rows.find((c) => c.clientId === id);
  const months = s.share.rows.filter((m) => m.clientId === id);
  const statement = s.statements.rows.find((m) => m.clientId === id);

  const contractGap =
    unreadable("ref.contracts", s.contracts.state) ??
    (contract ? null : "No contract terms for this client in ref.contracts.");
  const martGap =
    contractGap ??
    unreadable("mart_profit_share_monthly", s.share.state) ??
    (client.shopPlatform !== "woocommerce"
      ? "Contract CM3 (mart_cm3_monthly) is built from WooCommerce orders only."
      : null);

  const baselined = months.filter((m) => m.isComplete && m.hasBaseline && m.cm3Delta !== null);
  const generated = baselined.length
    ? { ...figure(baselined.reduce((sum, m) => sum + (m.cm3Delta ?? 0), 0), null), months: baselined.length }
    : {
        ...figure(null, martGap ?? "No complete month with a frozen baseline in ref.cm3_baseline."),
        months: 0,
      };

  const lastComplete = [...months].reverse().find((m) => m.isComplete && m.profitShareCzk !== null);
  const shareSource = statement && statement.profitShareCzk !== null ? statement : null;
  const profitShare = shareSource
    ? {
        ...figure(shareSource.profitShareCzk, null),
        month: monthName(shareSource.month),
        pct: shareSource.profitSharePct ?? contract?.profitSharePct ?? null,
      }
    : lastComplete
      ? { ...figure(lastComplete.profitShareCzk, null), month: monthName(lastComplete.month), pct: lastComplete.profitSharePct }
      : {
          ...figure(
            null,
            unreadable("ops.profit_share_statements", s.statements.state) ??
              martGap ??
              "No complete month with a frozen baseline in ref.cm3_baseline."
          ),
          month: null,
          pct: contract?.profitSharePct ?? null,
        };

  // A client found in the rows that were read keeps its ClickUp fields even
  // when a later page of the list failed; only the unmatched ones say why.
  const crmGap = crm
    ? null
    : s.crm.state === "not_configured"
      ? "ClickUp not connected."
      : s.crm.state === "denied"
        ? "ClickUp refused the token for the Clients list."
        : unreadable("the ClickUp Clients list", s.crm.state) ?? "No matching task in the ClickUp Clients list.";
  const retainer =
    contract?.retainerCzk !== null && contract?.retainerCzk !== undefined
      ? { ...figure(contract.retainerCzk, null), source: "contract" as const }
      : crm?.retainerCzk !== null && crm?.retainerCzk !== undefined
        ? { ...figure(crm.retainerCzk, null), source: "clickup" as const }
        : {
            ...figure(null, crmGap ?? "No Retainer CZK on the ClickUp task, and no contract in ref.contracts."),
            source: null,
          };

  // What the client keeps: last complete month's contract CM3 after both fees.
  // Fees are in CZK, so only a CZK client's CM3 can be netted against them.
  const keptAfterFees = (() => {
    if (!lastComplete || !contract)
      return { ...figure(null, martGap ?? "No complete month with a frozen baseline in ref.cm3_baseline."), month: null };
    if (client.currency !== "CZK")
      return { ...figure(null, `Fees are in CZK and this client trades in ${client.currency}.`), month: null };
    if (lastComplete.cm3 === null || contract.retainerCzk === null)
      return { ...figure(null, "Retainer or CM3 missing for the last complete month."), month: null };
    return {
      ...figure(lastComplete.cm3 - contract.retainerCzk - (lastComplete.profitShareCzk ?? 0), null),
      month: monthName(lastComplete.month),
    };
  })();

  return {
    key: id,
    clientId: id,
    name: client.name,
    currency: client.currency,
    registryStatus: client.status,
    crmStatus: crm?.status ?? null,
    crmUrl: crm?.url ?? null,
    asOf: rows[0]?.asOf || act?.asOf || null,
    monthLabel: rows[0]?.label ?? monthName(act?.asOf ? `${act.asOf.slice(0, 7)}-01` : null),
    focus,
    revenue,
    cm3,
    amer,
    revenueVsLastYear,
    cm3VsLastYear,
    keptAfterFees,
    generated,
    received: figure(null, NO_PAYMENTS),
    retainer,
    profitShare,
    billingType: crm?.billingType ?? null,
    lastInvoice: crm?.lastInvoice ?? null,
    lastInvoiceNote: invoiceNote(crm, s.crm),
  };
}

function invoiceNote(crm: CrmClient | undefined, read: CrmRead): string | null {
  if (crm?.lastInvoice) return null;
  if (read.invoiceState === "not_configured") return "ClickUp not connected.";
  if (read.invoiceState === "denied") return "ClickUp refused the token for the Invoice Tracker.";
  return (
    unreadable("the ClickUp Invoice Tracker", read.invoiceState) ??
    (crm ? "No invoice for this client in the ClickUp Invoice Tracker." : "No matching task in the ClickUp Clients list.")
  );
}

/** A client the owners track in ClickUp that the warehouse registry does not hold. */
function crmOnlyClient(crm: CrmClient, s: Sources): ClientHealth {
  const noData = figure(null, "Not in the warehouse registry (ref.clients).");
  const empty: MonthMetric = { actual: null, row: null };
  return {
    key: crm.taskId,
    clientId: null,
    name: crm.name,
    currency: null,
    registryStatus: null,
    crmStatus: crm.status,
    crmUrl: crm.url,
    asOf: null,
    monthLabel: null,
    focus: null,
    revenue: empty,
    cm3: empty,
    amer: empty,
    revenueVsLastYear: noData,
    cm3VsLastYear: noData,
    keptAfterFees: { ...noData, month: null },
    generated: { ...noData, months: 0 },
    received: figure(null, NO_PAYMENTS),
    retainer:
      crm.retainerCzk !== null
        ? { ...figure(crm.retainerCzk, null), source: "clickup" }
        : { ...figure(null, "No Retainer CZK on the ClickUp task."), source: null },
    profitShare: { ...noData, month: null, pct: null },
    billingType: crm.billingType,
    lastInvoice: crm.lastInvoice,
    lastInvoiceNote: invoiceNote(crm, s.crm),
  };
}

export async function getHomeData(): Promise<HomeData> {
  // The profit share mart is a view over every WooCommerce order and costs real
  // slot time, and it joins ref.contracts, so with no contract it can only be
  // empty: it is read only once a contract exists.
  const money = readState("ref.contracts", fetchContracts).then(async (contracts) => {
    const skip: Read<ShareMonth> = { state: "empty", rows: [] };
    const share = contracts.rows.length ? await readState("mart_profit_share_monthly", fetchShareMonths) : skip;
    return { contracts, share };
  });

  const [registry, pacing, actuals, { contracts, share }, statements, crm] = await Promise.all([
    getClientsIncludingInactive(),
    optional(fetchMonthPacing, [] as Array<PacingRow & { clientId: string }>),
    optional(fetchActuals, [] as ActualsRow[]),
    money,
    readState("ops.profit_share_statements", fetchStatements),
    readCrm(),
  ]);
  const sources: Sources = { pacing, actuals, contracts, share, statements, crm };

  const crmByKey = new Map(crm.clients.map((c) => [matchKey(c.name), c]));
  const matched = new Set<string>();
  const cards = registry.map((client) => {
    const hit = crmByKey.get(client.clientId) ?? crmByKey.get(matchKey(client.name));
    if (hit) matched.add(hit.taskId);
    return buildClient(client, hit, sources);
  });

  // ClickUp clients the registry does not hold, churned ones left out.
  for (const c of crm.clients) {
    if (!matched.has(c.taskId) && c.status !== "churned") cards.push(crmOnlyClient(c, sources));
  }

  cards.sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name));

  const withPlan = cards.filter((c) => c.focus);
  const onPlan = withPlan.filter((c) => c.focus && (c.focus.status === "on_track" || c.focus.status === "ahead"));
  const retainers = cards.flatMap((c) => (c.retainer.value === null ? [] : [c.retainer.value]));

  return {
    clients: cards,
    summary: {
      clients: cards.length,
      onPlan: onPlan.length,
      withPlan: withPlan.length,
      retainersCzk: retainers.length ? retainers.reduce((a, b) => a + b, 0) : null,
      retainersNote: retainers.length
        ? null
        : crm.state === "not_configured"
          ? "ClickUp not connected."
          : "No retainer found in ref.contracts or ClickUp.",
    },
  };
}
