/**
 * The empty state all three inventory pages share.
 *
 * Says which object is missing and why it might be, rather than "no data" —
 * the same failure looks identical for a client on Shoptet (no snapshot exists
 * at all) and for a warehouse where migration 218 has not been run, and those
 * have completely different fixes.
 *
 * Note this is only ever reached for a genuinely absent view. A permission
 * denial is re-thrown in `lib/queries/inventory.ts` and surfaces as an error,
 * because a dashboard that says "no data" when it means "I was not allowed to
 * look" gets believed.
 */

import { Badge } from "@/components/ui/Badge";

export function NoStockData({ clientName }: { clientName: string }) {
  return (
    <main className="flex max-w-[1240px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
      <div className="flex max-w-[640px] flex-col gap-3 rounded-card border border-dashed border-hairline-strong bg-paper p-[32px_24px]">
        <span className="self-start">
          <Badge variant="outline" size="sm">
            No data
          </Badge>
        </span>
        <span className="text-[15px] font-semibold text-content-strong">
          No stock data for {clientName}.
        </span>
        <span className="text-[13px] leading-[1.6] text-content-body">
          This reads{" "}
          <code className="font-mono text-[12px]">mart.mart_sku_inventory</code>,
          fed from the Shopify products snapshot. A client on Shoptet has no
          snapshot at all yet — the current workflow pulls orders only.
        </span>
      </div>
    </main>
  );
}
