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
