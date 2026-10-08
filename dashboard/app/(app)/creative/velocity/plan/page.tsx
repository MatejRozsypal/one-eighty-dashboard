/**
 * Velocity, Plan: the calculator (monthly creative planning, budget talks).
 *
 * The server measures the defaults and reads what the team saved; the
 * calculator recomputes live in the browser and saves through the action
 * below. Spend defaults to this month's Goals plan ad budget when one exists
 * in the Meta currency, otherwise to the last 30 days of actual spend.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeNotConnected } from "@/components/creative/primitives";
import { PlanCalculator } from "@/components/creative/velocity/PlanCalculator";
import { loadVelocity } from "@/lib/creative/velocityData";
import { formatMoney } from "@/lib/format";
import { saveVelocityInputsAction } from "../actions";

export const metadata: Metadata = { title: "Velocity plan" };
export const dynamic = "force-dynamic";

export default async function VelocityPlanPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const loaded = await loadVelocity(searchParams);
  if (loaded.status === "not-connected") {
    return <CreativeNotConnected title="Velocity plan" source={loaded.source} />;
  }
  const d = loaded.data;
  const actual = formatMoney(d.summary?.spend30d ?? null, d.currency);
  const spendSource = d.plan
    ? `From the Goals plan, ${d.plan.label}. Last 30 days: ${actual}.`
    : "Last 30 days actual.";
  const { saved } = d;

  return (
    <>
      <Header title="Velocity plan" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        <PlanCalculator
          // A new client or a fresh save remounts it on the saved values.
          key={`${d.client.clientId}:${saved?.updatedAt ?? ""}`}
          clientId={d.client.clientId}
          currency={d.currency}
          measured={d.measured}
          saved={saved}
          savedBy={saved?.updatedBy ?? null}
          savedAt={saved?.updatedAt ?? null}
          spendSource={spendSource}
          usdRate={d.usdRate}
          queued={d.queue ? d.queue.ready + d.queue.inWorks : null}
          action={saveVelocityInputsAction}
        />
      </main>
    </>
  );
}
