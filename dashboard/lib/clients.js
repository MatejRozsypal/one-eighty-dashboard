"use strict";
/**
 * Client registry.
 *
 * `ref.clients` is the single source of truth for who exists, what currency they
 * trade in, and which sources they have. Adding a client to the dashboard is an
 * INSERT there and nothing else — no code change, matching the warehouse's
 * "n8n workflows loop over ref.clients, never duplicate per client" rule.
 *
 * The capability flags drive what the UI renders. A client with has_gads = false
 * gets no Google card at all, rather than a card reading "—" that leaves you
 * wondering whether the spend is zero or the pipeline is broken.
 *
 * ⚠ The registry can drift from reality — it is hand-maintained and nothing
 * validates it on write. See `detectRegistryDrift` below and the Data Health
 * page, which surfaces drift rather than silently working around it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClients = getClients;
exports.resolveClient = resolveClient;
exports.detectRegistryDrift = detectRegistryDrift;
exports.getDataThrough = getDataThrough;
const next_auth_1 = require("next-auth");
const bigquery_1 = require("@/lib/bigquery");
const auth_1 = require("@/lib/auth");
const coerce_1 = require("@/lib/coerce");
const client_1 = require("@/lib/demo/client");
const business_1 = require("@/lib/demo/business");
const accessLog_1 = require("@/lib/users/accessLog");
/**
 * The demo client ships switched on. It is invisible to anyone with the
 * `client` role unless they are assigned to it, so the only people who see it
 * in the switcher are the agency — which is who presents with it. Set
 * DEMO_CLIENT_DISABLED=1 to remove it entirely.
 */
const DEMO_ENABLED = process.env.DEMO_CLIENT_DISABLED !== "1";
function toClient(row) {
    return {
        clientId: row.client_id,
        name: row.name,
        currency: row.currency,
        timezone: row.timezone,
        country: row.country,
        shopPlatform: row.shop_platform,
        emailPlatform: row.email_platform,
        status: row.status,
        capabilities: {
            shopify: row.has_shopify === true,
            shoptet: row.has_shoptet === true,
            klaviyo: row.has_klaviyo === true,
            ecomail: row.has_ecomail === true,
            meta: row.has_meta === true,
            googleAds: row.has_gads === true,
            ga4: row.has_ga4 === true,
            instagram: row.has_instagram === true,
        },
        klaviyoConversionMetricId: row.klaviyo_conversion_metric_id,
        klaviyoSubscriberSegmentId: row.klaviyo_subscriber_segment_id,
    };
}
/**
 * Every active client, ordered for the switcher.
 *
 * Tiny table (2 rows today), queried on nearly every request. Cached for an hour
 * because a client's currency or platform changes roughly never, and a stale
 * hour on that is harmless where a stale hour on revenue would not be.
 */
async function getClients() {
    const rows = await (0, bigquery_1.query)(`SELECT client_id, name, currency, timezone, country,
            shop_platform, email_platform, status,
            has_shopify, has_shoptet, has_klaviyo, has_ecomail,
            has_meta, has_gads, has_ga4, has_instagram,
            klaviyo_conversion_metric_id, klaviyo_subscriber_segment_id
     FROM \`${bigquery_1.PROJECT_ID}.ref.clients\`
     WHERE status = 'active'
     ORDER BY name`);
    // Appended, never stored — the demo has no registry row precisely so that no
    // warehouse query, n8n loop or freshness check has to know it exists. It is
    // appended *last* so `resolveClient`'s fallback still lands on a real client.
    //
    // Note this deliberately does NOT catch a registry failure to keep the demo
    // alive during an outage. Swallowing it would render a healthy-looking
    // dashboard containing one fictional brand, which is a worse failure than an
    // error page: the reader cannot tell that everything real is missing.
    const real = rows.map(toClient);
    return DEMO_ENABLED ? [...real, client_1.DEMO_CLIENT] : real;
}
/**
 * Resolve the client for a request, falling back to the first active one.
 *
 * The switcher keeps the selection in the URL (`?client=dobias`) rather than a
 * cookie or session, so a dashboard view is a shareable, bookmarkable link and
 * server components can read it without any client-side state.
 */
