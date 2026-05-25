# 12 — Shopify historical backfill via Bulk Operations API

**One-off.** Exports Dr. Dobias's order history into `raw.raw_shopify_orders` in a
single pass — no pagination, no chunking. Shopify runs the export server-side and
hands back one JSONL file.

The ongoing daily sync stays with the n8n workflow `wf_shopify_to_bigquery.json`
(daily volume fits one page). This runbook is *only* for the historical load.

Run everything in **Google Cloud Shell**.

---

## Prerequisites

- `shopify-dobias-*` secrets in Secret Manager (done).
- `raw.raw_shopify_orders` migrated to the `line_items STRING` schema (done).
- The DATA WAREHOUSE Shopify app installed on the store (done).

---

## Step 0 — Get a token

```
SHOP=$(gcloud secrets versions access latest --secret=shopify-dobias-shop-domain --project=oneeighty-warehouse)
CID=$(gcloud secrets versions access latest --secret=shopify-dobias-client-id --project=oneeighty-warehouse)
CSEC=$(gcloud secrets versions access latest --secret=shopify-dobias-client-secret --project=oneeighty-warehouse)
TOKEN=$(curl -s -X POST "https://$SHOP/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" -d "client_id=$CID" -d "client_secret=$CSEC" \
  | jq -r .access_token)
echo "shop: $SHOP   token: ${TOKEN:0:10}…"
```

The token is valid 24h — long enough for the whole run.

---

## Step 1 — Write the bulk query

24-month window. To pull **all-time** history instead, delete the
`(query: "created_at:>=2024-05-18")` part entirely.

```
cat > bulk_query.graphql <<'EOF'
mutation {
  bulkOperationRunQuery(
    query: """
    {
      orders(query: "created_at:>=2024-05-18") {
        edges { node {
          id name createdAt updatedAt processedAt cancelledAt
          displayFinancialStatus displayFulfillmentStatus sourceName
          currencyCode presentmentCurrencyCode email
          totalPriceSet { shopMoney { amount } }
          subtotalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          customer { id numberOfOrders }
          shippingAddress { countryCodeV2 provinceCode }
          lineItems { edges { node {
            id sku title quantity
            originalUnitPriceSet { shopMoney { amount } }
            totalDiscountSet { shopMoney { amount } }
            product { id }
            variant { id }
          } } }
        } }
      }
    }
    """
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
EOF
```

---

## Step 2 — Submit it

```
jq -Rs '{query: .}' bulk_query.graphql | curl -s -X POST \
  "https://$SHOP/admin/api/2026-04/graphql.json" \
  -H "X-Shopify-Access-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- | tee /tmp/bulk_submit.json | jq .

OPID=$(jq -r '.data.bulkOperationRunQuery.bulkOperation.id' /tmp/bulk_submit.json)
echo "operation id: $OPID"
```

Expected: `bulkOperation.status` = `CREATED`, `userErrors` = `[]`.
**If `userErrors` is non-empty or there's a top-level `errors` array — stop and
send that to Claude.** It names the exact GraphQL field to fix.

---

## Step 3 — Poll until done

174k orders may take several minutes to ~30 min. This loop checks every 20s and
stops on its own:

```
while true; do
  RESP=$(jq -n --arg q "{ bulkOperation(id: \"$OPID\") { status objectCount fileSize url errorCode } }" '{query:$q}' \
    | curl -s -X POST "https://$SHOP/admin/api/2026-04/graphql.json" \
        -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" --data-binary @-)
  echo "$RESP" | jq -c .data.bulkOperation
  S=$(echo "$RESP" | jq -r .data.bulkOperation.status)
  [ "$S" = "COMPLETED" ] && { URL=$(echo "$RESP" | jq -r .data.bulkOperation.url); break; }
  [ "$S" = "FAILED" ]    && { echo "BULK OP FAILED — check errorCode above"; break; }
  sleep 20
done
echo "result url: ${URL:0:60}…"
```

---

## Step 4 — Download the JSONL

```
curl -s -o orders_bulk.jsonl "$URL"
echo "lines: $(wc -l < orders_bulk.jsonl)"
head -c 300 orders_bulk.jsonl; echo
```

---

## Step 5 — Transform to the warehouse schema

Create the transform script (canonical copy is in the repo at
`infra/shopify_bulk_transform.py`). Paste this whole block:

