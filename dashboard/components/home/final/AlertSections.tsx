/**
 * The streamed For you and Promotions sections of Home. For you is personal
 * (the signed-in person's dismissals and ClickUp tasks). Each awaits only its
 * own loaders (lib/home/final/alerts.ts, lib/home/final/promos.ts) inside its
 * own Suspense boundary on the page.
 */

import { Skeleton } from "@/components/ui/Skeleton";
import { loadForYou } from "@/lib/home/final/alerts";
import { loadPromotions } from "@/lib/home/final/promos";
import { ForYou } from "./ForYou";
import { Promotions } from "./Promotions";

export async function HomeForYou() {
  const d = await loadForYou();
  return (
    <ForYou
      me={d.me}
      cards={d.cards}
      mine={d.mine}
      others={d.others}
      tasks={d.tasks}
      tasksNote={d.tasksNote}
      dismissNote={d.dismissNote}
      mode={d.mode}
      updatedAt={d.updatedAt}
      liveNote={d.liveNote}
      now={d.now}
    />
  );
}

export async function HomePromotions() {
  const p = await loadPromotions();
  return <Promotions items={p.items} note={p.note} />;
}

export function PromotionsSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3.5">
      <Skeleton className="h-[18px] w-[110px] rounded-pill" />
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[230px] w-full rounded-card" />
        ))}
      </div>
    </section>
  );
}
