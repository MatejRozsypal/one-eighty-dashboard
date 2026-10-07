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
 * This page is a pilot of a different visual language: white page, white
 * cards, a pace ring per metric, and a sans in place of the dashboard's
 * monospace. It is expected to look unlike the rest of the product.
 *
 * It is carried entirely by the `oe-health` class on the wrapper below, which
 * is where `styles/skins/health.css` scopes its token overrides. Taking the
 * decision either way is cheap: delete the wrapper and the file, or move the
 * scope up to `:root` and delete the wrapper. Nothing in `components/plan` or
 * `lib/plan` holds a colour, a radius or a font of its own.
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
        <div className="oe-health flex min-w-0 flex-1 flex-col">
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
      {/* The skin's one font, fetched as the page streams rather than after the
          stylesheet has been parsed. */}
      <link
        rel="preload"
        as="font"
        type="font/woff2"
        href="/fonts/InterVariable-subset.woff2"
        crossOrigin="anonymous"
      />
      <Header title="Goals" />
      <div className="oe-health flex min-w-0 flex-1 flex-col">
        <PlanControls view={view} options={options} period={period?.id ?? null} />
        <main className="page-frame flex flex-col gap-[22px] px-5 pb-14 pt-6 lg:px-8">
          <PlanBody data={data} view={view} period={period} asOf={asOf} currency={client.currency} />
        </main>
      </div>
    </>
  );
}
