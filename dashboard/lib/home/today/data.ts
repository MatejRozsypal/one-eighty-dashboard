import "server-only";

/**
 * Home, Today variant: one read for the whole page.
 *
 * Reuses what exists: the Home client health read (`getHomeData`, Goals
 * pacing and month-to-date actuals), the Velocity overview (capacity, queue,
 * read threshold, CPA per client) and the FX rates Velocity already reads. The
 * four reads only this page needs live in `./sources`. Every one of them is
 * fail soft, so one unreadable source turns its own check n/a and leaves the
 * rest of the list standing.
 */

import { getClientsIncludingInactive } from "@/lib/clients";
import { listConfirmedMappings } from "@/lib/creative/store";
import { loadVelocityOverview, velocityFacts, type VelocityClient } from "@/lib/creative/velocityData";
import { getHomeData } from "@/lib/home/queries";
import { getUsdRates } from "@/lib/queries/velocity";
import { buildToday, clientLines, pragueDay, type RuleInputs, type VelocityLite } from "./rules";
import { readAlerts, readFounderTasks, readPacks, readSyncIssues, readUnmapped } from "./sources";
import type { TodayData } from "./types";

function failed(source: string, error: unknown): string {
  const message = String((error as { message?: string } | null)?.message ?? error);
  console.error(`[home/today] ${source}: ${message}`);
  return /permission|access denied/i.test(message) ? `No read access to ${source}.` : `${source} could not be read.`;
}

function lite(d: VelocityClient): VelocityLite {
  const f = velocityFacts(d);
  let adsByAdset: Record<string, number> | null = null;
  if (d.launches.state === "ready" && d.launches.rows.every((r) => r.adsetId !== undefined)) {
    adsByAdset = {};
    for (const r of d.launches.rows) {
      if (r.adsetId) adsByAdset[r.adsetId] = (adsByAdset[r.adsetId] ?? 0) + 1;
    }
  }
  return {
    clientId: d.client.clientId,
    name: d.client.name,
    currency: d.currency,
    verdictN: d.settings.readPurchases > 0 ? d.settings.readPurchases : null,
    cpa: d.resolved.cpa,
    windowDays: f.plan.windowDays,
    capacity: f.plan.capacity,
    actualCapacity: f.actual.capacity,
    newAds30d: f.newAds30d,
    production: f.production,
    queued: f.queued,
    brief: f.brief,
    adsByAdset,
  };
}

export async function getTodayData(): Promise<TodayData> {
  const now = new Date();
  const today = pragueDay(now);
  // ClickUp filters on an instant; two days ahead covers the end of the Prague
  // day in any season, and the rule then keeps only what is due by today.
  const dueBefore = now.getTime() + 2 * 86_400_000;

  const [home, velocity, packs, unmapped, sync, alerts, tasks, registry, usd] = await Promise.all([
    getHomeData().then(
      (d) => ({ status: "ok" as const, clients: d.clients }),
      (e) => ({ status: "na" as const, note: failed("mart.plan_pacing", e) })
    ),
    loadVelocityOverview().then(
      (list) => ({ status: "ok" as const, clients: list.map(lite) }),
      (e) => ({ status: "na" as const, note: failed("mart.mart_velocity_daily", e) })
    ),
    readPacks(),
    readUnmapped(),
    readSyncIssues(),
    readAlerts(),
    readFounderTasks(dueBefore),
    getClientsIncludingInactive().catch((e) => {
      failed("ref.clients", e);
      return [];
    }),
    getUsdRates().catch((e) => {
      failed("ref.fx_rates", e);
      return new Map<string, number>();
    }),
  ]);

  // Mappings a person confirmed and the warehouse has not picked up yet, the
  // same subtraction the Creative screen makes before it counts the queue.
  const withUnmapped = Array.from(new Set(unmapped.rows.map((r) => r.clientId)));
  const confirmedLists = await Promise.all(
    withUnmapped.map((id) =>
      listConfirmedMappings(id).then(
        (rows) => [id, rows.map((r) => r.adId)] as const,
        () => [id, [] as string[]] as const
      )
    )
  );

  const inputs: RuleInputs = {
    today,
    home,
    velocity,
    packs,
    unmapped,
    confirmed: Object.fromEntries(confirmedLists),
    sync,
    alerts,
    tasks,
    clients: Object.fromEntries(
      registry.map((c) => [c.clientId, { name: c.name, metaCurrency: c.metaCurrency, currency: c.currency }])
    ),
    usdRates: Object.fromEntries(usd),
  };

  const { items, sources } = buildToday(inputs);
  return {
    items,
    sources,
    clients: home.status === "ok" ? clientLines(home.clients) : [],
    clientsNote: home.status === "ok" ? null : home.note,
    day: today,
  };
}
