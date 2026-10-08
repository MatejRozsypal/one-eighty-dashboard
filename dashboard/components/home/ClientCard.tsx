/**
 * One client on Home, as an Apple Health summary card.
 *
 * The coloured name and the ring are the month's pacing on the plan, exactly
 * as Goals draws it: CM3 when the plan targets it, revenue otherwise. One full
 * rotation is the month's goal and the dot is where the plan says today should
 * be. No plan, no ring arc and no colour: there is nothing to pace against.
 *
 * Below it, two groups. Results: the month to date against the plan and
 * against the same days last year. Money: what the client keeps after our
 * fees, what we generated over the contract baseline, and what we charge and
 * were paid. Every n/a carries an (i) that names the missing source.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { GoalRing } from "@/components/plan/GoalRing";
import { MINUS, NO_VALUE, formatMoney, formatPercent } from "@/lib/format";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { METRIC_LABEL, fmtGap, fmtPace, fmtValue } from "@/lib/plan/format";
import type { PacingRow, RowMetric } from "@/lib/plan/types";
import type { ClientHealth, Figure, MonthMetric } from "@/lib/home/types";

const CARD =
  "flex min-w-0 flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm sm:p-[22px]";
const FIGURE = "text-[30px] font-bold leading-[1.05] tracking-heading tabular text-content-strong";
const CAPTION = "text-[13px] leading-[1.35] text-content-muted";
const GROUP = "flex flex-col gap-2 border-t border-hairline pt-3.5";
const GROUP_TITLE = "text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted";
const LIST = "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]";

function capitalise(s: string | null): string | null {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

/** "2026-10-07" -> "7 Oct". */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function signedPercent(v: number): string {
  const text = formatPercent(Math.abs(v));
  if (text === formatPercent(0)) return text;
  return v < 0 ? `${MINUS}${text}` : `+${text}`;
}

function Row({
  label,
  tip,
  note,
  children,
}: {
  label: string;
  /** What the figure is. */
  tip?: string;
  /** Why the figure is n/a. When set, the value renders n/a with this beside it. */
  note?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <>
      <dt className="inline-flex items-center gap-1 text-content-muted">
        {label}
        {tip && <InfoTip text={tip} label={`About ${label}`} />}
      </dt>
      <dd className="m-0 inline-flex items-center justify-end gap-1 text-right tabular text-content-strong">
        {note ? (
          <>
            <span className="text-content-muted">{NO_VALUE}</span>
            <InfoTip text={note} label={`Why ${label} is n/a`} />
          </>
        ) : (
          children
        )}
      </dd>
    </>
  );
}

/** A coloured status word after a figure, the same word and colour Goals uses. */
function Status({ row }: { row: PacingRow }) {
  return (
    <span style={{ color: toneVars(toneOfRow(row)).text }} className="font-semibold">
      {planStatusLabel(row)}
    </span>
  );
}

function MetricRow({
  label,
  metric,
  value,
  currency,
  missing,
}: {
  label: string;
  metric: RowMetric;
  value: MonthMetric;
  currency: string;
  missing: string;
}) {
  return (
    <Row label={label} note={value.actual === null ? missing : null}>
      {fmtValue(value.actual, metric, currency)}
      {value.row && (
        <>
          <span className="text-content-muted">·</span>
          <Status row={value.row} />
        </>
      )}
    </Row>
  );
}

function czk(f: Figure): string {
  return formatMoney(f.value, "CZK");
}

function Headline({ client }: { client: ClientHealth }) {
  const { focus, currency } = client;
  if (!client.clientId || !currency) {
    return <span className={CAPTION}>No shop data</span>;
  }
  if (!focus) {
    return (
      <div className="flex flex-col">
        <span className="text-[13px] font-semibold text-content-muted">Revenue</span>
        <span className={`mt-[6px] ${FIGURE}`}>
          {client.revenue.actual === null ? (
            <span className="text-content-muted">{NO_VALUE}</span>
          ) : (
            fmtValue(client.revenue.actual, "revenue", currency)
          )}
        </span>
        <span className={`mt-[3px] ${CAPTION}`}>Month to date · No plan</span>
      </div>
    );
  }
  const metric = focus.metric;
  return (
    <div className="flex flex-col">
      <span className="text-[13px] font-semibold text-content-muted">{METRIC_LABEL[metric]}</span>
      <span className={`mt-[6px] ${FIGURE}`}>
        {focus.actual === null ? (
          <span className="text-content-muted">{NO_VALUE}</span>
        ) : (
          fmtValue(focus.actual, metric, currency)
        )}
      </span>
      <span className={`mt-[3px] ${CAPTION}`}>
        of {fmtValue(focus.targetToDate, metric, currency)} to date · {fmtValue(focus.target, metric, currency)} month
      </span>
      <span className="mt-[6px] text-[12.5px] leading-[1.35]">
        <Status row={focus} />
        <span className="text-content-muted"> · {fmtPace(focus.pacePct)} of plan</span>
      </span>
    </div>
  );
}

