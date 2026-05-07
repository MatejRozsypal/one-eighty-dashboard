# wf_shopify — Shopify → BigQuery (multi-tenant)

**Source:** Shopify Admin REST API
**Active for clients:** any with `has_shopify=TRUE` in `ref.clients` (Dr. Dobias once token arrives; future clients via INSERT)
**Cadence:** Daily polling at 03:00 client-timezone (cron `0 10 * * *` UTC for Pacific clients). Webhooks deferred to Phase 2.
**Destination:** `raw.raw_shopify_orders`, `raw.raw_shopify_products`, `raw.raw_shopify_customers`

This workflow is **multi-tenant by design** — adding a client = INSERT into `ref.clients` + populate Secret Manager. No new workflow.

---

## Architecture

```
Schedule Trigger (daily)
  → Read active Shopify clients (BQ Execute Query)
    SELECT client_id, slug, currency, timezone
    FROM `oneeighty-warehouse.ref.clients`
    WHERE status='active' AND has_shopify=TRUE
  → Split In Batches (size=1)  ← loops, one client per iteration
    For each client:
      → Get shop_domain     (Secret Manager: shopify-{slug}-shop-domain)
      → Get access_token    (Secret Manager: shopify-{slug}-access-token)
      → Get api_version     (Secret Manager: shopify-{slug}-api-version, default '2025-01')
      → Watermark orders    (BQ: MAX(updated_at) for this client_id)
      → Fetch orders        (HTTP, paginated via Link header)
      → Transform orders    (tag client_id, flatten line_items struct)
      → Insert orders       (BQ Insert, raw_shopify_orders)
      → Watermark products  (BQ: MAX(updated_at) for this client_id)
      → Fetch products      (HTTP, paginated)
      → Transform products  (one row per variant, flat)
      → Insert products     (BQ Insert, raw_shopify_products)
      → Watermark customers (BQ: MAX(updated_at) for this client_id)
      → Fetch customers     (HTTP, paginated)
      → Transform customers
      → Insert customers    (BQ Insert, raw_shopify_customers)
      → Log success         (BQ Insert into ops.pipeline_log)
```

---

## Multi-tenant moving parts

### 1. Client registry — `ref.clients`

Onboarding a new Shopify client requires:

```sql
INSERT INTO `oneeighty-warehouse.ref.clients`
  (client_id, slug, name, currency, timezone, country, shop_platform, status, has_shopify)
VALUES
  ('newclient', 'newclient', 'Newclient Inc.', 'USD', 'America/Los_Angeles', 'US', 'shopify', 'onboarding', TRUE);
```

When credentials arrive (see §3), flip `status='active'`. Workflow auto-picks up the new client on next run.

### 2. Secret naming convention — `shopify-{slug}-{key}`

Per client, three secrets in Google Cloud Secret Manager:

| Secret | Value |
|---|---|
| `shopify-{slug}-shop-domain` | `<store>.myshopify.com` (NOT the customer-facing domain) |
| `shopify-{slug}-access-token` | `shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `shopify-{slug}-api-version` | `2025-01` (or whichever version was current at install) |

Naming uses lowercase + hyphens because Secret Manager rejects underscores.

### 3. Credential pull pattern

Inside the per-client loop, each Secret Manager node fetches its secret with name expression:

```
=shopify-{{ $('Loop over clients').item.json.slug }}-shop-domain
```

This is the multi-tenant magic — one workflow, N clients, secrets resolved at runtime per iteration.

### 4. HTTP Request authentication

Each Shopify call uses:
- **URL:** `=https://{{ $node['Get shop_domain'].json.value }}/admin/api/{{ $node['Get api_version'].json.value }}/orders.json` (etc.)
- **Header:** `X-Shopify-Access-Token: {{ $node['Get access_token'].json.value }}`
- **Header:** `Accept: application/json`

### 5. Watermark pattern (per client)

Orders watermark query:

```sql
SELECT
  COALESCE(
    FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez',
      TIMESTAMP_SUB(MAX(updated_at), INTERVAL 1 DAY)),
    FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez',
      TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 MONTH))
  ) AS updated_at_min
FROM `oneeighty-warehouse.raw.raw_shopify_orders`
WHERE client_id = '{{ $('Loop over clients').item.json.client_id }}'
  AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
```

Returns ISO-8601 timestamp. Empty table → 24 months ago (full backfill on first run). Populated table → MAX(updated_at) − 1 day overlap (catches late status changes).

Same pattern for products (`MAX(updated_at)`) and customers (`MAX(updated_at)`).

### 6. Pagination

Shopify uses **Link header pagination**:
- Response headers contain `Link: <https://...?page_info=xyz>; rel="next"`
- n8n HTTP Request node has built-in support: **Settings → Pagination → Mode: "Response Headers Link"**, follow `next` rel.
- Default page size 250 (Shopify max).

### 7. Rate limit

