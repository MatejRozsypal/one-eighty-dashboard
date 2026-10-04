/**
 * Paid funnel from GA4 sessions: sessions, then the share that viewed an item,
 * added to cart, began checkout and purchased. The control picks the channel
 * (`?ch=`); the funnel itself is the shared `Funnel`.
 */

import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { Funnel } from "@/components/dashboard/Funnel";
import { NoData } from "@/components/ui/EmptyState";
import { GA4_FUNNEL_CHANNELS, type Ga4FunnelChannel, type Ga4FunnelCounts } from "@/lib/queries/paidGa4";

const LABEL: Record<Ga4FunnelChannel, string> = {
  all: "All paid",
  "Paid Social": "Paid Social",
  "Paid Search": "Paid Search",
  "Paid Shopping": "Paid Shopping",
  "Cross-network": "Cross-network",
};

export function Ga4Funnel({
  counts,
  channel,
}: {
  counts: Ga4FunnelCounts;
  channel: Ga4FunnelChannel;
}) {
  const hasSessions = (counts.sessions ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <SegmentedControl
          param="ch"
          ariaLabel="Funnel channel"
          active={channel}
          segments={GA4_FUNNEL_CHANNELS.map((c) => ({ value: c, label: LABEL[c] }))}
        />
      </div>
      {hasSessions ? (
        <Funnel
          steps={[
            { label: "Sessions", value: counts.sessions ?? 0 },
            { label: "Viewed item", value: counts.viewItem ?? 0 },
            { label: "Added to cart", value: counts.addToCart ?? 0 },
            { label: "Began checkout", value: counts.checkout ?? 0 },
            { label: "Purchased", value: counts.purchase ?? 0 },
          ]}
        />
      ) : (
        <NoData />
      )}
    </div>
  );
}
