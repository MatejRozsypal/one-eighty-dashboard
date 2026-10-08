/**
 * Velocity, Track record: did we produce to what the budget could read.
 *
 * By month, the trailing 12: spend, new ads launched, capacity at that month's
 * actual spend and CPA (share, N and ads per pack as on Plan), production
 * against capacity, packs launched, and winners and hit rate by launch month.
 * Each client's first month of history is left out: every ad running when the
 * history starts looks launched that month (281's first-day caveat).
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeNotConnected, SectionHead, money, unitMoney } from "@/components/creative/primitives";
import { NotConnected } from "@/components/ui/EmptyState";
import { CapacityBars, type CapacityMonth } from "@/components/creative/velocity/CapacityBars";
import { TableFrame, Td, Th } from "@/components/creative/velocity/Table";
import { loadVelocity, velocityFacts } from "@/lib/creative/velocityData";
import { getVelocityMonths } from "@/lib/queries/velocity";
import { capacity, productionRatio, toCapacityInputs, OVER_CAPACITY_X } from "@/lib/creative/capacity";
import { formatRate, launchMonths, trailingMonths } from "@/lib/creative/hitRate";
import { perMonth, times, whole } from "@/lib/creative/velocityFormat";
import { NO_VALUE } from "@/lib/format";

export const metadata: Metadata = { title: "Track record" };
export const dynamic = "force-dynamic";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function label(month: string, first: boolean): string {
  const mm = Number(month.slice(5, 7)) - 1;
  return mm === 0 || first ? `${MONTH_NAMES[mm]} ${month.slice(2, 4)}` : MONTH_NAMES[mm];
}

export default async function VelocityTrackPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const loaded = await loadVelocity(searchParams);
  if (loaded.status === "not-connected") {
    return <CreativeNotConnected title="Track record" source={loaded.source} />;
  }
  const d = loaded.data;
  const f = velocityFacts(d);
  const months = await getVelocityMonths(d.client.clientId);
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const historyMonth = d.summary?.historyStart.slice(0, 7) ?? null;

  const through = f.through;
  const launches =
    d.launches.state === "ready" && through
      ? new Map(
          launchMonths(d.launches.rows, d.hitThresholds, d.launches.through, { from: through, to: through }).map(
            (m) => [m.month, m]
          )
        )
      : null;

  const base = toCapacityInputs(d.resolved);
  const rows = (through ? trailingMonths(through, 12) : [])
    .filter((month) => historyMonth === null || month > historyMonth)
    .map((month) => {
      const v = byMonth.get(month) ?? null;
      const l = launches?.get(month) ?? null;
      const cpa = v && v.purchases > 0 ? v.spend / v.purchases : null;
      const cap = v ? capacity({ ...base, spend: v.spend, cpa }).capacity : null;
      const launched = l ? l.launched : null;
      return {
        month,
        spend: v?.spend ?? null,
        cpa,
        launched,
        capacity: cap,
        production: productionRatio(launched, cap),
        packs: v?.newPacks ?? null,
        winners: l?.winners ?? null,
        rate: l?.rate ?? null,
      };
    });

  const chart: CapacityMonth[] = rows.map((r, i) => ({
    month: r.month,
    label: label(r.month, i === 0),
    launched: r.launched,
    capacity: r.capacity,
  }));

  return (
    <>
      <Header title="Track record" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        {rows.length === 0 ? (
          <NotConnected source="Velocity data" />
        ) : (
          <>
            <section>
              <SectionHead
                title="New ads vs capacity"
                info="Bars: new ads first delivered, relaunches excluded. Dashed mark: capacity at that month's spend and CPA."
              />
              <div className="glass p-5">
                <CapacityBars months={chart} />
              </div>
            </section>

            <section>
              <SectionHead title="By month" />
              <TableFrame minWidth={900}>
                <thead>
                  <tr>
                    <Th left>Month</Th>
                    <Th>Spend</Th>
                    <Th info="That month's spend over its purchases, 7d click + 1d view.">CPA</Th>
                    <Th info="Relaunches excluded.">New ads</Th>
                    <Th info="At that month's spend and CPA, with share, N and ads per pack from Plan.">Capacity</Th>
                    <Th>Prod. vs cap.</Th>
                    <Th info="New ad sets.">Packs</Th>
                    <Th info="Winners among that month's launches, to date.">Winners</Th>
                    <Th>Hit rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.month}>
                      <Td left>{label(r.month, true)}</Td>
                      <Td>{money(r.spend, d.currency)}</Td>
                      <Td>{unitMoney(r.cpa, d.currency)}</Td>
                      <Td>{whole(r.launched)}</Td>
                      <Td>{perMonth(r.capacity)}</Td>
                      <Td tone={r.production !== null && r.production > OVER_CAPACITY_X ? "warn" : "default"}>
                        {times(r.production)}
                      </Td>
                      <Td>{whole(r.packs)}</Td>
                      <Td>{whole(r.winners)}</Td>
                      <Td>{formatRate(r.rate) ?? NO_VALUE}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
            </section>
          </>
        )}
      </main>
    </>
  );
}
