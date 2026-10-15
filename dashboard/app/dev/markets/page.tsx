/**
 * Dev harness: the Markets screen for the demo client, without a session.
 *
 * Local `next dev` cannot sign in (no Postgres, no Google SSO) and cannot read
 * BigQuery, so the real route is unreachable on a laptop. This renders the
 * same `MarketsScreen` inside the same shell providers for the DEMO client
 * only: every figure comes from lib/demo, no query can reach the warehouse,
 * and no real client can be selected here.
 *
 * Development only: `next build` / `next start` (NODE_ENV=production) answer
 * 404, so the route never exists on Vercel. Delete the folder if it is not
 * wanted in the tree.
 *
 *     npm run dev   then   http://localhost:3000/dev/markets
 */

import { notFound } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileTopBar } from "@/components/shell/MobileTopBar";
import { NavigationPendingProvider, PendingRegion } from "@/components/shell/NavigationPending";
import { DeltaModeProvider } from "@/components/ui/DeltaMode";
import { HistoryProvider } from "@/components/chat/HistoryProvider";
import { ChatSessionProvider } from "@/components/chat/ChatSession";
import { MarketsScreen } from "@/components/markets/MarketsScreen";
import { DEMO_CLIENT } from "@/lib/demo/client";
import { resolveDeltaMode, type SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default function MarketsHarness({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  const clients = [DEMO_CLIENT];
  return (
    <NavigationPendingProvider>
      <DeltaModeProvider initial={resolveDeltaMode(searchParams, undefined)}>
        <HistoryProvider>
          <ChatSessionProvider>
            <div className="flex min-h-screen items-start bg-bg-subtle">
              <Sidebar clients={clients} role="admin" isAdmin isInternal showSettings={false} />
              <div data-app-column="" className="flex min-h-screen min-w-0 flex-1 flex-col">
                <MobileTopBar clients={clients} isAdmin isInternal role="admin" />
                <div id="content" className="flex min-w-0 flex-1 flex-col bg-bg-subtle">
                  <PendingRegion>
                    <MarketsScreen client={DEMO_CLIENT} searchParams={{ ...searchParams, client: DEMO_CLIENT.clientId }} />
                  </PendingRegion>
                </div>
              </div>
            </div>
          </ChatSessionProvider>
        </HistoryProvider>
      </DeltaModeProvider>
    </NavigationPendingProvider>
  );
}
