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

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isoDate } from "@/lib/coerce";

export interface ClientCapabilities {
  shopify: boolean;
  shoptet: boolean;
  klaviyo: boolean;
  ecomail: boolean;
  meta: boolean;
  googleAds: boolean;
  ga4: boolean;
  instagram: boolean;
}

export interface Client {
  clientId: string;
  name: string;
  /** Trading currency per the registry. Money is rendered in this unless the user switches. */
  currency: string;
  timezone: string;
  country: string | null;
  shopPlatform: string | null;
  emailPlatform: string | null;
  status: string;
  capabilities: ClientCapabilities;
  /** Klaviyo "Placed Order" metric id — needed for conversion attribution. */
  klaviyoConversionMetricId: string | null;
  klaviyoSubscriberSegmentId: string | null;
}

interface ClientRow {
  client_id: string;
  name: string;
  currency: string;
  timezone: string;
  country: string | null;
  shop_platform: string | null;
  email_platform: string | null;
  status: string;
  has_shopify: boolean | null;
  has_shoptet: boolean | null;
  has_klaviyo: boolean | null;
  has_ecomail: boolean | null;
  has_meta: boolean | null;
  has_gads: boolean | null;
  has_ga4: boolean | null;
  has_instagram: boolean | null;
  klaviyo_conversion_metric_id: string | null;
  klaviyo_subscriber_segment_id: string | null;
}

function toClient(row: ClientRow): Client {
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
export async function getClients(): Promise<Client[]> {
  const rows = await query<ClientRow>(
    `SELECT client_id, name, currency, timezone, country,
            shop_platform, email_platform, status,
            has_shopify, has_shoptet, has_klaviyo, has_ecomail,
            has_meta, has_gads, has_ga4, has_instagram,
            klaviyo_conversion_metric_id, klaviyo_subscriber_segment_id
     FROM \`${PROJECT_ID}.ref.clients\`
     WHERE status = 'active'
     ORDER BY name`
  );
  return rows.map(toClient);
}

export async function getClient(clientId: string): Promise<Client | null> {
  const clients = await getClients();
  return clients.find((c) => c.clientId === clientId) ?? null;
}

/**
 * Resolve the client for a request, falling back to the first active one.
 *
 * The switcher keeps the selection in the URL (`?client=dobias`) rather than a
 * cookie or session, so a dashboard view is a shareable, bookmarkable link and
 * server components can read it without any client-side state.
 */
export async function resolveClient(
  requested: string | undefined,
  clients: Client[]
): Promise<Client> {
  if (clients.length === 0) {
    throw new Error(
      "ref.clients has no active rows — the dashboard has nothing to show."
    );
  }
  return clients.find((c) => c.clientId === requested) ?? clients[0];
}

// ---------------------------------------------------------------------------
// Registry drift
// ---------------------------------------------------------------------------

export interface RegistryDrift {
  clientId: string;
  field: string;
  registryValue: string;
  actualValue: string;
  consequence: string;
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
export async function detectRegistryDrift(
  clients: Client[]
): Promise<RegistryDrift[]> {
  const drift: RegistryDrift[] = [];

  const observed = await query<{
    client_id: string;
    currencies: string[];
    has_google_spend: boolean;
  }>(
    `SELECT
       client_id,
       ARRAY_AGG(DISTINCT currency IGNORE NULLS ORDER BY currency) AS currencies,
       LOGICAL_OR(google_spend IS NOT NULL)                        AS has_google_spend
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
     GROUP BY client_id`
  );

  for (const client of clients) {
    const row = observed.find((o) => o.client_id === client.clientId);
    if (!row) continue;

    if (row.currencies.length > 0 && !row.currencies.includes(client.currency)) {
      drift.push({
        clientId: client.clientId,
        field: "currency",
        registryValue: client.currency,
        actualValue: row.currencies.join(", "),
        consequence:
          "Every monetary figure for this client is labelled with the wrong currency.",
      });
    }

    if (row.has_google_spend && !client.capabilities.googleAds) {
      drift.push({
        clientId: client.clientId,
        field: "has_gads",
        registryValue: "false",
        actualValue: "true — Google spend present in mart",
        consequence:
          "Google Ads cards are hidden even though the channel is spending and is netted out of CM3.",
      });
    }
  }

  return drift;
}

/**
 * Freshest date the warehouse holds per client — the "data through" stamp.
 */
export async function getDataThrough(): Promise<Map<string, string | null>> {
  const rows = await query<{ client_id: string; last_date: { value: string } }>(
    `SELECT client_id, MAX(date) AS last_date
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
     GROUP BY client_id`
  );
  return new Map(rows.map((r) => [r.client_id, isoDate(r.last_date)]));
}
