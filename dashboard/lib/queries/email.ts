/**
 * Email — campaign performance.
 *
 * ── Click rate here is not click-to-open ────────────────────────────────────
 * `click_rate_pct` is unique clicks ÷ **delivered**, which is the honest
 * denominator and reads far lower than the CTOR most ESP dashboards show
 * (0.4–1.0% rather than 3–5%). It's labelled explicitly in the UI, because
 * someone used to Klaviyo's number will otherwise think it's broken.
 *
 * ── Open rate is not the story ──────────────────────────────────────────────
 * On Dobias open rates sit flat at 32–35% across every campaign while revenue
 * ranges 2×. So the table leads with revenue per recipient, which is what
 * actually separates a good send from a bad one.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate, safeDiv } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";
import { isDemo } from "@/lib/demo/client";
import { demoEmailSummary, demoFlows } from "@/lib/demo/media";

export interface CampaignRow {
  campaignName: string;
  sendDate: string | null;
  sent: number | null;
  delivered: number | null;
  uniqueOpens: number | null;
  uniqueClicks: number | null;
  uniqueOrders: number | null;
  revenue: number | null;
  openRate: number | null;
  /** unique clicks ÷ delivered — NOT click-to-open. */
  clickRate: number | null;
  orderRate: number | null;
  aov: number | null;
  revenuePerRecipient: number | null;
}

export interface EmailSummary {
  campaigns: CampaignRow[];
  totalRevenue: number | null;
  totalSent: number | null;
  /** Recomputed from sums, never averaged across campaigns. */
  avgOpenRate: number | null;
  avgClickRate: number | null;
  revenuePerRecipient: number | null;
}

