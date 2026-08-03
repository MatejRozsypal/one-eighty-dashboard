/**
 * Demo paid media and email.
 *
 * Spend and attributed revenue come from the same daily spine as the P&L, so
 * the Paid page's Meta total is the same number the snapshot nets out of CM2.
 *
 * Platform-attributed revenue is deliberately *higher* than the warehouse's —
 * Meta claims a purchase it merely showed an ad before, and the real dashboard
 * exists partly to say so. A demo where the two agreed perfectly would quietly
 * undersell the point the product is making.
 */

import type { DateRange } from "@/lib/period";
import type { AdRow, ChannelTotal, MetaTotals } from "@/lib/queries/paid";
import type {
  CampaignRow,
  EmailSummary,
  FlowRow,
  FlowSummary,
} from "@/lib/queries/email";
import { addDays, dataThrough, days, type DemoDay } from "./business";
import { AD_NAMES, CAMPAIGNS, EMAIL_CAMPAIGNS, EMAIL_FLOWS } from "./catalog";
import { jitter, unit } from "./random";

const sum = (rows: DemoDay[], f: (d: DemoDay) => number): number =>
  rows.reduce((a, d) => a + f(d), 0);
const div = (a: number, b: number): number | null => (b ? a / b : null);
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** How much more revenue Meta claims than the warehouse credits it. */
const PLATFORM_ATTRIBUTION_UPLIFT = 1.34;

// ── Meta ───────────────────────────────────────────────────────────────────

export function demoMetaTotals(range: DateRange): MetaTotals {
  const rows = days(range.from, range.to);
  if (rows.length === 0) {
    return {
      spend: null, revenue: null, purchases: null, impressions: null,
      reach: null, clicks: null, linkClicks: null, landingPageViews: null,
      addToCart: null, initiateCheckout: null, videoViews: null,
      ctr: null, cpc: null, cpm: null, roas: null, cpa: null, frequency: null,
    };
  }

  const spend = r2(sum(rows, (d) => d.metaSpend));
  const metaShare = div(sum(rows, (d) => d.metaSpend), sum(rows, (d) => d.paidSpend)) ?? 0.71;
  const revenue = r2(
    sum(rows, (d) => d.newCustomerRevenue) * metaShare * PLATFORM_ATTRIBUTION_UPLIFT
  );
  // The funnel is built downward, each step a fixed rate off the one above, so
  // impressions > reach > clicks > link clicks > landing views > add-to-cart >
  // checkout always holds no matter how the day's spend lands.
  //
  // Impressions come from a CPM rather than a made-up multiplier, because CPM is
  // the number a media buyer will check first and a wrong one is obvious.
  const CPM = 14.2;
  const impressions = Math.round((spend / CPM) * 1000);
  const reach = Math.round(impressions / 1.42);
  const clicks = Math.round(impressions * 0.019);
  const linkClicks = Math.round(clicks * 0.64);
  const landingPageViews = Math.round(linkClicks * 0.85);
  const addToCart = Math.round(landingPageViews * 0.155);
  const initiateCheckout = Math.round(addToCart * 0.68);
  const videoViews = Math.round(impressions * 0.284);

  // Purchases follow the warehouse's new customers, but can never exceed the
  // checkouts above them. The clamp is what keeps the funnel honest: Meta's
  // attributed purchases include view-through conversions that never touched
  // the landing page, so the two figures are related but not the same chain.
  const purchases = Math.min(
    Math.round(sum(rows, (d) => d.newCustomerOrders) * metaShare * 1.19),
    Math.round(initiateCheckout * 0.86)
  );

  return {
    spend,
    revenue,
    purchases,
    impressions,
    reach,
    clicks,
    linkClicks,
    landingPageViews,
    addToCart,
    initiateCheckout,
    videoViews,
    // Every rate recomputed from the sums, never averaged across days.
    ctr: div(clicks, impressions),
    cpc: div(spend, clicks),
    cpm: div(spend * 1000, impressions),
    roas: div(revenue, spend),
    cpa: div(spend, purchases),
    frequency: div(impressions, reach),
  };
}