```
cat > shopify_bulk_transform.py <<'PYEOF'
#!/usr/bin/env python3
"""Reshape a Shopify Bulk Operations orders JSONL into raw.raw_shopify_orders rows."""
import json
import sys
from datetime import datetime, timezone

CLIENT_ID = "dobias"
INGEST_SOURCE = "backfill"
INGESTED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def gid(value):
    if not value:
        return ""
    return str(value).rsplit("/", 1)[-1]


def money(node, *path):
    cur = node
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    if cur in (None, ""):
        return None
    try:
        return float(cur)
    except (TypeError, ValueError):
        return None


def build_line_item(node):
    return {
        "line_item_id":       gid(node.get("id")),
        "product_id":         gid((node.get("product") or {}).get("id")),
        "variant_id":         gid((node.get("variant") or {}).get("id")),
        "sku":                node.get("sku") or "",
        "title":              node.get("title") or "",
        "quantity":           node.get("quantity") or 0,
        "price":              money(node, "originalUnitPriceSet", "shopMoney", "amount") or 0,
        "total_discount":     money(node, "totalDiscountSet", "shopMoney", "amount") or 0,
        "fulfillment_status": None,
    }


def build_row(order, line_items):
    created = order.get("createdAt") or ""
    customer = order.get("customer") or {}
    ship = order.get("shippingAddress") or {}
    try:
        returning = int(customer.get("numberOfOrders") or 0) > 1
    except (TypeError, ValueError):
        returning = None
    return {
        "client_id":             CLIENT_ID,
        "ingested_at":           INGESTED_AT,
        "ingest_source":         INGEST_SOURCE,
        "order_id":              gid(order.get("id")),
        "order_number":          order.get("name") or "",
        "order_date":            created[:10] if created else None,
        "created_at":            created or None,
        "updated_at":            order.get("updatedAt") or None,
        "processed_at":          order.get("processedAt") or None,
        "currency":              order.get("currencyCode") or "",
        "presentment_currency":  order.get("presentmentCurrencyCode") or order.get("currencyCode") or "",
        "subtotal_price":        money(order, "subtotalPriceSet", "shopMoney", "amount"),
        "total_shipping":        money(order, "totalShippingPriceSet", "shopMoney", "amount"),
        "total_tax":             money(order, "totalTaxSet", "shopMoney", "amount"),
        "total_discounts":       money(order, "totalDiscountsSet", "shopMoney", "amount"),
        "total_price":           money(order, "totalPriceSet", "shopMoney", "amount"),
        "customer_id":           gid(customer.get("id")),
        "customer_email":        order.get("email") or "",
        "is_returning_customer": returning,
        "shipping_country":      ship.get("countryCodeV2") or "",
        "shipping_province":     ship.get("provinceCode") or "",
        "financial_status":      order.get("displayFinancialStatus") or "",
        "fulfillment_status":    order.get("displayFulfillmentStatus") or "",
        "cancelled_at":          order.get("cancelledAt") or None,
        "source_name":           order.get("sourceName") or "",
        "line_items":            json.dumps(line_items, ensure_ascii=False),
        "payload_json":          json.dumps({**order, "lineItems": line_items}, ensure_ascii=False),
    }


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: python3 shopify_bulk_transform.py <input.jsonl> <output.jsonl>")
    src, dst = sys.argv[1], sys.argv[2]
    stats = {"orders": 0, "line_items": 0, "skipped": 0}
    cur_order = None
    cur_items = []
    with open(src, "r", encoding="utf-8") as f_in, open(dst, "w", encoding="utf-8") as f_out:
        def flush():
            if cur_order is not None:
                f_out.write(json.dumps(build_row(cur_order, cur_items), ensure_ascii=False) + "\n")
                stats["orders"] += 1
        for raw in f_in:
            raw = raw.strip()
            if not raw:
                continue
            try:
                node = json.loads(raw)
            except json.JSONDecodeError:
                stats["skipped"] += 1
                continue
            if "__parentId" in node:
                cur_items.append(build_line_item(node))
                stats["line_items"] += 1
            else:
                flush()
                cur_order = node
                cur_items = []
        flush()
    print(f"orders written : {stats['orders']}")
    print(f"line items     : {stats['line_items']}")
    if stats["skipped"]:
        print(f"unparseable lines skipped: {stats['skipped']}")
    print(f"output         : {dst}")


if __name__ == "__main__":
    main()
PYEOF
```

Run it:

```
python3 shopify_bulk_transform.py orders_bulk.jsonl orders_clean.jsonl
```

It rebuilds orders + line items, strips Shopify GIDs to numeric IDs, maps every
field to `raw_shopify_orders`, and writes `ingest_source='backfill'`. It streams,
so the file size doesn't matter. Output prints the order + line-item counts.

---

## Step 6 — Load into BigQuery

```
bq load --source_format=NEWLINE_DELIMITED_JSON \
  oneeighty-warehouse:raw.raw_shopify_orders orders_clean.jsonl
```

`raw_shopify_orders` is append-only; this just adds rows. The ~250 rows from the
n8n test runs stay — `stg_shopify_orders` dedups by `order_id`, keeping the latest
`ingested_at` (the bulk load wins).

---

## Step 7 — Verify

```
bq query --use_legacy_sql=false '
SELECT client_id, ingest_source,
       COUNT(*) AS row_count, COUNT(DISTINCT order_id) AS orders,
       MIN(order_date) AS min_date, MAX(order_date) AS max_date,
       ROUND(SUM(total_price),2) AS revenue,
       COUNTIF(line_items IS NULL OR line_items = "") AS missing_line_items
FROM `oneeighty-warehouse.raw.raw_shopify_orders`
WHERE order_date >= "2000-01-01"
GROUP BY client_id, ingest_source ORDER BY client_id, ingest_source'
```

Healthy result: `orders` count in the tens of thousands, `min_date` ≈ 24 months
back, `missing_line_items` = 0.

---

## Troubleshooting

- **`userErrors` names a field** — a GraphQL field name is off. Send it to Claude;
  one-line fix in `bulk_query.graphql`.
- **`A bulk query operation for this app and shop is already running`** — only one
  bulk op per shop at a time. Wait for it, or cancel via `bulkOperationCancel`.
- **`status: FAILED`, `errorCode: ACCESS_DENIED`** — a scope is missing; re-check
  the app's granted scopes include `read_orders` + `read_all_orders`.
- **`bq load` schema error** — a field in `orders_clean.jsonl` doesn't match the
  table. Send the error; likely a transform-script tweak.
