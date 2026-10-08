/**
 * Home: the first product on the rail.
 *
 * A greeting and the weather where you are, then every client as a health
 * card: status, results against the month's goals, and the money between us
 * and them. The figures come from `lib/home/queries.ts`, which says where each
 * one is read from; the ring and its colour are the Goals pacing status, not a
 * score of this page's own.
 *
 * Internal only. It lists every client by name next to what they pay us, which
 * is no single client's business, so it is gated like Data Health. The rail
 * hides the icon for the client role, but the gate is here.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { getHomeData } from "@/lib/home/queries";
import { firstName } from "@/lib/home/greeting";
import { Header } from "@/components/shell/Header";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { Greeting } from "@/components/home/Greeting";
import { WeatherCard } from "@/components/home/WeatherCard";
import { HomeSummary } from "@/components/home/HomeSummary";
import { ClientCard } from "@/components/home/ClientCard";
import { TeamStreak, TeamLeaderboard } from "@/components/presence/Presence";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireInternalRole();
  const [session, data] = await Promise.all([getSession(), getHomeData()]);
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    <>
      <Header title="Home" />
      <main className="page-frame flex flex-col gap-[26px] px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2.5">
            <Greeting name={name} now={new Date().toISOString()} />
            <TeamStreak />
          </div>
          <WeatherCard />
        </section>

        <section className="flex flex-col gap-3.5" aria-label="Clients">
          <SectionTitle>Clients</SectionTitle>
          <HomeSummary summary={data.summary} />
          <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
            {data.clients.map((client) => (
              <ClientCard key={client.key} client={client} />
            ))}
          </div>
        </section>

        <TeamLeaderboard />
      </main>
    </>
  );
}
