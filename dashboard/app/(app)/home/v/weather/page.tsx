/**
 * Home, Forecast variant: the agency read like Apple Weather.
 *
 * The sky at the top carries the greeting, the weather outside and the
 * agency's own reading in the place of the temperature: the share of clients
 * with a plan this month that are on track or ahead. On glass beneath it,
 * the month day by day against the plan. Below, every client's month-end
 * forecast on one scale, then the condition tiles. Sources in
 * `lib/home/weather/forecast.ts`.
 *
 * Internal only, as Home is: it lists every client next to what they pay us.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { firstName, HOME_TIME_ZONE } from "@/lib/home/greeting";
import { getForecastData } from "@/lib/home/weather/forecast";
import { agencyReading, isoToday } from "@/lib/home/weather/model";
import { Header } from "@/components/shell/Header";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { ForecastHero } from "@/components/home/weather/ForecastHero";
import { DailyStrip } from "@/components/home/weather/DailyStrip";
import { MonthForecast } from "@/components/home/weather/MonthForecast";
import { ConditionTiles } from "@/components/home/weather/ConditionTiles";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomeForecastPage() {
  await requireInternalRole();
  const [session, data] = await Promise.all([getSession(), getForecastData()]);
  const name = firstName(session?.user?.name, session?.user?.email);
  const now = new Date();
  const { home, strip } = data;

  return (
    <>
      <Header title="Home" />
      <main className="page-frame flex flex-col gap-[26px] px-4 pb-14 pt-5 sm:px-5 sm:pt-6 lg:px-8">
        <ForecastHero name={name} now={now.toISOString()} monthLabel={strip.monthLabel} reading={agencyReading(home.clients)}>
          <DailyStrip strip={strip} today={isoToday(now, HOME_TIME_ZONE)} />
        </ForecastHero>

        <section className="flex flex-col gap-3.5" aria-label="Month-end forecast">
          <SectionTitle>Month-end forecast</SectionTitle>
          <MonthForecast clients={home.clients} monthLabel={strip.monthLabel} />
        </section>

        <section className="flex flex-col gap-3.5" aria-label="Conditions">
          <SectionTitle>Conditions</SectionTitle>
          <ConditionTiles
            spend={data.spend}
            queue={data.queue}
            unmapped={data.unmapped}
            feeds={data.feeds}
            summary={home.summary}
            clients={home.clients}
          />
        </section>
      </main>
    </>
  );
}
