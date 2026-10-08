/**
 * The condition tiles of the Forecast Home, after Apple Weather's grid (UV
 * index, wind, humidity): small square readings of the agency's own weather.
 *
 * Meta spend pace   ad_spend month rows of mart.plan_pacing (Goals status).
 * Creative queue    mart.mart_velocity_queue, ready plus in production.
 * Unmapped ads      mart.mart_creative_unmapped, the Creative page's queue.
 * Data freshness    ops.v_feed_health, the hourly feed check.
 * Retainers         ref.contracts, else ClickUp Retainer CZK (via getHomeData).
 * Received          No source: payments are in Pohoda, which is not connected.
 *
 * Each tile is n/a with its source named when the source cannot answer.
 */

import type { ReactNode } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { toneVars } from "@/lib/plan/health";
import type { ClientHealth, HomeSummary } from "@/lib/home/types";
import type { FeedTile, QueueTile, SpendTile, UnmappedTile } from "@/lib/home/weather/model";
import { TileGlyph, type TileIcon } from "./Glyphs";

const MAX_LINES = 4;

function Tile({
  icon,
  title,
  tip,
  value,
  muted,
  caption,
  children,
  href,
}: {
  icon: TileIcon;
  title: string;
  tip: string;
  value: string;
  muted?: boolean;
  caption?: ReactNode;
  children?: ReactNode;
  href?: string;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-1 rounded-card min-[420px]:min-h-[188px] border border-hairline bg-surface-card p-4 shadow-sm sm:p-[18px]"
    >
      <header className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-content-muted">
        <TileGlyph icon={icon} />
        {href ? (
          <AppLink href={href} className="truncate underline-offset-2 hover:text-content-strong hover:underline">
            {title}
          </AppLink>
        ) : (
          <span className="truncate">{title}</span>
        )}
        <InfoTip text={tip} label={`About ${title}`} />
      </header>
      <span
        className={`mt-1 break-words text-[26px] font-bold leading-[1.1] tracking-heading tabular sm:text-[30px] ${
          muted ? "text-content-muted" : "text-content-strong"
        }`}
      >
        {value}
      </span>
      {caption && <span className="text-[13px] font-medium leading-[1.35] text-content-strong">{caption}</span>}
      {children && <div className="mt-auto pt-2">{children}</div>}
    </section>
  );
}

function Lines({ items }: { items: Array<{ key: string; name: string; value: ReactNode }> }) {
  if (!items.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] leading-[1.3]">
      {items.slice(0, MAX_LINES).map((i) => (
        <li key={i.key} className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-content-muted">{i.name}</span>
          <span className="flex-none font-semibold tabular text-content-strong">{i.value}</span>
        </li>
      ))}
      {items.length > MAX_LINES && (
        <li className="text-content-muted">+{items.length - MAX_LINES} more</li>
      )}
    </ul>
  );
}

/** Pace on a 0 to 200% track, a tick at plan: the UV-index bar of the grid. */
function PaceBar({ pct, colour }: { pct: number | null; colour: string }) {
  const at = pct === null ? null : (Math.max(0, Math.min(200, pct)) / 200) * 100;
  return (
    <span aria-hidden="true" className="relative block h-[5px] w-[52px] flex-none rounded-full bg-[rgba(17,24,28,0.08)]">
      <span className="absolute left-1/2 top-[-3px] h-[11px] w-[1.5px] -translate-x-1/2 bg-content-strong/50" />
      {at !== null && (
        <span
          className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
          style={{ left: `${at}%`, background: colour }}
        />
      )}
    </span>
  );
}

function pct0(p: number | null): string {
  return formatPercent(p === null ? null : p / 100, { decimals: 0 });
}

function SpendPace({ spend }: { spend: SpendTile }) {
  return (
    <Tile
      icon="gauge"
      title="Meta spend pace"
      tip={
        spend.note ??
        `Ad spend against the Goals plan to date, summed over clients with an ad spend target${
          spend.currency ? ` in ${spend.currency}` : ""
        }. Over plan is amber, under plan blue.`
      }
      value={pct0(spend.combinedPct)}
      muted={spend.combinedPct === null}
      caption={spend.combinedPct === null ? undefined : "of plan to date"}
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px] leading-[1.3]">
        {spend.lines.slice(0, MAX_LINES).map((l) => {
          const tone = toneVars(l.tone);
          return (
            <li key={l.clientId} className="flex min-w-0 items-center gap-2" title={l.statusLabel}>
              <span className="min-w-0 flex-1 truncate text-content-muted">{l.name}</span>
              <PaceBar pct={l.pacePct} colour={tone.graphic} />
              <span className="w-[2.6rem] flex-none text-right font-semibold tabular" style={{ color: tone.text }}>
                {pct0(l.pacePct)}
              </span>
            </li>
          );
        })}
      </ul>
    </Tile>
  );
}

