/**
 * Demo data for Paid > Meta.
 *
 * Shapes match the real query module row for row, so the tab renders the same
 * code path for the demo client as for a live one. Every row is a pure function
 * of its date and campaign, so every block on the page agrees with the others.
 *
 * Deliberately includes what a real account has: campaigns the naming rules
 * cannot classify, a small campaign that trips the low volume rule, ads with no
 * video, and no outbound clicks (not ingested live yet).
 *
 * None of this is anyone's data.
 */

import type { DateRange, ResolvedPeriod } from "@/lib/period";
import type { FunnelStage } from "@/lib/paid/types";
import type { MetaRow, PeriodTag } from "@/components/paid/meta/aggregate";
import type { MetaAdRow, MetaAdsetRow, MetaVideoRow } from "@/lib/queries/paidMeta";
import { days } from "./business";
import { AD_NAMES, CAMPAIGNS } from "./catalog";
import { jitter } from "./random";

const r0 = (n: number): number => Math.round(n);
const r2 = (n: number): number => Math.round(n * 100) / 100;

interface DemoCampaign {
  id: string;
  name: string;
  stage: FunnelStage;
  market: string | null;
  /** Share of daily Meta spend. Sums to 1. */
  weight: number;
  cpm: number;
  linkCtr: number;
  roasFactor: number;
}

function stageOf(name: string): FunnelStage {
  const n = name.toLowerCase();
  if (n.includes("retargeting")) return "retargeting";
  if (n.includes("prospecting")) return "prospecting";
  return "unclassified";
}

const WEIGHTS = [0.31, 0.27, 0.17, 0.12, 0.1, 0.03];

const DEMO_CAMPAIGNS: DemoCampaign[] = CAMPAIGNS.map((name, i) => ({
  id: `demo-c${i + 1}`,
  name,
  stage: stageOf(name),
  market: name.split(" I ")[0].trim().toUpperCase() || null,
  weight: WEIGHTS[i] ?? 0.02,
  cpm: 11.5 + i * 1.7,
  linkCtr: 0.0115 + (i % 3) * 0.0042,
  roasFactor: [1.18, 0.96, 1.05, 1.42, 0.78, 0.9][i] ?? 1,
}));

function tagOf(date: string, current: DateRange): PeriodTag {
  return date >= current.from && date <= current.to ? "current" : "comparison";
}

function rowsFor(range: DateRange, tag: PeriodTag): MetaRow[] {
  const out: MetaRow[] = [];
  for (const d of days(range.from, range.to)) {
    for (const c of DEMO_CAMPAIGNS) {
      const key = `${c.id}:${d.date}`;
      const spend = r2(d.metaSpend * c.weight * jitter(`mspend:${key}`, 0.22));
      if (spend <= 0) continue;
      const impressions = r0((spend / (c.cpm * jitter(`mcpm:${key}`, 0.08))) * 1000);
      const reach = r0(impressions / (1.22 + 0.2 * jitter(`mfreq:${key}`, 0.5)));
      const linkClicks = r0(impressions * c.linkCtr * jitter(`mctr:${key}`, 0.12));
      const lpv = r0(linkClicks * 0.84);
      const viewContent = r0(lpv * 0.78 * jitter(`mvc:${key}`, 0.1));
      const addToCart = r0(lpv * 0.15 * jitter(`matc:${key}`, 0.14));
      const initiateCheckout = r0(addToCart * 0.66);
      const addPaymentInfo = r0(initiateCheckout * 0.72);
      const purchases = r0(addPaymentInfo * 0.56 * jitter(`mpur:${key}`, 0.2));
      const revenue = r2(purchases * 78 * c.roasFactor * jitter(`maov:${key}`, 0.12));
      out.push({
        date: d.date,
        period: tag,
        campaignId: c.id,
        campaignName: c.name,
        funnelStage: c.stage,
        market: c.market,
        spend,
        revenue,
        purchases,
        impressions,
        reach,
        addToCart,
        initiateCheckout,
        landingPageViews: lpv,
        linkClicks,
        viewContent,
        addPaymentInfo,
      });
    }
  }
  return out;
}

export function demoMetaRows(period: ResolvedPeriod): MetaRow[] {
  const rows = rowsFor(period.current, "current");
  if (period.comparison) rows.push(...rowsFor(period.comparison, "comparison"));
  return rows.map((r) => ({ ...r, period: tagOf(r.date, period.current) }));
}

