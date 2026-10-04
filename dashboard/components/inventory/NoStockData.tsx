/**
 * The empty state all three inventory pages share. Delegates to the shared
 * one-line primitive: stock comes from the Shopify products snapshot only.
 * `clientName` is ignored (kept so the pages compile until WP8 drops it).
 */

import { NotConnected } from "@/components/ui/EmptyState";

export function NoStockData(_props: { clientName?: string }) {
  return (
    <main className="flex max-w-[1240px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
      <div className="max-w-[640px]">
        <NotConnected source="Shopify" />
      </div>
    </main>
  );
}