export function demoTopAds(range: DateRange, limit: number): AdRow[] {
  const totals = demoMetaTotals(range);
  const spendTotal = totals.spend ?? 0;
  if (spendTotal === 0) return [];

  // Spend concentrates: a couple of ads carry the account, a long tail spends
  // little. A flat split would make the table pointless to sort.
  const weights = AD_NAMES.map((name, i) => ({
    name,
    weight: Math.pow(0.72, i) * jitter(`adweight:${name}:${range.from}`, 0.28),
  }));
  const weightSum = weights.reduce((a, w) => a + w.weight, 0);

  return weights
    .map(({ name, weight }, i) => {
      const share = weight / weightSum;
      const spend = r2(spendTotal * share);
      // Efficiency varies per ad — that variance is the reason to look at the
      // table at all. One ad is deliberately below break-even.
      const roasFactor = jitter(`adroas:${name}:${range.from}`, 0.62);
      const revenue = r2(spend * (totals.roas ?? 4) * roasFactor);
      const purchases = Math.max(1, Math.round(revenue / 78));
      const impressions = Math.round(spend * 61.4 * jitter(`adimp:${name}`, 0.2));
      const reach = Math.round(impressions / (1.2 + unit(`adfreq:${name}`) * 0.9));
      const clicks = Math.round(impressions * (0.012 + unit(`adctr:${name}`) * 0.032));

      return {
        adName: name,
        campaignName: CAMPAIGNS[i % CAMPAIGNS.length],
        spend,
        revenue,
        roas: div(revenue, spend),
        reach,
        ctr: div(clicks, impressions),
        cpc: div(spend, clicks),
        frequency: div(impressions, reach),
        purchases,
        cpa: div(spend, purchases),
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, limit);
}

export function demoChannelTotals(
  range: DateRange,
  hasGoogle: boolean
): ChannelTotal[] {
  const rows = days(range.from, range.to);
  const newRevenue = sum(rows, (d) => d.newCustomerRevenue);
  const paid = sum(rows, (d) => d.paidSpend);

  const channels: ChannelTotal[] = [
    {
      channel: "meta",
      spend: r2(sum(rows, (d) => d.metaSpend)),
      revenue: r2(newRevenue * (div(sum(rows, (d) => d.metaSpend), paid) ?? 0.71) * PLATFORM_ATTRIBUTION_UPLIFT),
      purchases: Math.round(sum(rows, (d) => d.newCustomerOrders) * 0.71 * 1.19),
      connected: true,
    },
  ];

  if (hasGoogle) {
    const gSpend = sum(rows, (d) => d.googleSpend);
    channels.push({
      channel: "google",
      spend: r2(gSpend),
      // Google's search traffic converts better and it over-claims less.
      revenue: r2(newRevenue * (div(gSpend, paid) ?? 0.29) * 1.18),
      purchases: Math.round(sum(rows, (d) => d.newCustomerOrders) * 0.29 * 1.06),
      connected: true,
    });
  }

  return channels;
}

// ── Email ──────────────────────────────────────────────────────────────────

/** Share of total revenue the brand attributes to email. */
const EMAIL_REVENUE_SHARE = 0.243;
/** …of which flows earn the larger part, as they should. */
const FLOW_SHARE_OF_EMAIL = 0.61;

export function demoEmailSummary(
  range: DateRange,
  limit: number
): EmailSummary | null {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return null;

  const revenue = sum(rows, (d) => d.revenue);
  const campaignRevenue = revenue * EMAIL_REVENUE_SHARE * (1 - FLOW_SHARE_OF_EMAIL);

  // Roughly one send every four days across the range.
  const sendCount = Math.max(1, Math.min(limit, Math.floor(rows.length / 4)));
  const weights = Array.from({ length: sendCount }, (_, i) =>
    jitter(`camp:w:${range.from}:${i}`, 0.55)
  );
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const campaigns: CampaignRow[] = weights.map((w, i) => {
    const name = EMAIL_CAMPAIGNS[i % EMAIL_CAMPAIGNS.length];
    const key = `camp:${range.from}:${i}`;
    const sendDate = addDays(range.to, -Math.floor((i * rows.length) / sendCount));

    const sent = Math.round(18400 * jitter(`${key}:sent`, 0.22));
    const delivered = Math.round(sent * (0.972 + unit(`${key}:del`) * 0.02));
    const uniqueOpens = Math.round(delivered * (0.36 + unit(`${key}:open`) * 0.19));
    const uniqueClicks = Math.round(uniqueOpens * (0.07 + unit(`${key}:click`) * 0.06));
    const rev = r2(campaignRevenue * (w / weightSum));
    const uniqueOrders = Math.max(1, Math.round(rev / 82));

    return {
      campaignName: name,
      sendDate,
      sent,
      delivered,
      uniqueOpens,
      uniqueClicks,
      uniqueOrders,
      revenue: rev,
      openRate: div(uniqueOpens, delivered),
      clickRate: div(uniqueClicks, delivered),
      orderRate: div(uniqueOrders, delivered),
      aov: div(rev, uniqueOrders),
      revenuePerRecipient: div(rev, delivered),
    };
  });

  const totalSent = campaigns.reduce((a, c) => a + (c.sent ?? 0), 0);
  const totalDelivered = campaigns.reduce((a, c) => a + (c.delivered ?? 0), 0);
  const totalOpens = campaigns.reduce((a, c) => a + (c.uniqueOpens ?? 0), 0);
  const totalClicks = campaigns.reduce((a, c) => a + (c.uniqueClicks ?? 0), 0);
  const totalRevenue = r2(campaigns.reduce((a, c) => a + (c.revenue ?? 0), 0));

  return {
    campaigns,
    totalRevenue,
    totalSent,
    // Recomputed from the sums — never a mean of the per-campaign rates.
    avgOpenRate: div(totalOpens, totalDelivered),
    avgClickRate: div(totalClicks, totalDelivered),
    revenuePerRecipient: div(totalRevenue, totalDelivered),
  };
}

/**
 * Flows are cumulative and not range-bound, matching the real page: Klaviyo's
 * flow series is a lifetime snapshot, so a date filter would misrepresent it.
 */
export function demoFlows(range: DateRange): FlowSummary | null {
  // Range-filtered like the real path now is — the demo has a daily spine, so
  // it can answer for a period rather than reporting life-to-date.
  const rows = days(range.from, range.to);
  const revenue = sum(rows, (d) => d.revenue);
  const flowRevenue = revenue * EMAIL_REVENUE_SHARE * FLOW_SHARE_OF_EMAIL;

  const flows: FlowRow[] = EMAIL_FLOWS.map((f, i) => {
    const key = `flow:${f.name}`;
    const rev = r2(flowRevenue * f.weight);
    const emailsSent = Math.round((rev / 1.94) * jitter(`${key}:sent`, 0.2));
    const delivered = Math.round(emailsSent * 0.981);
    // Triggered mail is opened far more than a broadcast — the gap is the point.
    const uniqueOpens = Math.round(delivered * (0.44 + unit(`${key}:open`) * 0.22));
    const uniqueClicks = Math.round(uniqueOpens * (0.11 + unit(`${key}:click`) * 0.09));
    const conversions = Math.max(1, Math.round(rev / 86));

    return {
      flowId: `demo-flow-${i + 1}`,
      flowName: f.name,
      platform: "klaviyo",
      status: i === EMAIL_FLOWS.length - 1 ? "draft" : "live",
      emailsSent,
      delivered,
      uniqueOpens,
      uniqueClicks,
      openRate: div(uniqueOpens, delivered),
      clickRate: div(uniqueClicks, delivered),
      conversions,
      conversionRate: div(conversions, delivered),
      revenue: rev,
      revenuePerEmail: div(rev, emailsSent),
    };
  }).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));

  const totalDelivered = flows.reduce((a, f) => a + (f.delivered ?? 0), 0);
  const totalOpens = flows.reduce((a, f) => a + (f.uniqueOpens ?? 0), 0);
  const totalClicks = flows.reduce((a, f) => a + (f.uniqueClicks ?? 0), 0);

  return {
    flows,
    totalRevenue: r2(flows.reduce((a, f) => a + (f.revenue ?? 0), 0)),
    totalConversions: flows.reduce((a, f) => a + (f.conversions ?? 0), 0),
    totalEmails: flows.reduce((a, f) => a + (f.emailsSent ?? 0), 0),
    openRate: div(totalOpens, totalDelivered),
    clickRate: div(totalClicks, totalDelivered),
    snapshotDate: dataThrough(),
    coverage: {
      requestedFrom: range.from,
      requestedTo: range.to,
      lastAvailable: dataThrough(),
      covered: true,
    },
  };
}
