/**
 * Markets, Products for a resolved client: header, controls and the body.
 *
 * Split from the route so the route stays a thin guard and the dev harness
 * (app/dev/markets-products, development only) renders the same screen for
 * the demo client without a session. The query runs inside a Suspense
 * boundary, so the header and controls paint at once.
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
import { ProductsView } from "@/components/markets/products/ProductsView";
import { ProductsSkeleton } from "@/components/markets/products/ProductsSkeleton";
import { getMarketsProducts } from "@/lib/queries/marketsProducts";
import { buildProductsModel } from "@/lib/markets/products";
import { isDemo } from "@/lib/demo/client";
import { DEMO_REGIONS, parseDemoRegion, type DemoRegion } from "@/lib/demo/markets";

/** Same default as Markets: a 30-day window is too thin for a small market's product mix. */
const DEFAULT_PRESET = "90d";
const TITLE = "Products by market";

async function ProductsSection({ client, params, region }: { client: Client; params: ViewParams; region: DemoRegion }) {
  const raw = await getMarketsProducts(client, params.range, params.period.comparison, { demoRegion: region });
  if (!raw) return <EmptyNote>Markets data is not built for this client yet.</EmptyNote>;
  const model = buildProductsModel(raw);
  if (model.markets.length === 0 || model.rows.length === 0) return <NoData />;
  return (
    <ProductsView
      model={model}
      rangeText={rangeLabel(params).dates}
      compareLabel={params.period.comparison ? comparisonLabel(params) : undefined}
    />
  );
}

export function ProductsScreen({ client, searchParams }: { client: Client; searchParams: SearchParams }) {
  const params = parseViewParams(searchParams, DEFAULT_PRESET);

  if (pageAvailability(client, "/markets/products") !== "available") {
    return (
      <>
        <Header title={TITLE} />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/markets/products") ?? "Shop"} />
        </main>
      </>
    );
  }

  const region = parseDemoRegion(searchParams.region);

  return (
    <>
      <Header title={TITLE} />
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
        <Suspense fallback={<ProductsSkeleton />}>
          <ProductsSection client={client} params={params} region={region} />
        </Suspense>
      </main>
    </>
  );
}
