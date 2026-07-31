/**
 * Channel split — where the paid budget went.
 *
 * ── Spend is platform truth; revenue is not ─────────────────────────────────
 * Meta and Google both report attributed revenue, and both over-attribute:
 * Meta will claim a purchase it merely showed an ad before. Placing those
 * figures beside warehouse revenue implies they're the same kind of number,
 * which is exactly the confusion this warehouse was built to end. So this card
 * shows **spend only** per channel, and efficiency is read blended from MER —
 * one honest number instead of two channel numbers that don't add up.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { DeltaChip } from "@/components/ui/Delta";
import { formatMoney, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import type { PnlSnapshot } from "@/lib/queries/pnl";
import { metric } from "@/lib/queries/pnl";
import type { Client } from "@/lib/clients";

export function ChannelSplit({
  snapshot,
  client,
}: {
  snapshot: PnlSnapshot;
  client: Client;
}) {
  const t = snapshot.current;
  const currency = snapshot.currency;
  const total = t.paidSpend;

  const channels = [
    {
      key: "meta",
      name: "Meta",
      spend: t.metaSpend,
      dot: "bg-platform-meta",
      delta: metric(snapshot, (x) => x.metaSpend).delta,
      connected: client.capabilities.meta || t.metaSpend !== null,
      missingNote: "No Meta ad account connected for this client.",
    },
    {
      key: "google",
      name: "Google",
      spend: t.googleSpend,
      dot: "bg-platform-google",
      delta: metric(snapshot, (x) => x.googleSpend).delta,
      // Trust observed spend over the registry flag — the registry is known to
      // be stale about Google (see the drift check on Data Health).
      connected: t.googleSpend !== null,
      missingNote: `${client.name} has no Google Ads account. This is unknown, not zero.`,
    },
  ];

  const espName = client.emailPlatform
    ? client.emailPlatform[0].toUpperCase() + client.emailPlatform.slice(1)
    : null;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_24px]">
      <div className="flex flex-col gap-[5px]">
        <Eyebrow>Channel split</Eyebrow>
        <span className="text-[12.5px] leading-[1.5] text-content-muted">
          Spend is platform truth. Revenue is not attributable per channel — read
          efficiency blended.
        </span>
      </div>

      {channels.map((ch) => {
        const share = safeDiv(ch.spend, total);

        return (
          <div
            key={ch.key}
            className={`flex flex-col gap-[11px] rounded-control p-[14px_16px] ${
              ch.connected
                ? "border border-hairline bg-paper"
                : "border border-dashed border-hairline-strong bg-paper"
            }`}
          >
            <div className="flex items-center justify-between gap-2.5">
              <span
                className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] ${
                  ch.connected ? "text-content-strong" : "text-content-muted"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-[9px] w-[9px] rounded-[3px] ${
                    ch.connected
                      ? ch.dot
                      : "border border-dashed border-hairline-strong"
                  }`}
                />
                {ch.name}
              </span>
              <span
                className={`font-mono text-[15px] font-semibold tracking-heading tabular ${
                  ch.connected ? "text-content-strong" : "text-gray-250"
                }`}
              >
                {ch.connected ? formatMoney(ch.spend, currency) : "—"}
              </span>
            </div>

            {ch.connected ? (
              <div className="flex flex-col gap-[9px]">
                <div className="h-1.5 overflow-hidden rounded-pill bg-gray-100">
                  <div
                    className={`h-1.5 rounded-pill ${ch.dot}`}
                    style={{ width: share !== null ? `${share * 100}%` : "0%" }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] tabular text-content-muted">
                    {share !== null ? formatPercent(share, { decimals: 0 }) : "—"} of
                    paid spend
                  </span>
                  {snapshot.previous && (
                    <DeltaChip delta={ch.delta} goodWhen="neutral" />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-[7px]">
                <span className="self-start rounded-pill border border-dashed border-hairline-strong px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.1em] text-gray-400">
                  Not connected
                </span>
                <span className="text-[12px] leading-[1.5] text-content-muted">
                  {ch.missingNote}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {espName && (
        <div className="flex flex-col gap-2.5 border-t border-hairline pt-3.5">
          <Eyebrow>Email — {espName}</Eyebrow>
          <div className="flex flex-col gap-1.5 rounded-control border border-dashed border-hairline-strong p-[12px_14px]">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gray-400">
              No daily view yet
            </span>
            <span className="text-[12px] leading-[1.5] text-content-muted">
              Campaign performance is in the warehouse; the daily email screen
              isn&apos;t built. Subscriber growth is separately blocked on a
              Klaviyo segment — unknown, not zero.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
