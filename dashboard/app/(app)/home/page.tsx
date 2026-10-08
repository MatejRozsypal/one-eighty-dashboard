/**
 * Home: the first product on the rail.
 *
 * The Shopify variant (/home/v/shopify) as the base, chosen by the owner on
 * 2026-10-08, with the Health variant's activity rings for the clients and the
 * long date above the greeting. Top to bottom:
 *
 *   period pill, "All clients · CZK", weather pill
 *   six figures for the last 30 days, one centred row without a card
 *   (components/home/final/KpiStrip.tsx)
 *   the leaderboard card, top right beside the greeting from 1100 px, under
 *   the strip below that (components/presence/LeaderboardCard.tsx)
 *   THURSDAY 8 OCTOBER, the greeting, one line about the clients
 *   the streak pill (with XP today) and the daily quote
 *   the assistant's box, chips of waiting work
 *   For you: cards from explicit rules, ordered by money at stake
 *   Clients: a ring card per client, opening its Goals page
 *
 * Every figure comes from lib/home/final/data.ts, which names its sources;
 * anything a source cannot give is n/a with the source in its (i). Each
 * section streams in its own Suspense boundary, so the date, the greeting and
 * the strip's frame paint before the slower reads finish.
 *
 * Internal only. It lists every client by name next to what they pay us, so
 * it is gated like Data Health. The rail hides the icon for the client role,
 * but the gate is here.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { firstName } from "@/lib/home/greeting";
import { Header } from "@/components/shell/Header";
import { AssistantBox } from "@/components/home/shopify/Hero";
import { WeatherChip } from "@/components/home/shopify/WeatherChip";
import { GreetingHeader } from "@/components/home/final/GreetingHeader";
import { HomeKpiStrip, StripThrough } from "@/components/home/final/KpiStrip";
import { ClientCardsSkeleton } from "@/components/home/final/ClientCards";
import {
  ChipsSkeleton,
  GreetingLine,
  GreetingLineSkeleton,
  HomeChips,
  HomeClients,
  HomeRecommendations,
  RecommendationsSkeleton,
} from "@/components/home/final/Sections";
import { TeamStreak, TeamLeaderboard } from "@/components/presence/Presence";
import { LeaderboardCardSkeleton } from "@/components/presence/LeaderboardCard";
import { DailyQuote } from "@/components/home/DailyQuote";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

const PILL =
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-surface-card px-2.5 text-[12.5px] font-semibold text-content-strong";

export default async function HomePage() {
  await requireInternalRole();
  const session = await getSession();
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    <>
      <Header title="Home" />
      <main className="page-frame flex flex-col gap-6 px-4 pb-14 pt-5 sm:px-5 lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={PILL}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-content-muted">
                  <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                </svg>
                Last 30 days
                <Suspense fallback={null}>
                  <StripThrough />
                </Suspense>
              </span>
              <span className={PILL}>All clients · CZK</span>
            </div>
            <WeatherChip />
          </div>
          <HomeKpiStrip />
        </div>

        <div className="flex flex-col gap-5 py-6 sm:py-10">
          {/*
            From 1100 px: three columns, the leaderboard card in the right one
            and an empty one of the same width on the left, so the greeting
            and the box stay centred and the card never pushes them. Narrower:
            one column, the card first, right under the strip.
          */}
          <div className="flex flex-col gap-6 min-[1100px]:grid min-[1100px]:grid-cols-[minmax(248px,1fr)_minmax(0,720px)_minmax(248px,1fr)] min-[1100px]:items-start min-[1100px]:gap-x-6">
            <aside
              aria-label="Leaderboard"
              className="w-full min-[1100px]:col-start-3 min-[1100px]:row-start-1 min-[1100px]:max-w-[296px] min-[1100px]:justify-self-end"
            >
              <Suspense fallback={<LeaderboardCardSkeleton />}>
                <TeamLeaderboard />
              </Suspense>
            </aside>
            <section aria-label="Assistant" className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-6 text-center min-[1100px]:col-start-2 min-[1100px]:row-start-1">
              <div className="flex flex-col items-center gap-3">
                <div className="flex flex-col items-center gap-2">
                  <GreetingHeader name={name} now={new Date().toISOString()} />
                  <Suspense fallback={<GreetingLineSkeleton />}>
                    <GreetingLine />
                  </Suspense>
                </div>
                <Suspense fallback={null}>
                  <TeamStreak />
                </Suspense>
                <DailyQuote />
              </div>
              <AssistantBox />
            </section>
          </div>
          <Suspense fallback={<ChipsSkeleton />}>
            <HomeChips />
          </Suspense>
        </div>

        <Suspense fallback={<RecommendationsSkeleton />}>
          <HomeRecommendations />
        </Suspense>

        <Suspense fallback={<ClientCardsSkeleton />}>
          <HomeClients />
        </Suspense>

      </main>
    </>
  );
}
