/**
 * Spend mix: one 100% bar per connected platform.
 *
 * Meta splits by funnel stage, Google by brand class. Most Meta campaigns do
 * not name their stage, so "Unclassified" is expected to be large until a real
 * audience split exists. A segment links to its platform tab with the matching
 * filter; hover (or focus) shows spend, share and ROAS. A label sits inside a
 * segment only when it is wider than 15%.
 */

import { AppLink } from "@/components/ui/AppLink";
import { formatMoney, formatPercent, formatRatio } from "@/lib/format";
import type { MixSegment } from "@/components/paid/overview/model";

// Tokens only. Distinct steps of one family per platform, so segments read as a set.
const META_TONES: Record<string, string> = {
  prospecting: "bg-platform-meta",
  retargeting: "bg-platform-meta/70",
  retention: "bg-platform-meta/45",
  unclassified: "bg-gray-200",
};
const GOOGLE_TONES: Record<string, string> = {
  brand: "bg-platform-google",
  non_brand: "bg-platform-google/70",
  shopping_pmax: "bg-platform-google/45",
  other: "bg-gray-200",
};

function Bar({
  platform,
  label,
  dot,
  segments,
  tones,
  currency,
  hrefFor,
}: {
  platform: string;
  label: string;
  dot: string;
  segments: MixSegment[];
  tones: Record<string, string>;
  currency: string;
  hrefFor: (key: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="inline-flex w-[84px] flex-none items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        <span aria-hidden="true" className={`h-[9px] w-[9px] rounded-[3px] ${dot}`} />
        {label}
      </span>
      {segments.length === 0 ? (
        <span className="text-[12.5px] text-content-muted">Not connected</span>
      ) : (
        <div className="flex h-9 min-w-0 flex-1 gap-px overflow-hidden rounded-md" role="list" aria-label={`${platform} spend mix`}>
          {segments.map((s) => {
            const text = `${s.label}: ${formatMoney(s.spend, currency)}, ${formatPercent(s.share, { decimals: 0 })}, ROAS ${formatRatio(s.roas)}`;
            const dark = ["prospecting", "retargeting", "brand", "non_brand"].includes(s.key);
            return (
              <AppLink
                key={s.key}
                role="listitem"
                href={hrefFor(s.key)}
                title={text}
                aria-label={text}
                style={{ flexGrow: s.share, flexBasis: 0 }}
                className={`flex min-w-[6px] items-center overflow-hidden px-2.5 font-mono text-[11px] transition-opacity duration-fast hover:opacity-80 focus-visible:opacity-80 ${
                  tones[s.key] ?? "bg-gray-200"
                } ${dark ? "text-content-inverse" : "text-content-strong"}`}
              >
                {s.share > 0.15 && (
                  <span className="truncate">
                    {s.label} {formatPercent(s.share, { decimals: 0 })}
                  </span>
                )}
              </AppLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SpendMix({
  meta,
  google,
  hasMeta,
  hasGoogle,
  currency,
  metaHref,
  googleHref,
}: {
  meta: MixSegment[];
  google: MixSegment[];
  hasMeta: boolean;
  hasGoogle: boolean;
  currency: string;
  /** Link to the Meta tab filtered to a funnel stage. */
  metaHref: (stage: string) => string;
  /** Link to the Google tab filtered to a brand class. */
  googleHref: (brandClass: string) => string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {(hasMeta || meta.length > 0) && (
        <Bar platform="Meta" label="Meta" dot="bg-platform-meta" segments={meta} tones={META_TONES} currency={currency} hrefFor={metaHref} />
      )}
      {(hasGoogle || google.length > 0) && (
        <Bar platform="Google" label="Google" dot="bg-platform-google" segments={google} tones={GOOGLE_TONES} currency={currency} hrefFor={googleHref} />
      )}
    </div>
  );
}
