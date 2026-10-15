/**
 * Dev harness: Settings > Market costs for the demo client, without a session.
 *
 * Local `next dev` cannot sign in (no Postgres, no Google SSO), so the real
 * Settings screen is unreachable on a laptop. This renders the same section
 * and form with the demo client's cost cards from lib/demo; saving runs the
 * form's validation and then a no-op, nothing is stored.
 *
 * `?empty=1` shows the state of a real client before the owner fills a card.
 *
 * Development only: `next build` / `next start` (NODE_ENV=production) answer
 * 404, so the route never exists on Vercel.
 *
 *     npm run dev   then   http://localhost:3000/dev/market-costs
 */

import { notFound } from "next/navigation";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { MarketCostCards } from "@/components/settings/MarketCostCards";
import { marketCostSummary } from "@/lib/markets/costCardForm";
import { demoCostCards } from "@/lib/demo/markets";
import { DEMO_CLIENT } from "@/lib/demo/client";
import { getCostCardMarkets } from "@/lib/queries/markets";
import type { SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

async function noopSave(formData: FormData): Promise<void> {
  "use server";
  if (process.env.NODE_ENV === "production") return;
  console.log("[dev/market-costs] would save", Object.fromEntries(formData.entries()));
}

export default async function MarketCostsHarness({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  const markets = (await getCostCardMarkets(DEMO_CLIENT)) ?? [];
  const cards = searchParams.empty ? [] : demoCostCards("na");
  return (
    <main className="page-frame flex min-h-screen flex-col gap-5 bg-bg-subtle px-5 pb-14 pt-6 lg:px-8">
      <SettingsSection
        title="Market costs"
        defaultOpen
        summary={marketCostSummary(markets, cards)}
        description="Per market costs beyond COGS: they turn gross profit into CM2 and CM3 on the Markets page. Empty fields show n/a there, never zero."
      >
        <MarketCostCards
          clientId={DEMO_CLIENT.clientId}
          currency={DEMO_CLIENT.currency}
          markets={markets}
          cards={cards}
          today={new Date().toISOString().slice(0, 10)}
          action={noopSave}
        />
      </SettingsSection>
    </main>
  );
}
