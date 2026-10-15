/**
 * The Markets screen for a resolved client: header, controls and the body.
 *
 * Split from the route so the route stays a thin guard (session, client,
 * capability) and the dev harness (app/dev/markets, development only) can
 * render the same screen for the demo client without a session.
 *
 * The queries run inside a Suspense boundary so the header and controls paint
 * at once and each widget holds its own skeleton until the figures land.
 */

import { Suspense } from "react";
import type { Client } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, comparisonLabel, rangeLabel, type SearchParams, type ViewParams } from "@/lib/params";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import { EmptyNote } from "@/components/ui/PageNotes";
import { MarketsView } from "@/components/markets/MarketsView";
import { MarketsSkeleton } from "@/components/markets/MarketsSkeleton";
import { getMarkets } from "@/lib/queries/markets";
import { buildModel } from "@/lib/markets/model";
import { buildMapGeometry, hasOutline } from "@/lib/markets/geo";
import { researchCandidates } from "@/lib/markets/scouting";
import { parseMarketsState } from "@/lib/markets/state";
import { MARKET_OTHER } from "@/lib/markets/types";
import { isDemo } from "@/lib/demo/client";
import { DEMO_REGIONS, parseDemoRegion, type DemoRegion } from "@/lib/demo/markets";

/** Markets read in quarters: a 30-day window is too thin for a small market. */
const DEFAULT_PRESET = "90d";

async function MarketsSection({
  client,
  params,
  searchParams,
  region,
}: {
  client: Client;
  params: ViewParams;
  searchParams: SearchParams;
  region: DemoRegion;
}) {
  const raw = await getMarkets(client, params.range, params.period.comparison, { demoRegion: region });
  if (!raw) return <EmptyNote>Markets data is not built for this client yet.</EmptyNote>;
  if (raw.current.every((r) => r.sums.orders === 0)) return <NoData />;

  const model = buildModel(raw);
  const sold = model.markets.filter((m) => m.kind === "sold").map((m) => m.key);
  const otherMembers = model.markets.find((m) => m.key === MARKET_OTHER)?.members ?? [];
  const candidates = [...new Set([...model.scouting.map((s) => s.iso), ...researchCandidates(sold)])].filter(
    (iso) => !sold.includes(iso)
  );
  const geometry = {
    sold: buildMapGeometry(sold, otherMembers.filter(hasOutline)),
    scout: buildMapGeometry([...sold, ...candidates.filter(hasOutline)]),
  };
  const range = rangeLabel(params);

  return (
    <MarketsView
      model={model}
      geometry={geometry}
      initial={parseMarketsState(searchParams)}
      rangeText={range.dates}
      compareLabel={params.period.comparison ? comparisonLabel(params) : undefined}
      candidates={candidates}
      ga4Connected={client.capabilities.ga4}
    />
  );
}

export function MarketsScreen({ client, searchParams }: { client: Client; searchParams: SearchParams }) {
  const params = parseViewParams(searchParams, DEFAULT_PRESET);

  if (pageAvailability(client, "/markets") !== "available") {
    return (
      <>
        <Header title="Markets" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/markets") ?? "Shop"} />
        </main>
      </>
    );
  }

  const region = parseDemoRegion(searchParams.region);

  return (
    <>
      <Header title="Markets" />
      <PageControls client={client} params={params} compare />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {isDemo(client.clientId) && (
          <div className="flex">
            <SegmentedControl
              param="region"
              ariaLabel="Demo markets"
              active={region}
              segments={DEMO_REGIONS.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>
        )}
        <Suspense fallback={<MarketsSkeleton />}>
          <MarketsSection client={client} params={params} searchParams={searchParams} region={region} />
        </Suspense>
      </main>
    </>
  );
}
