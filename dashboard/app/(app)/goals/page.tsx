/**
 * Goals: the plan's targets against what is happening, by month, quarter,
 * promo window or target state.
 *
 * Targets are set in ClickUp and expanded in the warehouse into a daily curve
 * (weekday, paydays, promo windows); pace, projection and status are computed
 * there too. This page reads those rows and never edits a plan: a page that
 * both sets and reports a target invites editing the plan to match the result.
 *
 * Every view has the same skeleton: tiles per metric, the cumulative burn-up,
 * daily bars, and the period one level down. Quarter adds the promo and
 * checkpoint timeline, Promo the attribution figures, Target the trajectory.
 *
 * ── The Health skin ────────────────────────────────────────────────────────
 * This page piloted the visual language the whole product now uses. The skin
 * itself lives on <html> (app/layout.tsx); what is left here is the `oe-goals`
 * wrapper below, which carries the four things that would cost something if
 * they left this page: the pill radius, the chart's single accent colour, the
 * translucent neutral steps the timeline bars need, and the sizing of the two
 * segmented controls. styles/skins/health.css says why for each.
 *
 * The pace ring and the card titles are also Goals-only, and are components
 * rather than tokens; their own headers carry the reasoning.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { getPlanData } from "@/lib/queries/plan";
import { asOfOf, periodOptions, selectPeriod } from "@/lib/plan/model";
import { PLAN_VIEWS, type PlanView } from "@/lib/plan/types";
import { Header } from "@/components/shell/Header";
import { NotConnected } from "@/components/ui/EmptyState";
import { PlanControls } from "@/components/plan/PlanControls";
import { PlanBody } from "@/components/plan/PlanBody";

export const metadata: Metadata = { title: "Goals" };
export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseView(v: string | undefined): PlanView {
  return PLAN_VIEWS.includes(v as PlanView) ? (v as PlanView) : "month";
}

export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/goals") !== "available") {
    return (
      <>
        <Header title="Goals" />
        <div className="oe-goals flex min-w-0 flex-1 flex-col">
          <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
            <NotConnected source={missingSource(client, "/goals") ?? "Shop"} />
          </main>
        </div>
      </>
    );
  }

  const view = parseView(first(searchParams.view));
  const data = await getPlanData(client.clientId, { withPromoPerf: view === "quarter" || view === "promo" });
  const asOf = asOfOf(data);
  const anchor = asOf ?? new Date().toISOString().slice(0, 10);
  const options = periodOptions(data, view);
  const period = selectPeriod(options, first(searchParams.period), anchor);

  return (
    <>
      <Header title="Goals" />
      <div className="oe-goals flex min-w-0 flex-1 flex-col">
        <PlanControls view={view} options={options} period={period?.id ?? null} />
        <main className="page-frame flex flex-col gap-[22px] px-5 pb-14 pt-6 lg:px-8">
          <PlanBody data={data} view={view} period={period} asOf={asOf} currency={client.currency} />
        </main>
      </div>
    </>
  );
}
