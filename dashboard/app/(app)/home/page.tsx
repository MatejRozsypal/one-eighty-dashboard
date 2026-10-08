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
 *   the leaderboard card, top right beside the greeting when the content
 *   area is 960 px or wider, under the strip below that (components/presence/LeaderboardCard.tsx)
 *   THURSDAY 8 OCTOBER, the greeting, one line about the clients
 *   the streak pill (with XP today) and the daily quote
 *   the assistant's box (sending carries it into a new Assistant
 *   conversation), chips of waiting work
 *   Promotions: running and starting within 7 days (ClickUp promo calendars)
 *   For you: client alerts (daily snapshot) and my ClickUp tasks, dismissable per person
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
  HomeChips,
  HomeClients,
  RecommendationsSkeleton,
} from "@/components/home/final/Sections";
import { TeamLeaderboard } from "@/components/presence/Presence";
import { LeaderboardCardSkeleton } from "@/components/presence/LeaderboardCard";
import { DailyQuote } from "@/components/home/DailyQuote";
import { HomeForYou, HomePromotions, PromotionsSkeleton } from "@/components/home/final/AlertSections";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

const PILL =
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-surface-card px-2.5 text-[12.5px] font-semibold text-content-strong";

export default async function HomePage() {
  await requireInternalRole();
  const session = await getSession();
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    // `data-blend-root` is what dissolves when a question sent from the box
    // carries the page into the Assistant (components/chat/HandoffStage.tsx).
    <div data-blend-root="" className="flex min-w-0 flex-1 flex-col">
      <Header title="Home" />
      {/*
        Container queries on the whole content area (sidebar excluded):
        - 2040 px and wider: the page column (1400 px max) leaves a gutter on
          the right, and the leaderboard sits in the far right corner of the
          window, where Shopify keeps its globe.
        - 1040 to 2039 px: it sits in a right column beside the greeting.
        - narrower: a full-width card under the strip.
        The card renders in each place and container queries show one.
      */}
      <div className="relative [container-type:inline-size]">
        <aside
          aria-label="Leaderboard"
          className="absolute right-5 top-5 z-[1] hidden w-[300px] flex-col items-end gap-3 [@container(min-width:2040px)]:flex"
        >
          <WeatherChip />
          <div className="w-full">
            <Suspense fallback={<LeaderboardCardSkeleton />}>
              <TeamLeaderboard />
            </Suspense>
          </div>
        </aside>

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
            <span className="[@container(min-width:2040px)]:hidden">
              <WeatherChip />
            </span>
          </div>
          <HomeKpiStrip />
        </div>

        <div className="flex flex-col gap-6 [@container(min-width:1040px)_and_(max-width:2039px)]:grid [@container(min-width:1040px)_and_(max-width:2039px)]:grid-cols-[minmax(0,1fr)_288px] [@container(min-width:1040px)_and_(max-width:2039px)]:items-start [@container(min-width:1040px)_and_(max-width:2039px)]:gap-x-8">
          <aside
            aria-label="Leaderboard"
            className="w-full [@container(min-width:2040px)]:hidden [@container(min-width:1040px)_and_(max-width:2039px)]:col-start-2 [@container(min-width:1040px)_and_(max-width:2039px)]:row-start-1"
          >
            <Suspense fallback={<LeaderboardCardSkeleton />}>
              <TeamLeaderboard />
            </Suspense>
          </aside>

          <div className="flex min-w-0 flex-col gap-5 py-4 [@container(min-width:1040px)_and_(max-width:2039px)]:col-start-1 [@container(min-width:1040px)_and_(max-width:2039px)]:row-start-1 sm:py-8">
            <section aria-label="Assistant" className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <GreetingHeader name={name} now={new Date().toISOString()} />
                <DailyQuote />
              </div>
              <AssistantBox />
            </section>
            <Suspense fallback={<ChipsSkeleton />}>
              <HomeChips />
            </Suspense>
          </div>
        </div>

        <Suspense fallback={<PromotionsSkeleton />}>
          <HomePromotions />
        </Suspense>

        <Suspense fallback={<RecommendationsSkeleton />}>
          <HomeForYou />
        </Suspense>

        <Suspense fallback={<ClientCardsSkeleton />}>
          <HomeClients />
        </Suspense>

      </main>
      </div>
    </div>
  );
}
