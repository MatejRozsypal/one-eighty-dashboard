import "server-only";

/**
 * The shared server-side preamble for the Velocity area.
 *
 * Lighter than `loadCreative`: Velocity needs no ads, assets or thresholds
 * beyond the hit rate's, only the trailing summary (281), the ClickUp queue,
 * the launch table, the saved inputs and the plan's ad budget. Overview runs
 * the same assembly for every client, so a client's row there and its Plan
 * page start from the same measured and saved numbers.
 */

import { getClients, resolveClient, type Client } from "@/lib/clients";
import { missingSource, pageAvailability } from "@/lib/capabilities";
import { isDemo } from "@/lib/demo/client";
import { parseViewParams } from "@/lib/params";
import {
  getCreativeSettings,
  getVelocityInputs,
  listVelocityInputs,
  toHitRateThresholds,
  type StoredCreativeSettings,
  type StoredVelocityInputs,
} from "@/lib/creative/store";
import { getLaunches, type LaunchData } from "@/lib/queries/creativeLaunch";
import {
  getPlanBudget,
  getPlanBudgets,
  getUsdRates,
  getVelocityQueue,
  getVelocityQueues,
  getVelocitySummaries,
  getVelocitySummary,
  type PlanBudget,
  type VelocityQueue,
  type VelocitySummary,
} from "@/lib/queries/velocity";
import { eligible, referenceRate, type LaunchRow } from "@/lib/creative/hitRate";
import {
  DEFAULT_ADS_PER_PACK,
  briefQuota,
  capacity,
  productionRatio,
  resolveInputs,
  tierOf,
  toCapacityInputs,
  type Capacity,
  type Tier,
  type VelocityInputs,
} from "@/lib/creative/capacity";
import type { CreativeThresholds } from "@/lib/creative/stats";

export interface VelocityClient {
  client: Client;
  /** The Meta ad account's currency: every amount on the Velocity pages is in it. */
  currency: string;
  settings: StoredCreativeSettings;
  hitThresholds: CreativeThresholds | null;
  summary: VelocitySummary | null;
  queue: VelocityQueue | null;
  launches: LaunchData;
  /** This month's Goals plan ad budget, only when it is in the Meta currency. */
  plan: PlanBudget | null;
  /** USD per one unit of `currency`, for the tier. Null when `ref.fx_rates` cannot reach it. */
  usdRate: number | null;
  saved: StoredVelocityInputs | null;
  measured: VelocityInputs;
  /** Saved where present, measured otherwise. */
  resolved: VelocityInputs;
}

/** `YYYY-MM-DD` minus `days`, in UTC. */
export function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Launches that count (no relaunch, not pre-existing), first delivered between the two days. */
export function launchedBetween(launches: LaunchData, from: string, to: string): LaunchRow[] | null {
  if (launches.state !== "ready") return null;
  return eligible(launches.rows).filter((r) => r.firstDate >= from && r.firstDate <= to);
}

function assemble(
  client: Client,
  settings: StoredCreativeSettings,
  summary: VelocitySummary | null,
  queue: VelocityQueue | null,
  launches: LaunchData,
  planBudget: PlanBudget | null,
  usdRates: Map<string, number>,
  saved: StoredVelocityInputs | null
): VelocityClient {
  const currency = summary?.currency ?? client.metaCurrency ?? client.currency;
  // The plan's ad budget is in the trading currency. Where that is not the
  // Meta currency it would be compared with the wrong unit, so it is not used.
  const plan = planBudget && client.currency === currency ? planBudget : null;
  const hitThresholds = toHitRateThresholds(settings);
  const measured: VelocityInputs = {
    monthlySpend: plan?.amount ?? summary?.spend30d ?? null,
    newShare: summary?.share30d ?? null,
    cpa: summary?.cpa90d ?? null,
    verdictN: settings.readPurchases,
    adsPerPack: DEFAULT_ADS_PER_PACK,
    hitRate:
      launches.state === "ready" ? referenceRate(launches.rows, hitThresholds, launches.through) : null,
    targetNewAds: null,
  };
  return {
    client,
    currency,
    settings,
    hitThresholds,
    summary,
    queue,
    launches,
    plan,
    usdRate: usdRates.get(currency) ?? null,
    saved,
    measured,
    resolved: resolveInputs(saved, measured),
  };
}