async function resolveClient(requested, clients) {
    if (clients.length === 0) {
        throw new Error("ref.clients has no active rows — the dashboard has nothing to show.");
    }
    // ── Server-side confinement — the ONE gate that keeps clients apart ─────────
    // Every data page calls this to turn `?client=` into the client it renders.
    // The layout also filters the client list, but only to build the switcher UI;
    // that filtered list never reaches the page components, so it cannot keep one
    // client out of another's numbers. Enforcing it here — where the role is read
    // from the server-verified session, not from anything the browser controls —
    // means a `client`-role account gets its own client regardless of what the URL
    // asks for. Change `?client=` to a different id and this still returns theirs.
    const session = await (0, next_auth_1.getServerSession)(auth_1.authOptions);
    const role = session?.user?.role ?? null;
    const email = session?.user?.email ?? "unknown";
    if (role === "agency" || role === "admin") {
        // Internal roles may view any client; an unknown/blank id falls back.
        const served = clients.find((c) => c.clientId === requested) ?? clients[0];
        await audit({ email, role, event: "view", clientId: served.clientId });
        return served;
    }
    // `client` role — and, fail-closed, anything else that reaches here — is
    // pinned to its own assigned client. Never fall through to clients[0], which
    // would hand back whichever client happens to sort first.
    const ownId = session?.user?.clientId ?? null;
    const own = ownId ? clients.find((c) => c.clientId === ownId) : null;
    if (!own) {
        throw new Error("This account is not permitted to view any client. Ask an admin to " +
            "assign it a client under Admin → Users.");
    }
    // A `?client=` naming somebody else is the event worth keeping. Preventing
    // the read is the security requirement; being able to say afterwards whether
    // anyone tried is the compliance one, and an NDA conversation goes very
    // differently when the answer is evidenced rather than assumed. A blank or
    // already-correct id is ordinary navigation, not an attempt.
    const attempted = Boolean(requested && requested !== ownId);
    if (attempted) {
        console.warn(`[authz] REFUSED cross-client access: ${email} ` +
            `(client=${ownId}) requested client=${requested}`);
    }
    await audit({
        email,
        role: role ?? "none",
        event: attempted ? "refused" : "view",
        clientId: own.clientId,
        requestedClientId: attempted ? requested : null,
    });
    return own;
}
/**
 * Write one access-log row, never letting it break the page.
 *
 * The demo client is skipped: its figures are invented, so a record of who
 * looked at them is noise in a table whose whole value is that every row in it
 * concerns real client data.
 */
async function audit(entry) {
    if ((0, client_1.isDemo)(entry.clientId))
        return;
    await (0, accessLog_1.recordAccess)(entry);
}
/**
 * Cross-check the registry against what the warehouse actually contains.
 *
 * This exists because the registry is already wrong in two known ways, and the
 * dashboard reads it as gospel:
 *
 *   1. `dobias.currency = 'CAD'` while every mart row for dobias is USD. The
 *      brief corrected the original CAD assumption; the registry never followed.
 *      Left alone, this labels ~$600k of quarterly revenue with the wrong symbol.
 *   2. `manami.has_gads = false` while Google Ads has been landing since
 *      2025-10 and contributes ~19k CZK/mo to paid_spend. Capability-driven UI
 *      would hide a channel that is actively spending money.
 *
 * Rather than hardcoding a workaround (which buries the problem and rots the
 * moment a third client lands), the Data Health page runs this and shows what
 * disagrees. Fixing it is an UPDATE against ref.clients — a warehouse change,
 * not a frontend one.
 */
async function detectRegistryDrift(clients) {
    const drift = [];
    const observed = await (0, bigquery_1.query)(`SELECT
       client_id,
       ARRAY_AGG(DISTINCT currency IGNORE NULLS ORDER BY currency) AS currencies,
       LOGICAL_OR(google_spend IS NOT NULL)                        AS has_google_spend
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
     GROUP BY client_id`);
    for (const client of clients) {
        // Nothing to drift from: the demo client has no registry row, so its
        // "registry" and its data are the same declaration.
        if ((0, client_1.isDemo)(client.clientId))
            continue;
        const row = observed.find((o) => o.client_id === client.clientId);
        if (!row)
            continue;
        if (row.currencies.length > 0 && !row.currencies.includes(client.currency)) {
            drift.push({
                clientId: client.clientId,
                field: "currency",
                registryValue: client.currency,
                actualValue: row.currencies.join(", "),
                consequence: "Every monetary figure for this client is labelled with the wrong currency.",
            });
        }
        if (row.has_google_spend && !client.capabilities.googleAds) {
            drift.push({
                clientId: client.clientId,
                field: "has_gads",
                registryValue: "false",
                actualValue: "true — Google spend present in mart",
                consequence: "Google Ads cards are hidden even though the channel is spending and is netted out of CM3.",
            });
        }
    }
    return drift;
}
/**
 * Freshest date the warehouse holds per client — the "data through" stamp.
 */
async function getDataThrough() {
    const rows = await (0, bigquery_1.query)(`SELECT client_id, MAX(date) AS last_date
     FROM \`${bigquery_1.PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
     GROUP BY client_id`);
    const out = new Map(rows.map((r) => [r.client_id, (0, coerce_1.isoDate)(r.last_date)]));
    // The demo's stamp comes from its own generator; it has no mart rows.
    if (DEMO_ENABLED)
        out.set(client_1.DEMO_CLIENT_ID, (0, business_1.dataThrough)());
    return out;
}
