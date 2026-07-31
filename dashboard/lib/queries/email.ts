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

export interface FlowSummary {
  flows: FlowRow[];
  totalRevenue: number | null;
  totalConversions: number | null;
  totalEmails: number | null;
  /** Delivery-weighted, never a mean of per-flow rates. */
  openRate: number | null;
  clickRate: number | null;
  snapshotDate: string | null;
}

export async function getFlows(
  clientId: string,
  currency: string
): Promise<FlowSummary | null> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT flow_id, flow_name, platform, status, latest_snapshot_date,
              emails_sent, delivered_approx, unique_opens, unique_clicks,
              conversions, revenue
       FROM \`${PROJECT_ID}.mart.mart_email_flow_perf\`
       WHERE client_id = @clientId AND currency = @currency
       ORDER BY revenue DESC NULLS LAST`,
      { clientId, currency }
    );

    if (rows.length === 0) return null;

    const flows: FlowRow[] = rows.map((r) => {
      const sent = num(r.emails_sent);
      const delivered = num(r.delivered_approx);
      const opens = num(r.unique_opens);
      const clicks = num(r.unique_clicks);
      const conversions = num(r.conversions);
      const revenue = num(r.revenue);

      return {
        flowId: String(r.flow_id ?? ""),
        flowName: String(r.flow_name ?? "—"),
        platform: String(r.platform ?? ""),
        status: r.status === null ? null : String(r.status),
        emailsSent: sent,
        delivered,
        uniqueOpens: opens,
        uniqueClicks: clicks,
        // Rates are recomputed from the counts. The view carries its own
        // *_pct columns, but those are per-flow ratios and averaging them
        // across flows weights a 2-send flow like a 40,000-send one.
        openRate: safeDiv(opens, delivered),
        clickRate: safeDiv(clicks, delivered),
        conversions,
        conversionRate: safeDiv(conversions, delivered),
        revenue,
        revenuePerEmail: safeDiv(revenue, sent),
      };
    });

    const sum = (pick: (f: FlowRow) => number | null): number | null =>
      flows.reduce<number | null>(
        (acc, f) => (pick(f) === null ? acc : (acc ?? 0) + (pick(f) as number)),
        null
      );

    const delivered = sum((f) => f.delivered);

    return {
      flows,
      totalRevenue: sum((f) => f.revenue),
      totalConversions: sum((f) => f.conversions),
      totalEmails: sum((f) => f.emailsSent),
      openRate: safeDiv(sum((f) => f.uniqueOpens), delivered),
      clickRate: safeDiv(sum((f) => f.uniqueClicks), delivered),
      snapshotDate: isoDate(rows[0]?.latest_snapshot_date as never),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}
