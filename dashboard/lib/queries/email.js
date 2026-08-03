"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailSummary = getEmailSummary;
exports.getFlows = getFlows;
const bigquery_1 = require("@/lib/bigquery");
const errors_1 = require("@/lib/queries/errors");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const media_1 = require("@/lib/demo/media");
async function getEmailSummary(clientId, range, limit = 30) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, media_1.demoEmailSummary)(range, limit);
    try {
        const rows = await (0, bigquery_1.query)(`SELECT
         campaign_name, send_date, sent, delivered,
         unique_opens, unique_clicks, unique_orders, revenue, aov
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_email_campaign_message_perf\`
       WHERE client_id = @clientId AND send_date BETWEEN @from AND @to
       ORDER BY revenue DESC
       LIMIT @limit`, { clientId, from: range.from, to: range.to, limit });
        if (rows.length === 0)
            return null;
        const campaigns = rows.map((r) => {
            const delivered = (0, coerce_1.num)(r.delivered);
            const sent = (0, coerce_1.num)(r.sent);
            const revenue = (0, coerce_1.num)(r.revenue);
            const uniqueOpens = (0, coerce_1.num)(r.unique_opens);
            const uniqueClicks = (0, coerce_1.num)(r.unique_clicks);
            const uniqueOrders = (0, coerce_1.num)(r.unique_orders);
            return {
                campaignName: String(r.campaign_name ?? "—").trim(),
                sendDate: (0, coerce_1.isoDate)(r.send_date),
                sent,
                delivered,
                uniqueOpens,
                uniqueClicks,
                uniqueOrders,
                revenue,
                openRate: (0, coerce_1.safeDiv)(uniqueOpens, delivered),
                clickRate: (0, coerce_1.safeDiv)(uniqueClicks, delivered),
                orderRate: (0, coerce_1.safeDiv)(uniqueOrders, delivered),
                aov: (0, coerce_1.num)(r.aov),
                revenuePerRecipient: (0, coerce_1.safeDiv)(revenue, sent),
            };
        });
        // Period rates come from summed components — averaging per-campaign rates
        // would weight a 400-recipient send the same as a 44,000-recipient one.
        const sum = (pick) => campaigns.reduce((s, c) => s + (pick(c) ?? 0), 0);
        const totalDelivered = sum((c) => c.delivered);
        const totalSent = sum((c) => c.sent);
        return {
            campaigns,
            totalRevenue: sum((c) => c.revenue),
            totalSent,
            avgOpenRate: (0, coerce_1.safeDiv)(sum((c) => c.uniqueOpens), totalDelivered),
            avgClickRate: (0, coerce_1.safeDiv)(sum((c) => c.uniqueClicks), totalDelivered),
            revenuePerRecipient: (0, coerce_1.safeDiv)(sum((c) => c.revenue), totalSent),
        };
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
async function getFlows(clientId, currency) {
    // Demo client: served from memory, never from the warehouse.
    if ((0, client_1.isDemo)(clientId))
        return (0, media_1.demoFlows)();
    try {
        const rows = await (0, bigquery_1.query)(`SELECT flow_id, flow_name, platform, status, latest_snapshot_date,
              emails_sent, delivered_approx, unique_opens, unique_clicks,
              conversions, revenue
       FROM \`${bigquery_1.PROJECT_ID}.mart.mart_email_flow_perf\`
       WHERE client_id = @clientId AND currency = @currency
       ORDER BY revenue DESC NULLS LAST`, { clientId, currency });
        if (rows.length === 0)
            return null;
        const flows = rows.map((r) => {
            const sent = (0, coerce_1.num)(r.emails_sent);
            const delivered = (0, coerce_1.num)(r.delivered_approx);
            const opens = (0, coerce_1.num)(r.unique_opens);
            const clicks = (0, coerce_1.num)(r.unique_clicks);
            const conversions = (0, coerce_1.num)(r.conversions);
            const revenue = (0, coerce_1.num)(r.revenue);
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
                openRate: (0, coerce_1.safeDiv)(opens, delivered),
                clickRate: (0, coerce_1.safeDiv)(clicks, delivered),
                conversions,
                conversionRate: (0, coerce_1.safeDiv)(conversions, delivered),
                revenue,
                revenuePerEmail: (0, coerce_1.safeDiv)(revenue, sent),
            };
        });
        const sum = (pick) => flows.reduce((acc, f) => (pick(f) === null ? acc : (acc ?? 0) + pick(f)), null);
        const delivered = sum((f) => f.delivered);
        return {
            flows,
            totalRevenue: sum((f) => f.revenue),
            totalConversions: sum((f) => f.conversions),
            totalEmails: sum((f) => f.emailsSent),
            openRate: (0, coerce_1.safeDiv)(sum((f) => f.uniqueOpens), delivered),
            clickRate: (0, coerce_1.safeDiv)(sum((f) => f.uniqueClicks), delivered),
            snapshotDate: (0, coerce_1.isoDate)(rows[0]?.latest_snapshot_date),
        };
    }
    catch (error) {
        if (!(0, errors_1.isMissingObject)(error))
            throw error;
        return null;
    }
}
