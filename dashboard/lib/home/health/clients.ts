/**
 * The Clients list at the bottom of Summary, Health's "Show All Health Data".
 * Pure, safe anywhere.
 *
 * Status chips: the ClickUp task status and billing type (Client Success >
 * Clients), a registry status other than active, and the Goals status of the
 * ring metric. Money: the retainer (ref.contracts, else ClickUp Retainer
 * CZK), the last invoice and its profit share (ClickUp Invoice Tracker), and
 * the profit share of the contract layer. All of it arrives finished in the
 * Home read (lib/home/queries.ts); this file only lays it out.
 */

import { formatMoney } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/plan/format";
import { planStatusLabel, toneOfRow } from "@/lib/plan/health";
import type { ClientHealth } from "@/lib/home/types";
import type { Chip, ChipTone, ClientRow, MoneyFact } from "./types";

const CRM_TIP = "Task status in ClickUp Client Success > Clients.";

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function crmTone(status: string): ChipTone {
  if (status === "steady") return "positive";
  if (status === "onboarding") return "info";
  return "neutral";
}

function chipsOf(c: ClientHealth): Chip[] {
  const chips: Chip[] = [];
  if (c.crmStatus) chips.push({ label: capitalise(c.crmStatus), tone: crmTone(c.crmStatus), tip: CRM_TIP });
  if (c.registryStatus && c.registryStatus !== "active") {
    chips.push({ label: capitalise(c.registryStatus), tone: "warning", tip: "Status in the warehouse registry (ref.clients)." });
  }
  if (c.focus) {
    chips.push({
      label: `${METRIC_LABEL[c.focus.metric]} ${planStatusLabel(c.focus).toLowerCase()}`,
      tone: toneOfRow(c.focus),
      tip: `Goals status of ${METRIC_LABEL[c.focus.metric]} for ${c.monthLabel ?? "this month"} (mart.plan_pacing).`,
    });
  }
  if (c.billingType) chips.push({ label: c.billingType, tone: "neutral", tip: "Billing Type on the ClickUp client task." });
  return chips;
}

function moneyOf(c: ClientHealth): MoneyFact[] {
  const inv = c.lastInvoice;
  return [
    {
      label: "Retainer",
      text: c.retainer.value === null ? null : formatMoney(c.retainer.value, "CZK"),
      suffix: c.retainer.value === null ? null : "/ mo",
      tip:
        c.retainer.note ??
        (c.retainer.source === "contract"
          ? "Monthly retainer in ref.contracts. Agreed, not received."
          : "Retainer CZK on the ClickUp client task. Agreed, not received."),
    },
    {
      label: "Last invoice",
      text: inv && inv.amountCzk !== null ? formatMoney(inv.amountCzk, "CZK") : null,
      suffix: inv ? inv.period : null,
      tip: inv
        ? inv.amountCzk === null
          ? "No Invoice Amount on the tracker task."
          : `ClickUp Invoice Tracker${inv.status ? `, ${inv.status}` : ""}.`
        : c.lastInvoiceNote ?? "No invoice in the ClickUp Invoice Tracker.",
    },
    {
      label: "Profit share",
      text: c.profitShare.value === null ? null : formatMoney(c.profitShare.value, "CZK"),
      suffix: c.profitShare.month,
      tip:
        c.profitShare.note ??
        "Latest profit share statement, else the latest complete month of the profit share mart.",
    },
    {
      label: "Share invoiced",
      text: inv && inv.profitShareCzk !== null ? formatMoney(inv.profitShareCzk, "CZK") : null,
      suffix: inv && inv.profitShareCzk !== null ? inv.period : null,
      tip: inv
        ? inv.profitShareCzk === null
          ? "No profit share on the last invoice in the ClickUp Invoice Tracker."
          : "Profit share on the last invoice in the ClickUp Invoice Tracker."
        : c.lastInvoiceNote ?? "No invoice in the ClickUp Invoice Tracker.",
    },
  ];
}

export function buildClientRows(clients: ClientHealth[]): ClientRow[] {
  return [...clients]
    .sort((a, b) => Number(!a.clientId) - Number(!b.clientId) || a.name.localeCompare(b.name))
    .map((c) => ({
      key: c.key,
      name: c.name,
      chips: chipsOf(c),
      money: moneyOf(c),
      href: c.clientId ? `/goals?client=${encodeURIComponent(c.clientId)}` : null,
      crmUrl: c.crmUrl,
    }));
}
