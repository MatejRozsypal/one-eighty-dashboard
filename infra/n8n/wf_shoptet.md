# wf_shoptet — Shoptet → BigQuery

**Source:** Shoptet (Czech e-commerce platform)
**Active for clients:** `manami` (only client with `has_shoptet=TRUE` initially)
**Cadence:** Hourly (`0 * * * *` Europe/Prague)
**Destination:** `raw.raw_shoptet_orders`, `raw.raw_shoptet_products`, `raw.raw_shoptet_customers`

---

## API reference
- Docs: https://api.shoptet.com/
- Auth: OAuth 2.0 — needs `client_id` + `client_secret` exchange for `access_token` (1h TTL)
- Endpoints we use:
  - `GET /api/orders` — list orders (filter by `from`, `to`)
  - `GET /api/products` — list products
  - `GET /api/customers` — list customers
- Rate limit: 60 req/min — exponential backoff in n8n if hit

---

## Node-by-node spec

### Node 1 — Schedule Trigger
- **Cron:** `0 * * * *` (every hour at :00)
- **Timezone:** `Europe/Prague`

### Node 2 — Read active Shoptet clients
- **Type:** Google BigQuery → Execute Query
- **Credential:** `BQ Service Account` (uses `sa-n8n-writer-key` from Secret Manager)
- **Query:**
  ```sql
  SELECT client_id, slug, currency, timezone
  FROM `oneeighty-warehouse.ref.clients`
  WHERE status = 'active' AND has_shoptet = TRUE
  ```

### Node 3 — Loop over clients
- **Type:** Split In Batches
- **Batch size:** 1

### Node 4 — Get Shoptet client_id
- **Type:** Google Cloud Secret Manager → Get Secret
- **Secret name:** `=shoptet-{{ $json.slug }}-client-id`

### Node 5 — Get Shoptet client_secret
- **Type:** Google Cloud Secret Manager → Get Secret
- **Secret name:** `=shoptet-{{ $json.slug }}-client-secret`

### Node 6 — Get Shoptet shop_url
- **Type:** Google Cloud Secret Manager → Get Secret
- **Secret name:** `=shoptet-{{ $json.slug }}-shop-url`

### Node 7 — OAuth: exchange for access_token
- **Type:** HTTP Request
- **Method:** POST
- **URL:** `=https://{{ $node['Get Shoptet shop_url'].json.value }}/api/oauth/token`
- **Body (form-urlencoded):**
  ```
  grant_type=client_credentials
  client_id={{ $node['Get Shoptet client_id'].json.value }}
  client_secret={{ $node['Get Shoptet client_secret'].json.value }}
  scope=eshop_read
  ```
- **Output:** `{ access_token, expires_in, ... }`

### Node 8 — Compute watermark
- **Type:** Google BigQuery → Execute Query
- **Query:**
  ```sql
  SELECT
    COALESCE(
      MAX(order_date),
      DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    ) AS since_date,
    CURRENT_DATE() AS until_date
  FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
  WHERE client_id = '{{ $('Loop over clients').item.json.client_id }}'
    AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
  ```

### Node 9 — Pull orders (paginated)
- **Type:** HTTP Request
- **Method:** GET
- **URL:** `=https://{{ $node['Get Shoptet shop_url'].json.value }}/api/orders`
- **Headers:**
  - `Authorization: Bearer {{ $node['Node 7'].json.access_token }}`
  - `Accept: application/json`
- **Query parameters:**
  - `creationTimeFrom`: `{{ $node['Compute watermark'].json.since_date }}T00:00:00`
  - `creationTimeTo`: `{{ $node['Compute watermark'].json.until_date }}T23:59:59`
  - `itemsPerPage`: 100
- **Pagination:** enable n8n's built-in (next page from `_links.next.href`)
- **Retry:** 3 attempts, 60s exponential backoff

