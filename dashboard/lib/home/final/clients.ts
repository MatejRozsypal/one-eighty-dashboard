/**
 * Home: the client cards. Pure, safe anywhere.
 *
 * Each client with shop data gets the Health variant's pinned card (three
 * rings against the Goals plan to date, or one grey ring against the same
 * days last year, `buildPinned`), plus the ClickUp status and the retainer
 * underneath. A client the owners track in ClickUp and the warehouse does
 * not hold gets a plain card with the same two facts.
 */

import { formatMoney } from "@/lib/format";
import { buildPinned } from "@/lib/home/health/pinned";
import type { ChipTone, ClientSeries, PinnedCard } from "@/lib/home/health/types";
import type { ClientHealth } from "@/lib/home/types";

export interface ClientTile {
  key: string;
  name: string;
  /** Null for a ClickUp-only client. */
  pinned: PinnedCard | null;
  status: { label: string; tone: ChipTone; tip: string } | null;
  /** Why the status is n/a. */
  statusNote: string;
  retainer: { text: string | null; tip: string };
  crmUrl: string | null;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function crmTone(status: string): ChipTone {
  if (status === "steady") return "positive";
  if (status === "onboarding") return "info";
  if (status === "churned") return "negative";
  return "neutral";
}

function statusOf(c: ClientHealth): ClientTile["status"] {
  if (c.crmStatus) {
    return { label: capitalise(c.crmStatus), tone: crmTone(c.crmStatus), tip: "Task status in ClickUp Client Success > Clients." };
  }
  if (c.registryStatus) {
    return {
      label: capitalise(c.registryStatus),
      tone: c.registryStatus === "active" ? "neutral" : "warning",
      tip: `Status in the warehouse registry (ref.clients).${c.crmNote ? ` ${c.crmNote}` : ""}`,
    };
  }
  return null;
}

function retainerOf(c: ClientHealth): ClientTile["retainer"] {
  if (c.retainer.value === null) return { text: null, tip: c.retainer.note ?? "No retainer found." };
  return {
    text: formatMoney(c.retainer.value, "CZK"),
    tip:
      c.retainer.source === "contract"
        ? "Monthly retainer in ref.contracts. Agreed, not received."
        : "Retainer CZK on the ClickUp client task. Agreed, not received.",
  };
}

export function buildClientTiles(clients: ClientHealth[], series: ClientSeries[]): ClientTile[] {
  const byId = new Map(clients.filter((c) => c.clientId).map((c) => [c.clientId!, c]));
  const tiles: ClientTile[] = [];
  for (const card of buildPinned(clients, series)) {
    const c = byId.get(card.clientId)!;
    tiles.push({
      key: c.key,
      name: c.name,
      pinned: card,
      status: statusOf(c),
      statusNote: c.crmNote ?? "No status in ClickUp or ref.clients.",
      retainer: retainerOf(c),
      crmUrl: c.crmUrl,
    });
  }
  for (const c of clients) {
    if (c.clientId && c.currency) continue;
    tiles.push({
      key: c.key,
      name: c.name,
      pinned: null,
      status: statusOf(c),
      statusNote: c.crmNote ?? "No status in ClickUp.",
      retainer: retainerOf(c),
      crmUrl: c.crmUrl,
    });
  }
  return tiles;
}