/** The trailing 30 days the launch read must cover, ending today. */
function launchRange() {
  const to = today();
  return { from: minusDays(to, 45), to };
}

export type VelocityLoad =
  | { status: "not-connected"; client: Client; source: string }
  | { status: "ready"; data: VelocityClient };

/** One client, from `?client=`, for This month, Plan and Track record. */
export async function loadVelocity(
  searchParams: { [k: string]: string | string[] | undefined }
): Promise<VelocityLoad> {
  const params = parseViewParams(searchParams, "all");
  const client = await resolveClient(params.clientId, await getClients());
  if (pageAvailability(client, "/creative") !== "available") {
    return { status: "not-connected", client, source: missingSource(client, "/creative") ?? "Meta" };
  }
  const id = client.clientId;
  const [settings, summary, queue, launches, plan, usdRates, saved] = await Promise.all([
    getCreativeSettings(id),
    getVelocitySummary(id),
    getVelocityQueue(id),
    getLaunches(id, launchRange()),
    getPlanBudget(id),
    getUsdRates(),
    isDemo(id) ? Promise.resolve(null) : getVelocityInputs(id),
  ]);
  return {
    status: "ready",
    data: assemble(client, settings, summary, queue, launches, plan, usdRates, saved),
  };
}

/** Every active client with Meta, for Overview. The demo client is left out. */
export async function loadVelocityOverview(): Promise<VelocityClient[]> {
  const clients = (await getClients()).filter(
    (c) => !isDemo(c.clientId) && pageAvailability(c, "/creative") === "available"
  );
  const [summaries, queues, plans, usdRates, saved] = await Promise.all([
    getVelocitySummaries(),
    getVelocityQueues(),
    getPlanBudgets(),
    getUsdRates(),
    listVelocityInputs(),
  ]);
  return Promise.all(
    clients.map(async (c) => {
      const [settings, launches] = await Promise.all([
        getCreativeSettings(c.clientId),
        getLaunches(c.clientId, launchRange()),
      ]);
      return assemble(
        c,
        settings,
        summaries.get(c.clientId) ?? null,
        queues.get(c.clientId) ?? null,
        launches,
        plans.get(c.clientId) ?? null,
        usdRates,
        saved.get(c.clientId) ?? null
      );
    })
  );
}

// ---------------------------------------------------------------------------
// The figures every Velocity screen shows about one client
// ---------------------------------------------------------------------------

export interface VelocityFacts {
  /** Latest loaded day, from the summary or else the launch table. */
  through: string | null;
  /** `YYYY-MM` of `through`. */
  month: string | null;
  /** New ads first delivered in the 30 days to `through`, relaunches excluded. */
  newAds30d: number | null;
  /** The same, in the calendar month of `through`. */
  newAdsMonth: number | null;
  /** Capacity at the resolved inputs (saved where present, measured otherwise). */
  plan: Capacity;
  /** Capacity at the actual 30-day spend, other inputs as resolved. */
  actual: Capacity;
  /** New ads in 30 days over capacity at that spend. */
  production: number | null;
  /** Ready plus in works. Null without a ClickUp board. */
  queued: number | null;
  /** Briefs for next month: capacity at the resolved inputs minus the queue. */
  brief: number | null;
  tier: Tier | null;
}

export function velocityFacts(d: VelocityClient): VelocityFacts {
  const through = d.summary?.through ?? (d.launches.state === "ready" ? d.launches.through : null);
  const month = through?.slice(0, 7) ?? null;
  const last30 = through ? launchedBetween(d.launches, minusDays(through, 29), through) : null;
  const inMonth = through && month ? launchedBetween(d.launches, `${month}-01`, through) : null;
  const inputs = toCapacityInputs(d.resolved);
  const plan = capacity(inputs);
  const actual = capacity({ ...inputs, spend: d.summary?.spend30d ?? null });
  const newAds30d = last30?.length ?? null;
  const queued = d.queue ? d.queue.ready + d.queue.inWorks : null;
  const spend = d.resolved.monthlySpend;
  return {
    through,
    month,
    newAds30d,
    newAdsMonth: inMonth?.length ?? null,
    plan,
    actual,
    production: productionRatio(newAds30d, actual.capacity),
    queued,
    brief: briefQuota(plan.capacity, queued),
    tier: tierOf(spend !== null && d.usdRate !== null ? spend * d.usdRate : null),
  };
}