- Shopify gives 40 req / app / store on standard plans; bucket replenishes at 2 req/s.
- Each `/orders.json?limit=250` call returns 250 orders → 4,000 orders covered per second of API budget. Plenty of headroom.
- n8n auto-retries on 429 with exponential backoff if you set **Retry On Fail** in the HTTP node options.

---

## Transform pseudocode (orders)

```javascript
const CLIENT_ID = $('Loop over clients').item.json.client_id;
const INGESTED_AT = new Date().toISOString();

// HTTP node returns { orders: [...] }; n8n auto-flattens to one item per order
return $input.all().map(item => {
  const o = item.json;
  return {
    json: {
      client_id:             CLIENT_ID,
      ingested_at:           INGESTED_AT,
      ingest_source:         'backfill',  // or 'reconcile' on subsequent runs

      order_id:              String(o.id),
      order_number:          o.name,                                   // '#1023'
      order_date:            (o.processed_at || o.created_at)?.slice(0, 10),
      created_at:            o.created_at,
      updated_at:            o.updated_at,
      processed_at:          o.processed_at,

      currency:              o.currency,
      presentment_currency:  o.presentment_currency,
      subtotal_price:        Number(o.subtotal_price ?? 0),
      total_shipping:        Number(o.total_shipping_price_set?.shop_money?.amount ?? 0),
      total_tax:             Number(o.total_tax ?? 0),
      total_discounts:       Number(o.total_discounts ?? 0),
      total_price:           Number(o.total_price ?? 0),

      customer_id:           String(o.customer?.id ?? ''),
      customer_email:        o.customer?.email ?? o.email,
      is_returning_customer: Boolean(o.customer?.orders_count > 1),
      shipping_country:      o.shipping_address?.country_code,
      shipping_province:     o.shipping_address?.province_code,

      financial_status:      o.financial_status,
      fulfillment_status:    o.fulfillment_status,
      cancelled_at:          o.cancelled_at,
      source_name:           o.source_name,

      line_items: (o.line_items ?? []).map(li => ({
        line_item_id:       String(li.id),
        product_id:         String(li.product_id ?? ''),
        variant_id:         String(li.variant_id ?? ''),
        sku:                li.sku ?? '',
        title:              li.title,
        quantity:           Number(li.quantity ?? 0),
        price:              Number(li.price ?? 0),
        total_discount:     Number(li.total_discount ?? 0),
        fulfillment_status: li.fulfillment_status,
      })),

      payload_json:          JSON.stringify(o),
    }
  };
});
```

Products and customers follow the same shape — the DDL columns are the contract.

---

## First-run backfill

When a new client's `status` flips to `'active'`:

1. Workflow's next scheduled run picks up the new row in `ref.clients`.
2. Watermark for that client returns `MAX(updated_at)` = NULL → COALESCE gives 24 months ago.
3. Pagination iterates through the entire history. For Dr. Dobias's volume (~2,000 orders/year), this is ~16 pages × ~250 orders = a 5–10 min run.
4. Subsequent runs use the populated MAX(updated_at) − 1 day overlap, so they're tight.

If you want a backfill RIGHT NOW (not waiting for the next cron), click **Execute Workflow** manually after the client row goes active.

---

## Onboarding checklist (any new Shopify client)

Once you have the dev's three values from the spec doc (shop_domain, access_token, api_version):

```bash
# 1. Drop them into Secret Manager
echo -n "<shop-domain>"   | gcloud secrets create shopify-<slug>-shop-domain   --data-file=- --project=oneeighty-warehouse
echo -n "<access-token>"  | gcloud secrets create shopify-<slug>-access-token  --data-file=- --project=oneeighty-warehouse
echo -n "<api-version>"   | gcloud secrets create shopify-<slug>-api-version   --data-file=- --project=oneeighty-warehouse

# 2. Grant the n8n SA access
for s in shop-domain access-token api-version; do
  gcloud secrets add-iam-policy-binding shopify-<slug>-$s \
    --member="serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --project=oneeighty-warehouse
done

# 3. Activate the client in BQ
# UPDATE ref.clients SET status='active' WHERE slug='<slug>';
```

Workflow auto-discovers the client on its next run. No n8n changes required.

---

## Deferred work (Phase 2)

- **Webhooks for real-time orders:** `orders/create`, `orders/paid`, `orders/updated`, `customers/update`, `products/update` → public n8n webhook URL → HMAC validation → same transform → BQ append. Reduces latency from "daily" to "seconds".
- **Inventory level tracking:** separate table `raw_shopify_inventory_levels`, daily snapshot from `/inventory_levels.json`.
- **Refunds detail:** currently captured in `payload_json`; flatten to a dedicated `raw_shopify_refunds` if mart layer needs refund-rate metrics.
- **CAD currency normalization:** Dr. Dobias trades in USD natively; CAD conversion (if ever needed) belongs in mart, not raw — store presentment_currency raw, leave as-is.