function campaignTotals(range: DateRange, id: string) {
  const rows = rowsFor(range, "current").filter((r) => r.campaignId === id);
  const sum = (f: (r: MetaRow) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  return {
    spend: sum((r) => r.spend),
    revenue: sum((r) => r.revenue),
    purchases: sum((r) => r.purchases),
    impressions: sum((r) => r.impressions),
    linkClicks: sum((r) => r.linkClicks),
    addToCart: sum((r) => r.addToCart),
  };
}

/** Video ads carry about 58 percent of a campaign's impressions; the last campaign has none. */
function videoShare(index: number): number {
  return index === DEMO_CAMPAIGNS.length - 1 ? 0 : 0.58;
}

function videoFor(range: DateRange, c: DemoCampaign, index: number) {
  const t = campaignTotals(range, c.id);
  const share = videoShare(index);
  if (share === 0 || t.impressions === 0) return { plays: null, thruplays: null, impressions: null };
  const impressions = r0(t.impressions * share);
  const plays = r0(impressions * (0.29 + 0.03 * jitter(`hook:${c.id}`, 0.5)));
  return { plays, thruplays: r0(plays * 0.3), impressions };
}

export function demoMetaVideo(period: ResolvedPeriod): MetaVideoRow[] {
  return DEMO_CAMPAIGNS.map((c, i) => ({
    campaignId: c.id,
    current: videoFor(period.current, c, i),
    previous: period.comparison ? videoFor(period.comparison, c, i) : null,
  }));
}

const ADSET_NAMES = ["Broad I 25-54", "Interest Stack I Wellness", "LAL 2% I Purchasers"];
const ADSET_WEIGHTS = [0.52, 0.31, 0.17];

export function demoMetaAdsets(range: DateRange, campaignId: string): MetaAdsetRow[] {
  const c = DEMO_CAMPAIGNS.find((x) => x.id === campaignId);
  if (!c) return [];
  const t = campaignTotals(range, c.id);
  if (t.spend === 0) return [];
  return ADSET_NAMES.map((name, j) => {
    const w = ADSET_WEIGHTS[j] * jitter(`adsetw:${c.id}:${j}`, 0.1);
    const ef = jitter(`adsete:${c.id}:${j}`, 0.25);
    return {
      adsetId: `${c.id}-s${j + 1}`,
      name,
      spend: r2(t.spend * w),
      revenue: r2(t.revenue * w * ef),
      purchases: r0(t.purchases * w * ef),
      impressions: r0(t.impressions * w * jitter(`adsetimp:${c.id}:${j}`, 0.2)),
      linkClicks: r0(t.linkClicks * w * jitter(`adsetlc:${c.id}:${j}`, 0.25)),
      addToCart: r0(t.addToCart * w),
    };
  }).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

export function demoMetaAds(range: DateRange, campaignId: string, adsetId?: string): MetaAdRow[] {
  const c = DEMO_CAMPAIGNS.find((x) => x.id === campaignId);
  if (!c) return [];
  const index = DEMO_CAMPAIGNS.indexOf(c);
  const t = campaignTotals(range, c.id);
  if (t.spend === 0) return [];
  const hasVideo = videoShare(index) > 0;

  const ads: MetaAdRow[] = [];
  for (let k = 0; k < 6; k++) {
    const w = Math.pow(0.66, k) * jitter(`adw:${c.id}:${k}`, 0.2);
    const ef = jitter(`ade:${c.id}:${k}`, 0.4);
    const impressions = r0(t.impressions * w * 0.3 * jitter(`adimp:${c.id}:${k}`, 0.2));
    const isVideo = hasVideo && k % 2 === 0;
    const plays = isVideo ? r0(impressions * (0.26 + 0.1 * jitter(`adh:${c.id}:${k}`, 0.5))) : null;
    ads.push({
      adId: `${c.id}-a${k + 1}`,
      name: AD_NAMES[(index * 3 + k) % AD_NAMES.length],
      adsetId: `${c.id}-s${(k % 3) + 1}`,
      spend: r2(t.spend * w * 0.3),
      revenue: r2(t.revenue * w * 0.3 * ef),
      purchases: r0(t.purchases * w * 0.3 * ef),
      impressions,
      linkClicks: r0(t.linkClicks * w * 0.3 * jitter(`adlc:${c.id}:${k}`, 0.25)),
      outboundClicks: null,
      videoPlays: plays,
      videoThruplays: plays === null ? null : r0(plays * 0.3),
    });
  }
  return ads
    .filter((a) => !adsetId || a.adsetId === adsetId)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 20);
}
