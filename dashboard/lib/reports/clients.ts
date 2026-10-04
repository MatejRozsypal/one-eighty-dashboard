import "server-only";

/**
 * The client list as Reports sees it (design 2.7 step 2, contract GetReportClients).
 *
 * Deliberately not `getClients()` / `resolveClient()` from lib/clients.ts:
 * those serve one client per page, append the demo client, and confine a
 * client-role user to their own id. Reports work across clients for internal
 * staff only, so they read the registry themselves:
 *
 *   - `ref.clients`, status = 'active'. NULL capability flags are false
 *     (has_woocommerce is NULL rather than FALSE for non-Woo clients).
 *   - `ref.client_verticals` (migration 251), the open row per client. Until
 *     that table is deployed the query fails with "Not found: Table"; that one
 *     error means "no verticals yet" and every client gets vertical null. Any
 *     other warehouse error is re-thrown, never shown as an empty list.
 *   - The demo client is excluded: it has no registry row, and the id is
 *     filtered again here in case one is ever added.
 *
 * Gate: assertReportsAccess() runs before the cache is read, so cached rows
 * are only ever handed to a caller who passed the gate in this request.
 */

import { unstable_cache } from "next/cache";
import { query, PROJECT_ID } from "@/lib/bigquery";
import { assertReportsAccess } from "@/lib/authz";
import { isDemo } from "@/lib/demo/client";
import type { GetReportClients } from "./contracts";
import { CACHE_TAGS, CACHE_TTL_S, SERIES_SLOTS } from "./limits";
import { toReportCapabilities } from "./registry/capabilities";
import type { ReportCapabilities, ReportClient, ShopPlatform } from "./registry/types";

interface ClientRow {
  client_id: string;
  name: string | null;
  currency: string | null;
  country: string | null;
  shop_platform: string | null;
  has_shopify: boolean | null;
  has_shoptet: boolean | null;
  has_woocommerce: boolean | null;
  has_klaviyo: boolean | null;
  has_ecomail: boolean | null;
  has_meta: boolean | null;
  has_gads: boolean | null;
  has_ga4: boolean | null;
}

interface VerticalRow {
  client_id: string;
  vertical: string;
  sub_vertical: string | null;
  region: string | null;
}

/** Same rule the zod contracts apply to client ids; a registry id outside it cannot be selected, so it is skipped. */
const CLIENT_ID_RE = /^[a-z0-9_]{1,40}$/;

const SHOP_PLATFORMS: readonly ShopPlatform[] = ["shopify", "shoptet", "woocommerce"];

/**
 * True for BigQuery's "table does not exist" error on exactly this table.
 * Matched on the table name so a missing dataset, a permission error or a
 * typo elsewhere still surfaces.
 */
export function isTableNotFound(error: unknown, table: string): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  const escaped = table.replace(/\./g, "\\.");
  return new RegExp(`Not found: Table [^ ]*${escaped}\\b`, "i").test(message);
}

/**
 * The registry flags as Reports sees them. NULL is false, and the derived
 * `shop` and `email` flags come from the one shared rule (toReportCapabilities).
 */
function capabilitiesOf(row: ClientRow): ReportCapabilities {
  return toReportCapabilities({
    shopify: row.has_shopify === true,
    shoptet: row.has_shoptet === true,
    woocommerce: row.has_woocommerce === true,
    klaviyo: row.has_klaviyo === true,
    ecomail: row.has_ecomail === true,
    meta: row.has_meta === true,
    googleAds: row.has_gads === true,
    ga4: row.has_ga4 === true,
    instagram: false,
  });
}

/** `shop_platform` when it names a known platform, else the first shop flag that is on, else null. */
function shopPlatformOf(row: ClientRow, caps: ReportCapabilities): ShopPlatform | null {
  const declared = row.shop_platform?.trim().toLowerCase() ?? "";
  if ((SHOP_PLATFORMS as readonly string[]).includes(declared)) return declared as ShopPlatform;
  return SHOP_PLATFORMS.find((p) => caps[p]) ?? null;
}

async function loadVerticals(): Promise<Map<string, VerticalRow>> {
  try {
    const rows = await query<VerticalRow>(
      `SELECT client_id, vertical, sub_vertical, region
         FROM \`${PROJECT_ID}.ref.client_verticals\`
        WHERE valid_to IS NULL
          AND valid_from <= CURRENT_DATE()
        QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY valid_from DESC, updated_at DESC) = 1`
    );
    return new Map(rows.map((r) => [r.client_id, r]));
  } catch (error) {
    if (isTableNotFound(error, "ref.client_verticals")) return new Map();
    throw error;
  }
}

async function loadReportClients(): Promise<ReportClient[]> {
  const [rows, verticals] = await Promise.all([
    query<ClientRow>(
      `SELECT client_id, name, currency, country, shop_platform,
              has_shopify, has_shoptet, has_woocommerce, has_klaviyo, has_ecomail,
              has_meta, has_gads, has_ga4
         FROM \`${PROJECT_ID}.ref.clients\`
        WHERE status = 'active'
        ORDER BY client_id`
    ),
    loadVerticals(),
  ]);

  const usable = rows
    .filter((r) => CLIENT_ID_RE.test(r.client_id) && !isDemo(r.client_id) && Boolean(r.currency))
    .sort((a, b) => (a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : 0));

  return usable.map((row, index) => {
    const caps = capabilitiesOf(row);
    const v = verticals.get(row.client_id);
    const vertical = v?.vertical?.trim().toLowerCase() || null;
    return {
      id: row.client_id,
      name: row.name?.trim() || row.client_id,
      currency: (row.currency as string).trim().toUpperCase(),
      shopPlatform: shopPlatformOf(row, caps),
      capabilities: caps,
      vertical,
      subVertical: v?.sub_vertical?.trim() || null,
      region: v?.region?.trim().toUpperCase() || row.country?.trim().toUpperCase() || null,
      slot: index % SERIES_SLOTS,
    };
  });
}

/** Plain JSON in and out, so the data cache stores it as is. Shared by every user who passes the gate. */
const cachedReportClients = unstable_cache(loadReportClients, ["reports", "clients", "v1"], {
  revalidate: CACHE_TTL_S.clients,
  tags: [CACHE_TAGS.reference],
});

export const getReportClients: GetReportClients = async () => {
  await assertReportsAccess();
  return cachedReportClients();
};