export async function getEmailSummary(
  clientId: string,
  range: DateRange,
  limit = 30
): Promise<EmailSummary | null> {
  // Demo client: served from memory, never from the warehouse.
  if (isDemo(clientId)) return demoEmailSummary(range, limit);

  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         campaign_name, send_date, sent, delivered,
         unique_opens, unique_clicks, unique_orders, revenue, aov
       FROM \`${PROJECT_ID}.mart.mart_email_campaign_message_perf\`
       WHERE client_id = @clientId AND send_date BETWEEN @from AND @to
       ORDER BY revenue DESC
       LIMIT @limit`,
      { clientId, from: range.from, to: range.to, limit }
    );

    if (rows.length === 0) return null;

    const campaigns: CampaignRow[] = rows.map((r) => {
      const delivered = num(r.delivered);
      const sent = num(r.sent);
      const revenue = num(r.revenue);
      const uniqueOpens = num(r.unique_opens);
      const uniqueClicks = num(r.unique_clicks);
      const uniqueOrders = num(r.unique_orders);

      return {
        campaignName: String(r.campaign_name ?? "—").trim(),
        sendDate: isoDate(r.send_date as never),
        sent,
        delivered,
        uniqueOpens,
        uniqueClicks,
        uniqueOrders,
        revenue,
        openRate: safeDiv(uniqueOpens, delivered),
        clickRate: safeDiv(uniqueClicks, delivered),
        orderRate: safeDiv(uniqueOrders, delivered),
        aov: num(r.aov),
        revenuePerRecipient: safeDiv(revenue, sent),
      };
    });

    // Period rates come from summed components — averaging per-campaign rates
    // would weight a 400-recipient send the same as a 44,000-recipient one.
    const sum = (pick: (c: CampaignRow) => number | null) =>
      campaigns.reduce((s, c) => s + (pick(c) ?? 0), 0);

    const totalDelivered = sum((c) => c.delivered);
    const totalSent = sum((c) => c.sent);

    return {
      campaigns,
      totalRevenue: sum((c) => c.revenue),
      totalSent,
      avgOpenRate: safeDiv(sum((c) => c.uniqueOpens), totalDelivered),
      avgClickRate: safeDiv(sum((c) => c.uniqueClicks), totalDelivered),
      revenuePerRecipient: safeDiv(sum((c) => c.revenue), totalSent),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

/**
 * Flow performance.
 *
 * ── Lifetime, not the selected range, and that is not a choice ──────────────
 * `mart_email_flow_perf` is the latest snapshot of each flow's **cumulative**
 * counters — Klaviyo and Ecomail both report a flow's totals since it was
 * switched on, not per period. There is no date filter that could be applied
 * here without inventing one.
 *
 * A daily series does exist (`mart_email_flow_daily`) but only for Dobias, and
 * it stops at 2026-06-20 because the backfill in runbook 20 was never wired to
 * an ongoing sync. Driving this page from it would silently show nothing for
 * any recent range, and nothing at all for Manami — which is why the page uses
 * the cumulative view and says so, rather than looking date-aware and being
 * wrong.
 */
export interface FlowRow {
  flowId: string;
  flowName: string;
  platform: string;
  status: string | null;
  emailsSent: number | null;
  delivered: number | null;
  uniqueOpens: number | null;
  uniqueClicks: number | null;
  openRate: number | null;
  clickRate: number | null;
  conversions: number | null;
  conversionRate: number | null;
  revenue: number | null;
  /** Revenue ÷ emails sent — what one more send of this flow is worth. */
  revenuePerEmail: number | null;
}

/** Whether the daily flow series actually reaches the range being asked about. */
export interface FlowCoverage {
  requestedFrom: string;
  requestedTo: string;
  /** Last day the daily series holds for this client. Null when it holds none. */
  lastAvailable: string | null;
  /** True when the series covers the requested range. */
  covered: boolean;
}

export interface FlowSummary {
  flows: FlowRow[];
  totalRevenue: number | null;
  totalConversions: number | null;
  totalEmails: number | null;
  /** Delivery-weighted, never a mean of per-flow rates. */
  openRate: number | null;
  clickRate: number | null;
  snapshotDate: string | null;
  coverage: FlowCoverage;
}

/**
 * Flow performance for the selected range.
 *
 * ── Why this reads the daily series, not the flow snapshot ──────────────────
 * `mart_email_flow_perf` holds each flow's totals *since it was switched on*,
 * snapshotted whenever the sync last ran. Reading it for a page that carries a
 * date range produced the failure this function exists to prevent: Dobias
 * showed $253k of "flow revenue" for 4 Jul – 2 Aug beside $76k of campaign
 * revenue for the same window. Checked against Klaviyo's own flow-values report
 * for those dates, the true figure is **$19.2k** — the dashboard was over by
 * 13x, and had the ranking backwards, because it was comparing two years of
 * flow history against one month of campaigns.
 *
 * It was worse than a stale number. Two of the largest rows were snapshotted on
 * 2026-06-12 and carried `manual` and `draft` status — flows that are not even
 * running contributed roughly $101k of that total.
 *
 * The page used to explain this away with "Klaviyo reports a flow's totals
 * since it was switched on, so there is no period to filter to". That is simply
 * untrue: Klaviyo's flow-series and flow-values-report endpoints are both
 * timeframe-scoped, and `mart_email_flow_daily` already exists to hold the
 * former.
 *
 * ── Why an uncovered range returns nulls rather than a fallback ─────────────
 * The daily series is currently only fed to 2026-06-20 — its n8n node stopped
 * writing while the snapshot node kept running. When the requested range is not
 * covered, this returns the coverage window and no figures, so the page can say
 * what it does not know. Falling back to the snapshot is exactly the bug; and
 * zero would claim the flows earned nothing, which is a different lie.
 */
export async function getFlows(
  clientId: string,
  currency: string,
  range: DateRange
): Promise<FlowSummary | null> {
  // Demo client: served from memory, never from the warehouse.
  if (isDemo(clientId)) return demoFlows(range);

  try {
    const coverageRows = await query<Record<string, unknown>>(
      `SELECT CAST(MAX(metric_date) AS STRING) AS last_available
       FROM \`${PROJECT_ID}.mart.mart_email_flow_daily\`
       WHERE client_id = @clientId AND currency = @currency`,
      { clientId, currency }
    );
    const lastAvailable =
      (coverageRows[0]?.last_available as string | null) ?? null;

    const coverage: FlowCoverage = {
      requestedFrom: range.from,
      requestedTo: range.to,
      lastAvailable,
      // Partial cover is treated as no cover on purpose. A range half-filled
      // with real days and half with silence sums to a number that looks like
      // a period total and is not one.
      covered: lastAvailable !== null && lastAvailable >= range.to,
    };

    if (!coverage.covered) {
      return {
        flows: [],
        totalRevenue: null,
        totalConversions: null,
        totalEmails: null,
        openRate: null,
        clickRate: null,
        snapshotDate: lastAvailable,
        coverage,
      };
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT flow_id,
              ANY_VALUE(flow_name)  AS flow_name,
              ANY_VALUE(status)     AS status,
              SUM(emails_sent)      AS emails_sent,
              SUM(unique_opens)     AS unique_opens,
              SUM(unique_clicks)    AS unique_clicks,
              SUM(conversions)      AS conversions,
              SUM(revenue)          AS revenue
       FROM \`${PROJECT_ID}.mart.mart_email_flow_daily\`
       WHERE client_id = @clientId AND currency = @currency
         AND metric_date BETWEEN @from AND @to
       GROUP BY flow_id
       ORDER BY revenue DESC NULLS LAST`,
      { clientId, currency, from: range.from, to: range.to }
    );

    const flows: FlowRow[] = rows.map((r) => {
      const sent = num(r.emails_sent);
      const opens = num(r.unique_opens);
      const clicks = num(r.unique_clicks);
      const conversions = num(r.conversions);
      const revenue = num(r.revenue);

      return {
        flowId: String(r.flow_id ?? ""),
        flowName: String(r.flow_name ?? "—"),
        platform: "klaviyo",
        status: r.status === null ? null : String(r.status),
        emailsSent: sent,
        // The daily series carries sends, not deliveries. Rates are therefore
        // against sends and named as such rather than quietly relabelled.
        delivered: sent,
        uniqueOpens: opens,
        uniqueClicks: clicks,
        openRate: safeDiv(opens, sent),
        clickRate: safeDiv(clicks, sent),
        conversions,
        conversionRate: safeDiv(conversions, sent),
        revenue,
        revenuePerEmail: safeDiv(revenue, sent),
      };
    });

    const sum = (pick: (f: FlowRow) => number | null): number | null =>
      flows.reduce<number | null>(
        (acc, f) => (pick(f) === null ? acc : (acc ?? 0) + (pick(f) as number)),
        null
      );

    const sent = sum((f) => f.emailsSent);

    return {
      flows,
      totalRevenue: sum((f) => f.revenue),
      totalConversions: sum((f) => f.conversions),
      totalEmails: sent,
      openRate: safeDiv(sum((f) => f.uniqueOpens), sent),
      clickRate: safeDiv(sum((f) => f.uniqueClicks), sent),
      snapshotDate: lastAvailable,
      coverage,
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}