### Node 10 — Normalize orders
- **Type:** Function
- **Code:**
  ```javascript
  const clientId = $('Loop over clients').item.json.client_id;
  const ingestedAt = new Date().toISOString();
  const orders = items.map(item => ({
    client_id: clientId,
    ingested_at: ingestedAt,
    order_id: String(item.json.code),
    order_code: item.json.code,
    order_date: item.json.creationTime?.split('T')[0],
    created_at: item.json.creationTime,
    updated_at: item.json.changeTime,
    currency: item.json.currency?.code,
    subtotal: parseFloat(item.json.priceWithoutVat ?? 0),
    shipping: parseFloat(item.json.shippingPrice ?? 0),
    tax: parseFloat(item.json.toPay) - parseFloat(item.json.priceWithoutVat ?? 0),
    discount: parseFloat(item.json.discount ?? 0),
    total: parseFloat(item.json.toPay ?? 0),
    customer_id: String(item.json.customerGuid ?? ''),
    customer_email: item.json.email,
    customer_phone: item.json.phone,
    is_returning_customer: Boolean(item.json.customerGuid),
    shipping_country: item.json.deliveryAddress?.countryCode,
    status: item.json.status?.name,
    payment_method: item.json.paymentMethod?.name,
    shipping_method: item.json.shippingType?.name,
    line_items: (item.json.items ?? []).map(li => ({
      sku: li.code,
      product_id: String(li.productGuid ?? ''),
      variant_id: String(li.variantId ?? ''),
      name: li.name,
      quantity: parseInt(li.amount ?? 0),
      unit_price: parseFloat(li.itemPriceWithVat ?? 0),
      discount: parseFloat(li.discount ?? 0),
      total: parseFloat(li.totalPriceWithVat ?? 0),
    })),
    payload_json: JSON.stringify(item.json),
  }));
  return orders.map(o => ({ json: o }));
  ```

### Node 11 — Insert into raw_shoptet_orders
- **Type:** Google BigQuery → Insert
- **Project:** `oneeighty-warehouse`
- **Dataset:** `raw`
- **Table:** `raw_shoptet_orders`
- **Mode:** Append (batch load — DO NOT use streaming)

### Nodes 12-14 — Same pattern for products
- Pull `/api/products` (no date filter — full snapshot daily)
- Normalize: map to `raw_shoptet_products` schema
- Insert into `raw.raw_shoptet_products`

### Nodes 15-17 — Same pattern for customers
- Pull `/api/customers` (filter by `creationTimeFrom`)
- Normalize: map to `raw_shoptet_customers` schema
- Insert into `raw.raw_shoptet_customers`

### Node 18 — Log success
- **Type:** Google BigQuery → Execute Query
- **Query:**
  ```sql
  INSERT INTO `oneeighty-warehouse.ops.pipeline_log`
    (run_id, workflow, client_id, source, started_at, finished_at, duration_seconds, status, rows_loaded, trigger)
  VALUES (
    '{{ $execution.id }}',
    'wf_shoptet',
    '{{ $('Loop over clients').item.json.client_id }}',
    'shoptet',
    TIMESTAMP('{{ $execution.startedAt }}'),
    CURRENT_TIMESTAMP(),
    TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), TIMESTAMP('{{ $execution.startedAt }}'), SECOND),
    'success',
    {{ $('Insert into raw_shoptet_orders').item.json.rowsAffected ?? 0 }},
    'cron'
  )
  ```

### Error branch (attached to every node)
- **Type:** On Error → Function (build error log row) → BigQuery Insert (`ops.pipeline_log` with `status='failure'`) → Send Email (matej@oneeighty.cz)

---

## First-run backfill

After importing the workflow:

1. **Disable the cron schedule** in n8n UI
2. Replace the watermark query (Node 8) with hardcoded value:
   ```sql
   SELECT DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH) AS since_date, CURRENT_DATE() AS until_date
   ```
3. Click **Execute Workflow**
4. Wait — Manami at 24 months is likely 5,000–20,000 orders, ~5–15 min run
5. Verify in BigQuery:
   ```sql
   SELECT
     MIN(order_date) as earliest, MAX(order_date) as latest, COUNT(*) as orders
   FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
   WHERE client_id = 'manami' AND order_date >= '2024-05-01'
   ```
6. Restore Node 8 to the watermark query
7. Re-enable the schedule

## Sanity check

After 24h of running:
```sql
SELECT
  DATE(ingested_at) as day,
  COUNT(*) as orders_loaded
FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
WHERE client_id = 'manami'
  AND ingested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY day ORDER BY day DESC;
```
Should show ~50–500 new rows per day for Manami.
