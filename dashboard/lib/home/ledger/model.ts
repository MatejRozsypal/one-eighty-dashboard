/**
 * The ledger, assembled. Pure: every input is a finished read, so the same
 * function serves the page and a fixture.
 *
 * ── What is computed here, and nothing else ────────────────────────────────
 * Sums and differences of source figures, and one ratio:
 *   CM3 in CZK      month CM3 (mart.plan_actuals_daily) x that month's rate
 *                   in ref.fx_rates (1 for a CZK client)
 *   fees            retainer + profit share for the same month
 *   client keeps    CM3 in CZK - fees
 *   per 1 CZK paid  client keeps / fees
 * A figure needs every input it is made of. One missing input makes it null,
 * with a note naming the missing source; nothing is filled with a zero, except
 * the profit share of a client whose billing type has none (Monthly Retainer).
 *
 * ── Which month ────────────────────────────────────────────────────────────
 * The split and the ratio are for the last complete month of data: the month
 * before the month of the latest day in the actuals. A month to date set
 * against a whole month's retainer would read as a loss every first week.
 * The trend is the six complete months up to and including that one.
 */

import type { ClientHealth, HomeData, SourceState } from "@/lib/home/types";
import type { Invoice } from "./invoices";
import type { Fee, Figure, LedgerData, Partnership, SettledMonth, SetupItem, TrendMonth } from "./types";

export interface Read<T> {
  state: SourceState;
  rows: T[];
}

/** One client-month of the plan's daily actuals, with the month's rate to CZK. */
export interface MonthRow {
  clientId: string;
  /** "2026-09-01". */
  month: string;
  /** The client's latest day of data overall. */
  lastDay: string | null;
  days: number;
  revenue: number | null;
  cm3: number | null;
  /** Days that month with no CM3 (no cost data). */
  cm3Gaps: number;
  currency: string;
  /** ref.fx_rates, currency -> CZK, that month. Null when no row. */
  rate: number | null;
}

export interface RegistryRow {
  clientId: string;
  name: string;
  currency: string;
  shopPlatform: string | null;
}

export interface LedgerInputs {
  now: Date;
  home: HomeData;
  registry: RegistryRow[];
  months: Read<MonthRow>;
  invoices: { state: SourceState; invoices: Invoice[] };
  /** Client ids with a contract valid today. */
  contracts: Read<string>;
  /** Client ids with frozen baseline months. */
  baseline: Read<string>;
  monthlyCosts: Read<{ clientId: string; month: string }>;
  statements: Read<{ clientId: string; month: string }>;
}

export const TREND_MONTHS = 6;

const CLICKUP_WORKSPACE = "90151448219";
const CLICKUP_CLIENTS = `https://app.clickup.com/${CLICKUP_WORKSPACE}/v/li/901522365067`;
const CLICKUP_INVOICES = `https://app.clickup.com/${CLICKUP_WORKSPACE}/v/li/901522370596`;

function bqTable(dataset: string, table: string): string {
  return `https://console.cloud.google.com/bigquery?project=oneeighty-warehouse&ws=!1m5!1m4!4m3!1soneeighty-warehouse!2s${dataset}!3s${table}`;
}

/* ------------------------------------------------------------------------ */
/* Dates (UTC, ISO "YYYY-MM-DD")                                            */
/* ------------------------------------------------------------------------ */

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d || 1];
}

