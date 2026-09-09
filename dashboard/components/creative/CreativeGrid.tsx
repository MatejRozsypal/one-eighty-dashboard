"use client";

/**
 * The creative wall.
 *
 * ── Ranked by spend, never by ROAS ─────────────────────────────────────────
 * This is the rule the whole product is built on and this grid is where it is
 * most visible. Spend share is what Meta's algorithm decided; ROAS is a noisy
 * estimate of what happened next, and at this account size that estimate has a
 * ±60 to ±115% interval on a single ad. Under CBO roughly 4% of ads end up
 * holding 64% of both spend and revenue, so the order of this grid is itself a
 * finding: the top four tiles are where the money went.
 *
 * ── Client-side, and only for the filters ──────────────────────────────────
 * Every number was computed on the server. This component filters and renders;
 * it never derives a metric, because a metric derived in two places eventually
 * disagrees with itself.
 */

import { useMemo, useState } from "react";
import type { AdView } from "@/lib/creative/view";
import { focusLabel } from "@/lib/creative/vocabulary";
import { AdDetail } from "@/components/creative/AdDetail";
import { ConfidenceChip, SpendBar, Tag, money, pct, ratePct, roas } from "@/components/creative/primitives";

const ALL = "*";

interface Filter {
  key: keyof AdView;
  label: string;
}

const FILTERS: Filter[] = [
  { key: "persona", label: "Persona" },
  { key: "angle", label: "Angle" },
  { key: "format", label: "Format" },
  { key: "method", label: "Made by" },
  { key: "market", label: "Market" },
];

/**
 * A filter arriving from another screen.
 *
 * Breakdown and Concepts both end in the same question — "which ads are those"
 * — and the answer is this grid. The five selects cannot carry it: a concept is
 * matched on an id and displayed as a name, and adding a select for every
 * breakable dimension would put nine dropdowns above the wall.
 *
 * So a linked-in filter is a chip instead: it says what it is, it says how many
 * of how many it left, and it comes off in one click.
 */
export interface GridFocus {
  /** A key of AdView — `conceptId`, `angle`, `adsetName`. */
  field: string;
  /** The raw value to match. */
  value: string;
  /** What to call it on the chip. */
  display: string;
}