function CreativeQueue({ queue }: { queue: QueueTile }) {
  return (
    <Tile
      icon="stack"
      title="Creative queue"
      href="/creative/velocity"
      tip={queue.note ?? "ClickUp ad tasks ready to launch or in production (mart_velocity_queue). Briefing is counted apart."}
      value={queue.queued === null ? NO_VALUE : formatNumber(queue.queued)}
      muted={queue.queued === null}
      caption={queue.queued === null ? undefined : `ready or in production · ${formatNumber(queue.briefing)} briefing`}
    >
      <Lines
        items={queue.lines.map((l) => ({
          key: l.clientId,
          name: l.name,
          value: `${l.ready} ready · ${l.inWorks} in works`,
        }))}
      />
    </Tile>
  );
}

function Unmapped({ unmapped }: { unmapped: UnmappedTile }) {
  return (
    <Tile
      icon="link"
      title="Unmapped ads"
      href="/creative"
      tip={unmapped.note ?? "Meta ads with no matching ClickUp brief (mart_creative_unmapped), ads from before a client's ClickUp pipeline left out."}
      value={unmapped.total === null ? NO_VALUE : formatNumber(unmapped.total)}
      muted={unmapped.total === null}
      caption={unmapped.total === null ? undefined : unmapped.total === 0 ? "every ad has a brief" : "ads with no brief"}
    >
      <Lines items={unmapped.lines.map((l) => ({ key: l.clientId, name: l.name, value: formatNumber(l.ads) }))} />
    </Tile>
  );
}

function hours(h: number | null): string {
  if (h === null) return NO_VALUE;
  return h >= 48 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
}

function feedName(key: string): string {
  return key.replace(/_/g, " ");
}

function Freshness({ feeds }: { feeds: FeedTile }) {
  const allOk = feeds.total !== null && feeds.ok === feeds.total;
  return (
    <Tile
      icon="refresh"
      title="Data freshness"
      href="/health"
      tip={feeds.note ?? "Feeds within their staleness limit in the hourly check (ops.v_feed_health)."}
      value={feeds.total === null ? NO_VALUE : `${feeds.ok} of ${feeds.total}`}
      muted={feeds.total === null}
      caption={
        feeds.total === null ? undefined : allOk ? (
          <span style={{ color: toneVars("positive").text }}>every feed current</span>
        ) : (
          <span style={{ color: toneVars("negative").text }}>
            {feeds.issues.length} {feeds.issues.length === 1 ? "feed" : "feeds"} late
          </span>
        )
      }
    >
      <Lines
        items={feeds.issues.map((f) => ({
          key: `${f.clientId}-${f.feed}`,
          name: `${f.name} · ${feedName(f.feed)}`,
          value: f.status === "never" ? "never" : hours(f.stalenessHours),
        }))}
      />
    </Tile>
  );
}

function Retainers({ summary, clients }: { summary: HomeSummary; clients: ClientHealth[] }) {
  const paying = clients
    .filter((c) => c.retainer.value !== null)
    .sort((a, b) => (b.retainer.value ?? 0) - (a.retainer.value ?? 0));
  return (
    <Tile
      icon="banknote"
      title="Retainers"
      tip={summary.retainersNote ?? "Monthly retainers agreed: ref.contracts, else ClickUp Retainer CZK. Agreed, not received."}
      value={formatMoney(summary.retainersCzk, "CZK")}
      muted={summary.retainersCzk === null}
      caption={summary.retainersCzk === null ? undefined : `a month · ${paying.length} ${paying.length === 1 ? "client" : "clients"}`}
    >
      <Lines
        items={paying.map((c) => ({
          key: c.key,
          name: c.name,
          value: formatMoney(c.retainer.value, "CZK", { compact: true }),
        }))}
      />
    </Tile>
  );
}

function Received({ clients }: { clients: ClientHealth[] }) {
  const invoiced = clients.filter((c) => c.lastInvoice);
  return (
    <Tile
      icon="tray"
      title="Received"
      tip="No payments source. Payments are booked in Pohoda, which is not connected. Below: the last invoice per client in the ClickUp Invoice Tracker."
      value={NO_VALUE}
      muted
      caption="Pohoda not connected"
    >
      {invoiced.length > 0 && (
        <>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-content-muted">
            Last invoiced
          </span>
          <Lines
            items={invoiced.map((c) => ({
              key: c.key,
              name: `${c.name} · ${c.lastInvoice?.period}`,
              value: formatMoney(c.lastInvoice?.amountCzk ?? null, "CZK", { compact: true }),
            }))}
          />
        </>
      )}
    </Tile>
  );
}

export function ConditionTiles({
  spend,
  queue,
  unmapped,
  feeds,
  summary,
  clients,
}: {
  spend: SpendTile;
  queue: QueueTile;
  unmapped: UnmappedTile;
  feeds: FeedTile;
  summary: HomeSummary;
  clients: ClientHealth[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3.5 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <SpendPace spend={spend} />
      <CreativeQueue queue={queue} />
      <Unmapped unmapped={unmapped} />
      <Freshness feeds={feeds} />
      <Retainers summary={summary} clients={clients} />
      <Received clients={clients} />
    </div>
  );
}
