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

import { getServerSession } from "next-auth";
import { query, PROJECT_ID } from "@/lib/bigquery";
import { authOptions } from "@/lib/auth";
import { isoDate } from "@/lib/coerce";
import { DEMO_CLIENT, DEMO_CLIENT_ID, isDemo } from "@/lib/demo/client";
import { dataThrough as demoDataThrough } from "@/lib/demo/business";
import { recordAccess } from "@/lib/users/accessLog";

/**
 * The demo client ships switched on. It is invisible to anyone with the
 * `client` role unless they are assigned to it, so the only people who see it
 * in the switcher are the agency — which is who presents with it. Set
 * DEMO_CLIENT_DISABLED=1 to remove it entirely.
 */
const DEMO_ENABLED = process.env.DEMO_CLIENT_DISABLED !== "1";

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
 * Every client the registry holds, including ones not yet live.
 *
 * ── Why this is separate, and who may call it ───────────────────────────────
 * `getClients()` returns only `status = 'active'`, which is correct: an
 * onboarding client must not appear in the switcher or be resolvable from a
 * URL. But every ingest workflow filters on the same flag, so a client parked
 * at 'onboarding' is skipped by the pipelines *and* invisible to the page whose
 * entire job is noticing that data stopped arriving. Venev sat 41 days stale
 * that way, seen by nothing.
 *
 * This is therefore for the Data Health page only — an internal-only screen —
 * and it deliberately does NOT append the demo client or feed `resolveClient`.
 * Widening the confinement gate is not what this is for.
 */
export async function getClientsIncludingInactive(): Promise<
  Array<Client & { status: string }>
> {
  const rows = await query<ClientRow>(
    `SELECT client_id, name, currency, timezone, country,
            shop_platform, email_platform, status,
            has_shopify, has_shoptet, has_klaviyo, has_ecomail,
            has_meta, has_gads, has_ga4, has_instagram,
            klaviyo_conversion_metric_id, klaviyo_subscriber_segment_id
     FROM \`${PROJECT_ID}.ref.clients\`
     ORDER BY name`
  );
  return rows.map((r) => ({ ...toClient(r), status: r.status }));
}

/**
 * Every active client, ordered for the switcher.
 *
 * Tiny table, queried on nearly every request. A client's currency or platform
 * changes roughly never, so a stale minute on this is harmless where a stale
 * minute on revenue would not be.
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

  // Appended, never stored — the demo has no registry row precisely so that no
  // warehouse query, n8n loop or freshness check has to know it exists. It is
  // appended *last* so `resolveClient`'s fallback still lands on a real client.
  //
  // Note this deliberately does NOT catch a registry failure to keep the demo
  // alive during an outage. Swallowing it would render a healthy-looking
  // dashboard containing one fictional brand, which is a worse failure than an
  // error page: the reader cannot tell that everything real is missing.
  const real = rows.map(toClient);
  return DEMO_ENABLED ? [...real, DEMO_CLIENT] : real;
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

  // ── Server-side confinement — the ONE gate that keeps clients apart ─────────
  // Every data page calls this to turn `?client=` into the client it renders.
  // The layout also filters the client list, but only to build the switcher UI;
  // that filtered list never reaches the page components, so it cannot keep one
  // client out of another's numbers. Enforcing it here — where the role is read
  // from the server-verified session, not from anything the browser controls —
  // means a `client`-role account gets its own client regardless of what the URL
  // asks for. Change `?client=` to a different id and this still returns theirs.
  const session = await getServerSession(authOptions);
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
    throw new Error(
      "This account is not permitted to view any client. Ask an admin to " +
        "assign it a client under Admin → Users."
    );
  }

  // A `?client=` naming somebody else is the event worth keeping. Preventing
  // the read is the security requirement; being able to say afterwards whether
  // anyone tried is the compliance one, and an NDA conversation goes very
  // differently when the answer is evidenced rather than assumed. A blank or
  // already-correct id is ordinary navigation, not an attempt.
  const attempted = Boolean(requested && requested !== ownId);
  if (attempted) {
    console.warn(
      `[authz] REFUSED cross-client access: ${email} ` +
        `(client=${ownId}) requested client=${requested}`
    );
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
async function audit(entry: {
  email: string;
  role: string;
  event: "view" | "refused";
  clientId: string;
  requestedClientId?: string | null;
}): Promise<void> {
  if (isDemo(entry.clientId)) return;
  await recordAccess(entry);
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
    // Nothing to drift from: the demo client has no registry row, so its
    // "registry" and its data are the same declaration.
    if (isDemo(client.clientId)) continue;

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

  const out = new Map<string, string | null>(
    rows.map((r) => [r.client_id, isoDate(r.last_date)])
  );
  // The demo's stamp comes from its own generator; it has no mart rows.
  if (DEMO_ENABLED) out.set(DEMO_CLIENT_ID, demoDataThrough());
  return out;
}
