/**
 * The streamed sections of Home: each awaits only its own loaders
 * (lib/home/final/data.ts, memoised per request) and is wrapped in a
 * Suspense boundary on the page, so the date, the greeting and the strip's
 * frame paint at once and slower sources arrive as they finish.
 */

import { Skeleton } from "@/components/ui/Skeleton";
import { ActionChips } from "@/components/home/shopify/ActionChips";
import { Recommendations } from "@/components/home/shopify/Recommendations";
import { loadChips, loadClientTiles, loadGreetingLine, loadRecommendations } from "@/lib/home/final/data";
import { ClientCardsView } from "./ClientCards";

export async function GreetingLine() {
  const line = await loadGreetingLine();
  return <p className="m-0 text-[16px] leading-[1.4] text-content-muted sm:text-[17px]">{line}</p>;
}

export function GreetingLineSkeleton() {
  return <Skeleton className="h-[22px] w-[260px] rounded-pill" />;
}

export async function HomeChips() {
  return <ActionChips chips={await loadChips()} />;
}

export function ChipsSkeleton() {
  return (
    <div aria-busy="true" className="flex justify-center gap-2">
      <Skeleton className="h-9 w-[150px] rounded-pill" />
      <Skeleton className="h-9 w-[130px] rounded-pill" />
      <Skeleton className="h-9 w-[140px] rounded-pill" />
    </div>
  );
}

export async function HomeRecommendations() {
  return <Recommendations items={await loadRecommendations()} />;
}

export function RecommendationsSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3.5">
      <Skeleton className="h-[18px] w-[80px] rounded-pill" />
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[190px] w-full rounded-card" />
        ))}
      </div>
    </section>
  );
}

export async function HomeClients() {
  return <ClientCardsView tiles={await loadClientTiles()} />;
}