export function ClientCard({ client }: { client: ClientHealth }) {
  const tone = client.focus ? toneOfRow(client.focus) : "neutral";
  const colour = toneVars(tone);
  const currency = client.currency;
  const href = client.clientId
    ? `${client.focus ? "/goals" : "/snapshot"}?client=${encodeURIComponent(client.clientId)}`
    : null;

  const status = [capitalise(client.registryStatus), capitalise(client.crmStatus), client.billingType].filter(Boolean);
  const invoice = client.lastInvoice;

  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {href ? (
            <AppLink
              href={href}
              style={{ color: client.focus ? colour.text : undefined }}
              className="inline-flex min-w-0 items-center gap-1 text-[15px] font-semibold leading-[1.3] text-content-strong hover:underline"
            >
              <span className="truncate">{client.name}</span>
              <Chevron />
            </AppLink>
          ) : (
            <span className="truncate text-[15px] font-semibold leading-[1.3] text-content-strong">{client.name}</span>
          )}
          <span className="text-[12.5px] leading-[1.35] text-content-muted">
            {status.length ? status.join(" · ") : NO_VALUE}
            {client.crmUrl && (
              <>
                {" · "}
                <a href={client.crmUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                  ClickUp
                </a>
              </>
            )}
          </span>
        </div>
        {client.clientId && (
          <GoalRing
            row={client.focus ?? { actual: null, targetToDate: null, target: null }}
            periodType="month"
            tone={tone}
            size={58}
          />
        )}
      </div>

      <Headline client={client} />

      {client.clientId && currency && (
        <section className={GROUP} aria-label="Results">
          <span className={GROUP_TITLE}>{client.monthLabel ?? "This month"}</span>
          <dl className={LIST}>
            <MetricRow label="Revenue" metric="revenue" value={client.revenue} currency={currency} missing="No daily actuals in mart.plan_actuals_daily." />
            <MetricRow label="CM3" metric="cm3" value={client.cm3} currency={currency} missing="No cost data on every day this month." />
            <MetricRow label="aMER" metric="amer" value={client.amer} currency={currency} missing="Paid spend missing on a day this month." />
            <Row label="Revenue vs last year" tip="Month to date against the same days a year earlier." note={client.revenueVsLastYear.note}>
              {client.revenueVsLastYear.value !== null && signedPercent(client.revenueVsLastYear.value)}
            </Row>
            <Row label="CM3 vs last year" tip="Month to date against the same days a year earlier. Live data, not the contract baseline." note={client.cm3VsLastYear.note}>
              {fmtGap(client.cm3VsLastYear.value, "cm3", currency)}
            </Row>
          </dl>
        </section>
      )}

      <section className={GROUP} aria-label="Money">
        <span className={GROUP_TITLE}>Money</span>
        <dl className={LIST}>
          {client.clientId && (
            <>
              <Row
                label="Kept after our fees"
                tip="Last complete month: contract CM3 minus our retainer and profit share."
                note={client.keptAfterFees.note}
              >
                {czk(client.keptAfterFees)}
                {client.keptAfterFees.month && <span className="text-content-muted">· {client.keptAfterFees.month}</span>}
              </Row>
              <Row
                label="Generated over baseline"
                tip="CM3 above the frozen contract baseline, summed over complete months since the contract began."
                note={client.generated.note}
              >
                {czk(client.generated)}
                <span className="text-content-muted">
                  · {client.generated.months} {client.generated.months === 1 ? "month" : "months"}
                </span>
              </Row>
            </>
          )}
          <Row
            label="Retainer"
            tip={
              client.retainer.source === "contract"
                ? "Monthly retainer in ref.contracts. Agreed, not received."
                : "Retainer CZK on the ClickUp client task. Agreed, not received."
            }
            note={client.retainer.note}
          >
            {czk(client.retainer)}
            <span className="text-content-muted">/ mo</span>
          </Row>
          {client.clientId && (
            <Row
              label="Profit share"
              tip="Latest profit share statement, else the latest complete month of the profit share mart."
              note={client.profitShare.note}
            >
              {czk(client.profitShare)}
              {client.profitShare.month && <span className="text-content-muted">· {client.profitShare.month}</span>}
            </Row>
          )}
          <Row
            label="Last invoice"
            tip={`ClickUp Invoice Tracker${invoice?.status ? `, ${invoice.status}` : ""}.`}
            note={invoice ? (invoice.amountCzk === null ? "No Invoice Amount on the tracker task." : null) : client.lastInvoiceNote}
          >
            {invoice && formatMoney(invoice.amountCzk, "CZK")}
            {invoice && <span className="text-content-muted">· {invoice.period}</span>}
          </Row>
          <Row
            label="Profit share invoiced"
            tip="Profit share on the last invoice in the ClickUp Invoice Tracker."
            note={invoice ? (invoice.profitShareCzk === null ? "No profit share on the last invoice." : null) : client.lastInvoiceNote}
          >
            {invoice && formatMoney(invoice.profitShareCzk, "CZK")}
            {invoice && <span className="text-content-muted">· {invoice.period}</span>}
          </Row>
          <Row label="Received" note={client.received.note} />
        </dl>
      </section>

      {client.asOf && (
        <span className="mt-auto text-[12px] text-content-muted">Data through {shortDate(client.asOf)}</span>
      )}
    </article>
  );
}

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