function monthStart(iso: string): string {
  const [y, m] = parts(iso);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function addMonths(iso: string, n: number): string {
  const [y, m] = parts(iso);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

function monthEnd(iso: string): string {
  const [y, m] = parts(iso);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function monthLabel(iso: string, style: "long" | "short", withYear = false): string {
  const [y, m] = parts(iso);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: style,
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function dayLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "2026-09-01" -> "09/26", the Invoice Tracker's period. */
function trackerPeriod(iso: string): string {
  const [y, m] = parts(iso);
  return `${String(m).padStart(2, "0")}/${String(y).slice(2)}`;
}

/** The months of the trend, oldest first; the last one is the settled month. */
export function trendMonths(rows: MonthRow[], now: Date): string[] {
  const last = rows.reduce<string | null>((max, r) => (r.lastDay && (!max || r.lastDay > max) ? r.lastDay : max), null);
  const anchor = last ?? now.toISOString().slice(0, 10);
  // The anchor's own month counts when the data reaches its last day.
  const settled = anchor === monthEnd(anchor) ? monthStart(anchor) : addMonths(monthStart(anchor), -1);
  return Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(settled, i - (TREND_MONTHS - 1)));
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

function fig(value: number | null, note: string | null): Figure {
  return { value, note: value === null ? note ?? "Not available." : null };
}

/** Lowercase, no diacritics, first word: "Dobias Healing Solutions" -> "dobias". */
function matchKey(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/)?.[0] ?? ""
  );
}

/** ".../t/86c1abc" -> "86c1abc". */
function taskIdOf(url: string | null): string | null {
  return url?.match(/\/t\/([^/?#]+)/)?.[1] ?? null;
}

function hasNoProfitShare(billingType: string | null): boolean {
  return !!billingType && /retainer/i.test(billingType) && !/share/i.test(billingType);
}

function unreadable(source: string, state: SourceState): string | null {
  if (state === "denied") return `No read access to ${source}.`;
  if (state === "missing") return `${source} does not exist.`;
  if (state === "error") return `${source} could not be read.`;
  if (state === "not_configured") return "ClickUp not connected.";
  return null;
}

function invoicesOf(client: ClientHealth, invoices: Invoice[]): Invoice[] {
  const id = taskIdOf(client.crmUrl);
  const key = matchKey(client.name);
  return invoices.filter(
    (inv) =>
      inv.clients.some((c) => (id && c.id === id) || (c.name && matchKey(c.name) === key)) ||
      (inv.clients.length === 0 && matchKey(inv.name.split("|")[0] ?? "") === key)
  );
}

function sumOrNull(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/* ------------------------------------------------------------------------ */
/* One partnership                                                          */
/* ------------------------------------------------------------------------ */

function cm3InCzk(row: MonthRow | undefined, month: string): { value: number | null; note: string | null } {
  const name = monthLabel(month, "long");
  if (!row) return { value: null, note: `No actuals for ${name} in mart.plan_actuals_daily.` };
  if (row.lastDay && row.lastDay < monthEnd(month)) return { value: null, note: `Data ends ${dayLabel(row.lastDay)}.` };
  if (row.cm3Gaps > 0 || row.cm3 === null)
    return { value: null, note: `No cost data on ${row.cm3Gaps} of ${row.days} days in ${name}, so no CM3.` };
  if (row.currency === "CZK") return { value: row.cm3, note: null };
  if (row.rate === null) return { value: null, note: `No ${row.currency} to CZK rate for ${name} in ref.fx_rates.` };
  return { value: row.cm3 * row.rate, note: null };
}

function agreedRetainer(c: ClientHealth): Fee {
  return c.retainer.value !== null
    ? { value: c.retainer.value, note: null, source: "agreed" }
    : { value: null, note: c.retainer.note ?? "No agreed retainer.", source: null };
}

function settle(c: ClientHealth, month: string | null, rows: MonthRow[], invoices: Invoice[], monthsNote: string | null, invoiceNote: string | null): SettledMonth {
  const empty = (note: string): SettledMonth => ({
    month,
    label: month ? monthLabel(month, "long") : null,
    cm3Czk: fig(null, note),
    retainer: { ...agreedRetainer(c) },
    profitShare: { value: null, note, source: null },
    fees: fig(null, note),
    afterRetainer: fig(null, note),
    keeps: fig(null, note),
    perKoruna: fig(null, note),
    perKorunaCeiling: null,
  });
  if (!c.clientId) return empty("Not in the warehouse registry (ref.clients), so no shop data.");
  if (!month) return empty(monthsNote ?? "No complete month in mart.plan_actuals_daily.");

  const name = monthLabel(month, "long");
  const period = trackerPeriod(month);
  const cm3 = monthsNote ? { value: null, note: monthsNote } : cm3InCzk(rows.find((r) => r.month === month), month);
  const cm3Czk = fig(cm3.value, cm3.note);

  // Fees: an invoice for the month wins; else the agreed retainer.
  const inv = invoices.filter((i) => i.month === month);
  const invoicedAmount = sumOrNull(inv.map((i) => i.amountCzk));
  const invoicedShare = sumOrNull(inv.map((i) => i.profitShareCzk));

  const retainer: Fee =
    invoicedAmount !== null
      ? { value: invoicedAmount, note: null, source: "invoiced" }
      : agreedRetainer(c);

  const statementMonth = c.profitShare.month; // "September 2026"
  const profitShare: Fee =
    c.profitShare.value !== null && statementMonth === monthLabel(month, "long", true)
      ? { value: c.profitShare.value, note: null, source: "statement" }
      : invoicedShare !== null
        ? { value: invoicedShare, note: null, source: "invoiced" }
        : hasNoProfitShare(c.billingType)
          ? { value: 0, note: null, source: "none_by_terms" }
          : {
              value: null,
              note:
                invoiceNote ??
                `No profit share for ${name}: no statement in ops.profit_share_statements and no ${period} invoice in the Invoice Tracker.`,
              source: null,
            };

  const fees =
    retainer.value !== null && profitShare.value !== null
      ? fig(retainer.value + profitShare.value, null)
      : fig(null, retainer.note ?? profitShare.note);
  const afterRetainer =
    cm3Czk.value !== null && retainer.value !== null
      ? fig(cm3Czk.value - retainer.value, null)
      : fig(null, cm3Czk.note ?? retainer.note);
  const keeps =
    cm3Czk.value !== null && fees.value !== null ? fig(cm3Czk.value - fees.value, null) : fig(null, cm3Czk.note ?? fees.note);
  const perKoruna =
    keeps.value !== null && fees.value !== null && fees.value > 0
      ? fig(keeps.value / fees.value, null)
      : fig(null, keeps.note ?? (fees.value === 0 ? `No fees for ${name}.` : null));

  const perKorunaCeiling =
    perKoruna.value === null && profitShare.value === null && afterRetainer.value !== null && retainer.value !== null && retainer.value > 0
      ? afterRetainer.value / retainer.value
      : null;

  return { month, label: name, cm3Czk, retainer, profitShare, fees, afterRetainer, keeps, perKoruna, perKorunaCeiling };
}

function trendOf(c: ClientHealth, months: string[], rows: MonthRow[], invoices: Invoice[]): TrendMonth[] {
  return months.map((month) => {
    const cm3 = cm3InCzk(rows.find((r) => r.month === month), month);
    const inv = invoices.filter((i) => i.month === month);
    const amount = sumOrNull(inv.map((i) => i.amountCzk));
    const share = sumOrNull(inv.map((i) => i.profitShareCzk));
    return {
      month,
      label: monthLabel(month, "short"),
      cm3Czk: cm3.value,
      note: cm3.note,
      invoicedCzk: amount === null && share === null ? null : (amount ?? 0) + (share ?? 0),
      invoicePeriod: inv[0]?.period ?? null,
    };
  });
}

function partnership(c: ClientHealth, months: string[], input: LedgerInputs): Partnership {
  const monthsNote = unreadable("mart.plan_actuals_daily", input.months.state);
  const invoiceNote = unreadable("the ClickUp Invoice Tracker", input.invoices.state);
  const rows = c.clientId ? input.months.rows.filter((r) => r.clientId === c.clientId) : [];
  const invoices = invoicesOf(c, input.invoices.invoices);
  const settled = settle(c, months[months.length - 1] ?? null, rows, invoices, monthsNote, invoiceNote);

  const outside = "Not in the warehouse registry (ref.clients).";
  const revenue = c.clientId
    ? fig(c.revenue.actual, "No daily actuals in mart.plan_actuals_daily this month.")
    : fig(null, outside);
  const cm3 = c.clientId ? fig(c.cm3.actual, "CM3 needs cost data on every day this month.") : fig(null, outside);

  return {
    key: c.key,
    clientId: c.clientId,
    name: c.name,
    currency: c.currency,
    billingType: c.billingType,
    crmStatus: c.crmStatus,
    crmUrl: c.crmUrl,
    thisMonth: { label: c.monthLabel, asOf: c.asOf, revenue, cm3, focus: c.focus },
    agreedRetainer: agreedRetainer(c),
    settled,
    trend: c.clientId && !monthsNote ? trendOf(c, months, rows, invoices) : [],
    trendNote: !c.clientId ? outside : monthsNote,
    generated: c.generated,
  };
}

/* ------------------------------------------------------------------------ */
/* Setup                                                                    */
/* ------------------------------------------------------------------------ */

function item(
  base: Omit<SetupItem, "done" | "progress"> & { total: number | null; state?: SourceState; source?: string }
): SetupItem {
  const { total, state, source, ...rest } = base;
  const blocked = state && source ? unreadable(source, state) : null;
  const missing = rest.clients.length;
  return {
    ...rest,
    tip: blocked ? `${blocked} ${rest.tip}` : rest.tip,
    done: !blocked && total !== null && missing === 0,
    progress: total === null ? null : `${total - missing} of ${total}`,
  };
}

function buildSetup(input: LedgerInputs, partnerships: Partnership[], settledMonth: string | null): SetupItem[] {
  const inRegistry = input.home.clients.filter((c) => c.clientId);
  const names = (ids: (c: ClientHealth) => boolean) => inRegistry.filter(ids).map((c) => c.name);
  const platform = new Map(input.registry.map((r) => [r.clientId, r.shopPlatform]));
  const name = settledMonth ? monthLabel(settledMonth, "long") : "the last complete month";
  const period = settledMonth ? trackerPeriod(settledMonth) : null;

  const contracts = new Set(input.contracts.rows);
  const baseline = new Set(input.baseline.rows);
  const costs = new Set(input.monthlyCosts.rows.filter((r) => r.month === settledMonth).map((r) => r.clientId));
  const statements = new Set(input.statements.rows.filter((r) => r.month === settledMonth).map((r) => r.clientId));

  const settledRows = input.months.rows.filter((r) => r.month === settledMonth);
  const noCost = settledRows.filter((r) => r.cm3Gaps > 0).map((r) => r.clientId);
  const noRate = new Set(
    input.months.rows.filter((r) => r.currency !== "CZK" && r.rate === null).map((r) => r.clientId)
  );
  const lastTracked = input.invoices.invoices
    .map((i) => i.month)
    .filter((m): m is string => !!m)
    .sort()
    .pop();

  const billed = partnerships.filter((p) => p.agreedRetainer.value !== null);
  const invoiced = new Set(
    partnerships.filter((p) => p.settled.retainer.source === "invoiced").map((p) => p.key)
  );

  const items: SetupItem[] = [
    item({
      id: "contracts",
      title: "Contract terms",
      where: "BigQuery · ref.contracts",
      href: bqTable("ref", "contracts"),
      unlocks: "Profit share, value generated",
      tip: "One row per client: retainer, profit share %, contract start, baseline months. A new row per renegotiation, never an update.",
      clients: names((c) => !contracts.has(c.clientId as string)),
      total: inRegistry.length,
      state: input.contracts.state,
      source: "ref.contracts",
    }),
    item({
      id: "baseline",
      title: "Frozen CM3 baseline",
      where: "BigQuery · ref.cm3_baseline",
      href: bqTable("ref", "cm3_baseline"),
      unlocks: "Value generated, profit share",
      tip: "The agreed baseline CM3 per month, frozen once from mart_cm3_monthly and approved.",
      clients: names((c) => !baseline.has(c.clientId as string)),
      total: inRegistry.length,
      state: input.baseline.state,
      source: "ref.cm3_baseline",
    }),
    item({
      id: "monthly-costs",
      title: `Monthly fulfilment costs for ${name}`,
      where: "BigQuery · ref.client_monthly_costs",
      href: bqTable("ref", "client_monthly_costs"),
      unlocks: "Complete months for the profit share",
      tip: "Monthly fulfilment costs no shop API exposes, storage above all, CZK ex VAT. A month without a row is incomplete.",
      clients: names((c) => !costs.has(c.clientId as string)),
      total: inRegistry.length,
      state: input.monthlyCosts.state,
      source: "ref.client_monthly_costs",
    }),
    item({
      id: "product-costs",
      title: "Product costs",
      where: "BigQuery · ref.product_costs",
      href: bqTable("ref", "product_costs"),
      unlocks: "CM3, client keeps",
      tip: `Clients with days in ${name} that have revenue but no cost of goods, so CM3 is n/a.`,
      clients: names((c) => noCost.includes(c.clientId as string)),
      total: inRegistry.length,
      state: input.months.state,
      source: "mart.plan_actuals_daily",
    }),
    item({
      id: "cm3-platforms",
      title: "Contract CM3 outside WooCommerce",
      where: "mart.mart_cm3_monthly",
      href: bqTable("mart", "mart_cm3_monthly"),
      unlocks: "Profit share for Shopify and Shoptet clients",
      tip: "The contract CM3 mart reads WooCommerce orders only. Decide how contract CM3 is built for the other platforms.",
      clients: names((c) => (platform.get(c.clientId as string) ?? null) !== "woocommerce"),
      total: inRegistry.length,
    }),
    item({
      id: "statements",
      title: `Profit share statements for ${name}`,
      where: "ops.profit_share_statements",
      href: bqTable("ops", "profit_share_statements"),
      unlocks: "Profit share, client keeps",
      tip: "Generated monthly from mart_profit_share_monthly once contract, baseline and costs are in.",
      clients: names((c) => !statements.has(c.clientId as string)),
      total: inRegistry.length,
      state: input.statements.state,
      source: "ops.profit_share_statements",
    }),
    item({
      id: "retainers",
      title: "Agreed retainer",
      where: "ClickUp · Client Success › Clients · Retainer CZK",
      href: CLICKUP_CLIENTS,
      unlocks: "Agreed retainers, client keeps",
      tip: "The monthly retainer on each client task.",
      clients: partnerships.filter((p) => p.agreedRetainer.value === null).map((p) => p.name),
      total: partnerships.length,
    }),
    item({
      id: "invoices",
      title: period ? `Invoices for ${period}` : "Monthly invoices",
      where: "ClickUp · Billing & Finance › Invoice Tracker",
      href: CLICKUP_INVOICES,
      unlocks: "Invoiced fees, profit share invoiced",
      tip: `One task per client and month with Invoice Amount and Profit share. Latest period in the tracker: ${
        lastTracked ? trackerPeriod(lastTracked) : "none"
      }.`,
      clients: billed.filter((p) => !invoiced.has(p.key)).map((p) => p.name),
      total: billed.length,
      state: input.invoices.state === "empty" ? "ok" : input.invoices.state,
      source: "the ClickUp Invoice Tracker",
    }),
    item({
      id: "payments",
      title: "Payments received",
      where: "Pohoda, or a paid date on each Invoice Tracker task",
      href: CLICKUP_INVOICES,
      unlocks: "Money received",
      tip: "No source records money received. Payments are booked in Pohoda, which is not connected.",
      clients: [],
      total: null,
    }),
    item({
      id: "fx",
      title: "Exchange rates",
      where: "BigQuery · ref.fx_rates",
      href: bqTable("ref", "fx_rates"),
      unlocks: "CM3 in CZK for EUR and USD clients",
      tip: "Monthly CNB averages, currency to CZK, for every month on this page.",
      clients: names((c) => noRate.has(c.clientId as string)),
      total: inRegistry.filter((c) => c.currency && c.currency !== "CZK").length,
      state: input.months.state,
      source: "mart.plan_actuals_daily",
    }),
  ];

  // Open first, in the order above; done after.
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
}

/* ------------------------------------------------------------------------ */
/* The page                                                                 */
/* ------------------------------------------------------------------------ */

export function buildLedger(input: LedgerInputs): LedgerData {
  const months = trendMonths(input.months.rows, input.now);
  const settledMonth = months[months.length - 1] ?? null;

  const partnerships = input.home.clients
    .map((c) => partnership(c, months, input))
    .sort(
      (a, b) =>
        Number(!a.clientId) - Number(!b.clientId) ||
        (b.agreedRetainer.value ?? -1) - (a.agreedRetainer.value ?? -1) ||
        a.name.localeCompare(b.name)
    );

  const setup = buildSetup(input, partnerships, settledMonth);

  // Hero: agreed retainers.
  const retainers = partnerships.flatMap((p) => (p.agreedRetainer.value === null ? [] : [p.agreedRetainer.value]));

  // Hero: profit share on the latest invoice period in the tracker.
  const invoiceNote = unreadable("the ClickUp Invoice Tracker", input.invoices.state);
  const latest = input.invoices.invoices
    .map((i) => i.month)
    .filter((m): m is string => !!m)
    .sort()
    .pop();
  const lastBatch = latest ? input.invoices.invoices.filter((i) => i.month === latest) : [];
  const shared = lastBatch.filter((i) => i.profitShareCzk !== null);
  const shareValue = sumOrNull(shared.map((i) => i.profitShareCzk));

  // Hero: value generated (CM3 over the frozen baseline).
  const generated = input.home.clients.filter((c) => c.generated.value !== null);

  return {
    hero: {
      monthLabel: monthLabel(input.now.toISOString().slice(0, 10), "long", true),
      retainers: {
        ...fig(retainers.length ? retainers.reduce((a, b) => a + b, 0) : null, input.home.summary.retainersNote),
        clients: retainers.length,
      },
      profitShareLast: {
        ...fig(
          shareValue,
          invoiceNote ??
            (latest
              ? `The ${trackerPeriod(latest)} invoices in the Invoice Tracker carry no profit share.`
              : "No invoice in the ClickUp Invoice Tracker.")
        ),
        period: latest ? trackerPeriod(latest) : null,
        clients: shared.length,
      },
      generated: {
        ...fig(
          sumOrNull(generated.map((c) => c.generated.value)),
          "Needs contract terms, a frozen baseline and complete months."
        ),
        clients: generated.length,
      },
      generatedSetup: setup.filter((s) => ["contracts", "baseline", "monthly-costs"].includes(s.id)),
    },
    settledLabel: settledMonth ? monthLabel(settledMonth, "long", true) : null,
    partnerships,
    setup,
  };
}