export function CreativeGrid({
  ads,
  currency,
  clientId,
  killRoas,
  targetRoas,
  directionalPurchases,
  focus,
}: {
  ads: AdView[];
  currency: string;
  clientId: string;
  killRoas: number;
  targetRoas: number;
  directionalPurchases: number;
  focus?: GridFocus | null;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<AdView | null>(null);
  const [focusOn, setFocusOn] = useState(true);
  const activeFocus = focus && focusOn ? focus : null;

  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of FILTERS) {
      const values = new Set<string>();
      for (const ad of ads) values.add((ad[f.key] as string | null) ?? "Untagged");
      out[f.key] = [...values].sort();
    }
    return out;
  }, [ads]);

  const rows = useMemo(
    () =>
      ads
        .filter((ad) =>
          FILTERS.every((f) => {
            const want = selected[f.key] ?? ALL;
            if (want === ALL) return true;
            return ((ad[f.key] as string | null) ?? "Untagged") === want;
          })
        )
        .filter((ad) =>
          activeFocus
            ? ((ad as unknown as Record<string, unknown>)[activeFocus.field] ?? null) ===
              activeFocus.value
            : true
        ),
    [ads, selected, activeFocus]
  );

  const maxSpend = Math.max(1, ...ads.map((a) => a.spend));

  return (
    <>
      {focus && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFocusOn((v) => !v)}
            aria-pressed={focusOn}
            className={`inline-flex items-center gap-2 rounded-control border px-3 py-1.5 text-[12.5px] transition-colors duration-fast ${
              focusOn
                ? "border-accent/45 bg-accent-soft text-content-strong"
                : "border-hairline-strong bg-paper/60 text-content-muted"
            }`}
          >
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
              {focusLabel(focus.field)}
            </span>
            <span className="font-medium">{focus.display}</span>
            <span aria-hidden="true" className="text-content-muted">
              {focusOn ? "×" : "+"}
            </span>
          </button>
          <span className="font-mono text-[11.5px] text-content-muted">
            {focusOn
              ? `${rows.length} of ${ads.length} creatives`
              : "filter off — showing everything"}
          </span>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <label key={f.key} className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
              {f.label}
            </span>
            <select
              value={selected[f.key] ?? ALL}
              onChange={(e) =>
                setSelected((s) => ({ ...s, [f.key]: e.target.value }))
              }
              className="rounded-control border border-hairline-strong bg-paper/70 px-2.5 py-1.5 text-[13px] text-content-body backdrop-blur-[8px] transition-colors duration-fast hover:border-accent/40"
            >
              <option value={ALL}>All</option>
              {options[f.key]?.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ))}
        {rows.length !== ads.length && !focus && (
          <span className="font-mono text-[11.5px] text-content-muted">
            {rows.length} of {ads.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[13.5px] text-content-muted">
          No creative matches this filter.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-4">
          {rows.map((ad, i) => (
            <Tile
              key={ad.adId}
              ad={ad}
              rank={i + 1}
              maxSpend={maxSpend}
              currency={currency}
              killRoas={killRoas}
              targetRoas={targetRoas}
              directionalPurchases={directionalPurchases}
              onOpen={() => setOpen(ad)}
            />
          ))}
        </div>
      )}

      {open && (
        <AdDetail
          ad={open}
          currency={currency}
          clientId={clientId}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function Tile({
  ad,
  rank,
  maxSpend,
  currency,
  killRoas,
  targetRoas,
  directionalPurchases,
  onOpen,
}: {
  ad: AdView;
  rank: number;
  maxSpend: number;
  currency: string;
  killRoas: number;
  targetRoas: number;
  directionalPurchases: number;
  onOpen: () => void;
}) {
  // A row the engine cannot read gets a grey bar and a muted figure. Colouring
  // a three-purchase ad green would be the single most misleading pixel here.
  const readable = ad.purchases >= directionalPurchases;
  const tone = !readable
    ? "muted"
    : ad.roas !== null && ad.roas >= targetRoas
      ? "accent"
      : ad.roas !== null && ad.roas < killRoas
        ? "negative"
        : "neutral";

  const roasColour = !readable
    ? "text-content-muted"
    : ad.roas !== null && ad.roas >= targetRoas
      ? "text-positive"
      : ad.roas !== null && ad.roas < killRoas
        ? "text-negative"
        : "text-content-strong";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${ad.adName}`}
      className="glass glass-lift flex cursor-pointer flex-col overflow-hidden"
    >
      {/* The tile stays a uniform 4:5 — a wall of mixed shapes is unreadable,
          and the grid's whole job is comparison. What changed is `contain`
          rather than `cover` inside it: a 9:16 creative now sits letterboxed
          and entire, instead of cropped to the middle 72% of itself. */}
      <div className="relative aspect-[4/5] border-b border-hairline bg-gray-100/70">
        <Thumb ad={ad} />
        <span className="absolute left-2 top-2 rounded-xs bg-ink-950/70 px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.09em] text-white">
          {ad.format ?? "—"}
        </span>
        <span className="absolute right-2 top-2 rounded-xs border border-hairline bg-paper px-1.5 py-px font-mono text-[10px] text-content-muted">
          #{rank}
        </span>
        {ad.bodyHook && (
          <span className="absolute bottom-2 left-2 rounded-xs border border-hairline bg-paper px-1.5 py-px font-mono text-[9.5px] tracking-[0.06em] text-content-muted">
            {ad.bodyHook}
          </span>
        )}
        {/* Video reads as video at a glance, whether or not the file has been
            mirrored yet — format is one of the few things Meta tells us before
            the asset job has ever run. */}
        {ad.format === "DYN" && (
          <span
            aria-hidden="true"
            className="absolute inset-0 m-auto flex h-9 w-9 items-center justify-center rounded-full bg-paper/90 shadow-sm"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" className="ml-0.5 text-content-strong">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        )}
      </div>

      <div className="relative flex flex-1 flex-col gap-2.5 p-3">
        <div className="break-words text-[12.5px] font-medium leading-[1.35] text-content-strong">
          {ad.adName}
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[15px] font-medium tabular text-content-strong">
            {money(ad.spend, currency)}
          </span>
          <span className="font-mono text-[11px] text-content-muted">
            {pct(ad.spendShare)}
          </span>
        </div>

        <SpendBar fraction={ad.spend / maxSpend} tone={tone} />

        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[13px] font-medium tabular ${roasColour}`}>
            ROAS {roas(ad.roas)}
          </span>
          <ConfidenceChip level={ad.confidence} />
        </div>

        {/* Attention metrics for video, conversion counts for a static. A
            static reports no hook rate at all, and showing an empty one would
            imply the data is missing rather than nonexistent. */}
        <div className="flex flex-wrap gap-2.5 font-mono text-[10.5px] text-content-muted">
          {ad.format === "DYN" ? (
            <>
              <span>hook {ratePct(ad.hookRate)}</span>
              <span>hold {ratePct(ad.holdRate)}</span>
              <span>ctr {ratePct(ad.ctr)}</span>
            </>
          ) : (
            <>
              <span>ctr {ratePct(ad.ctr)}</span>
              <span>{ad.purchases} purchases</span>
            </>
          )}
        </div>

        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          <Tag value={ad.persona} missing="persona" />
          <Tag value={ad.angle} missing="angle" />
          <Tag value={ad.offer} missing="offer" />
          {ad.method && <Tag value={ad.method} missing="made by" tone="made" />}
          {ad.stage && <Tag value={ad.stage} missing="stage" />}
          {ad.market && <Tag value={ad.market} missing="market" />}
        </div>
      </div>
    </article>
  );
}

/**
 * The tile image.
 *
 * ── Why a drawn placeholder and not a broken-image icon ────────────────────
 * Nothing is mirrored until the GCS job has run, and a real account passes
 * through that state for days: the job may not have run, the video permission
 * may be missing, or the ad may predate the bucket. A grey box with a broken
 * icon reads as a failure; a tinted placeholder reads as "not here yet", which
 * is what it is. The tint is by format, so a wall of unmirrored creative still
 * shows you the shape of the account — how much of it is video, how much
 * static — which is worth something on its own.
 */
function Thumb({ ad }: { ad: AdView }) {
  if (ad.thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the URL is a
      // short-lived signed GCS link, so next/image's optimiser would cache a
      // URL that expires within the hour and serve a 403 afterwards.
      <img
        src={ad.thumbUrl}
        alt=""
        loading="lazy"
        className="h-full w-full object-contain"
      />
    );
  }

  const tint =
    ad.format === "DYN"
      ? { from: "var(--info)", to: "var(--info)" }
      : ad.format === "CAR"
        ? { from: "var(--warning)", to: "var(--warning)" }
        : { from: "var(--growth-500)", to: "var(--growth-400)" };

  // Deterministic from the ad id, so a tile keeps its shape between renders.
  const seed = [...ad.adId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const cx = 60 + (seed % 70);
  const cy = 92 + (seed % 40);
  const r = 34 + (seed % 22);
  const w1 = 86 + (seed % 60);
  const w2 = 52 + (seed % 44);
  const id = `t${ad.adId}`;

  return (
    <svg
      viewBox="0 0 200 250"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      role="img"
      aria-label={`No mirrored asset, ${ad.format ?? "unknown format"}`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={tint.from} stopOpacity="0.2" />
          <stop offset="1" stopColor={tint.to} stopOpacity="0.07" />
        </linearGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${id})`} />
      <circle cx={cx} cy={cy} r={r} fill={tint.from} opacity="0.14" />
      <rect x="26" y="180" width={w1} height="7" rx="3.5" fill={tint.from} opacity="0.26" />
      <rect x="26" y="195" width={w2} height="7" rx="3.5" fill={tint.from} opacity="0.16" />
      <rect x="26" y="210" width="40" height="7" rx="3.5" fill={tint.from} opacity="0.1" />
    </svg>
  );
}
