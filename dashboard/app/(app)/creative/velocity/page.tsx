/**
 * Velocity, Overview: every client with Meta on one table.
 *
 * Capacity is how many new ads the budget can bring to a verdict a month; the
 * rest of the row says whether the team is producing to it and what is queued.
 * Each row uses the client's saved Plan inputs where present, measured values
 * otherwise, in the client's own Meta currency. A row opens that client's Plan.
 *
 * Cross-client by design, so it reads every client at once: the Creative
 * layout already refuses anyone outside the agency.
 */

import type { Metadata } from "next";
import { AppLink } from "@/components/ui/AppLink";
import { Header } from "@/components/shell/Header";
import { NotConnected } from "@/components/ui/EmptyState";
import { money, unitMoney } from "@/components/creative/primitives";
import { RowLink } from "@/components/creative/velocity/RowLink";
import { TableFrame, Td, Th } from "@/components/creative/velocity/Table";
import { loadVelocityOverview, velocityFacts } from "@/lib/creative/velocityData";
import { OVER_CAPACITY_X, LONG_WINDOW_DAYS } from "@/lib/creative/capacity";
import { days, perMonth, share, times, whole } from "@/lib/creative/velocityFormat";
import { formatRate } from "@/lib/creative/hitRate";
import { NO_VALUE } from "@/lib/format";

export const metadata: Metadata = { title: "Velocity" };
export const dynamic = "force-dynamic";

export default async function VelocityOverviewPage() {
  const clients = await loadVelocityOverview();
  const rows = clients
    .map((d) => ({ d, f: velocityFacts(d) }))
    .sort((a, b) => a.d.client.name.localeCompare(b.d.client.name));

  return (
    <>
      <Header title="Velocity" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        {rows.length === 0 ? (
          <NotConnected source="Meta" />
        ) : (
          <TableFrame minWidth={960}>
            <thead>
              <tr>
                <Th left>Client</Th>
                <Th info="SMALL under 3k, MID 3k to 15k, LARGE over 15k USD of Meta spend a month.">Tier</Th>
                <Th info="Meta spend, last 30 days.">Spend 30d</Th>
                <Th info="Last 90 days, 7d click + 1d view.">CPA</Th>
                <Th info="Share of spend on ads in their first 14 days, last 30 days.">New share</Th>
                <Th info="New ads a month the budget brings to a verdict, at the saved Plan inputs.">Capacity</Th>
                <Th info="Ads first delivered in the last 30 days, relaunches excluded.">New ads 30d</Th>
                <Th info="New ads 30d over capacity at the last 30 days' actual spend.">Prod. vs cap.</Th>
                <Th info="Days until a new pack has been paid N x CPA, at least 7.">Window</Th>
                <Th info="ClickUp ad tasks ready to upload plus in the works.">Queue</Th>
                <Th info="Capacity minus queue.">Brief next mo.</Th>
                <Th info="Winners among launches of the trailing 12 months.">Hit rate 12m</Th>
                <Th info="1 / (capacity x hit rate).">Mo. / winner</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, f }) => {
                const href = `/creative/velocity/plan?client=${encodeURIComponent(d.client.clientId)}`;
                const over = f.production !== null && f.production > OVER_CAPACITY_X;
                const long = f.plan.windowDays !== null && f.plan.windowDays > LONG_WINDOW_DAYS;
                return (
                  <RowLink key={d.client.clientId} href={href}>
                    <Td left>
                      <AppLink href={href} className="hover:underline">
                        {d.client.name}
                      </AppLink>
                    </Td>
                    <Td>{f.tier ?? NO_VALUE}</Td>
                    <Td>{money(d.summary?.spend30d ?? null, d.currency)}</Td>
                    <Td>{unitMoney(d.resolved.cpa, d.currency)}</Td>
                    <Td>{share(d.resolved.newShare)}</Td>
                    <Td>{perMonth(f.plan.capacity)}</Td>
                    <Td>{whole(f.newAds30d)}</Td>
                    <Td tone={over ? "warn" : "default"}>{times(f.production)}</Td>
                    <Td tone={long ? "warn" : "default"}>{days(f.plan.windowDays)}</Td>
                    <Td>{whole(f.queued)}</Td>
                    <Td>{whole(f.brief)}</Td>
                    <Td>{formatRate(d.resolved.hitRate) ?? NO_VALUE}</Td>
                    <Td>{perMonth(f.plan.monthsPerWinner)}</Td>
                  </RowLink>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </main>
    </>
  );
}
