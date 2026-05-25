# 13 — Shopify products + cost-of-goods backfill via Bulk Operations API

**One-off.** Exports Dr. Dobias's whole product catalogue — every variant with its
SKU, price, and **cost of goods** (`inventoryItem.unitCost`) — into
`raw.raw_shopify_products`. Same Bulk-API flow as runbook 12; the catalogue is
small, so it runs fast.

Once this lands, the mart SKU/product views can join orders → products on
`variant_id` to compute cost and margin per SKU.

Run everything in **Google Cloud Shell**.

---

## Step 0 — Token

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

---

## Step 1 — Write the bulk query

No date filter — we want the whole catalogue.

```
cat > products_query.graphql <<'EOF'
mutation {
  bulkOperationRunQuery(
    query: """
    {
      products {
        edges { node {
          id title productType vendor status createdAt updatedAt
          variants { edges { node {
            id sku title price compareAtPrice inventoryQuantity
            inventoryItem { unitCost { amount } }
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

## Step 2 — Submit

A bulk op for the orders run may still be flagged as the "current" one — that's
fine, only one runs at a time and the orders one is long done. If Step 2 says one
is *already running*, wait a minute and retry.

```
jq -Rs '{query: .}' products_query.graphql | curl -s -X POST \
  "https://$SHOP/admin/api/2026-04/graphql.json" \
  -H "X-Shopify-Access-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- | jq .
```

Expect `bulkOperation.status` = `CREATED`, `userErrors` = `[]`.
If `userErrors` names a field — stop, send it to Claude.

---

## Step 3 — Poll until done (catalogue is small — usually < 1 min)

```
while true; do
  RESP=$(curl -s -X POST "https://$SHOP/admin/api/2026-04/graphql.json" \
    -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"{ currentBulkOperation { status objectCount fileSize url errorCode } }"}')
  echo "$RESP" | jq -c .data.currentBulkOperation
  S=$(echo "$RESP" | jq -r .data.currentBulkOperation.status)
  [ "$S" = "COMPLETED" ] && { URL=$(echo "$RESP" | jq -r .data.currentBulkOperation.url); break; }
  [ "$S" = "FAILED" ]    && { echo "FAILED — check errorCode above"; break; }
  sleep 10
done
echo "result url: ${URL:0:60}…"
```

---

## Step 4 — Download

```
curl -s -o products_bulk.jsonl "$URL"
echo "lines: $(wc -l < products_bulk.jsonl)"
```

---

## Step 5 — Transform

Paste this whole block to create the script:

```
cat > shopify_products_transform.py <<'PYEOF'
#!/usr/bin/env python3
"""Reshape a Shopify Bulk products JSONL into raw.raw_shopify_products rows (one per variant)."""
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


def num(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_variant_row(product, variant):
    inv_item = variant.get("inventoryItem") or {}
    unit_cost = (inv_item.get("unitCost") or {}).get("amount")
    return {
        "client_id":          CLIENT_ID,
        "ingested_at":        INGESTED_AT,
        "ingest_source":      INGEST_SOURCE,
        "product_id":         gid(product.get("id")),
        "variant_id":         gid(variant.get("id")),
        "sku":                variant.get("sku") or "",
        "title":              product.get("title") or "",
        "product_type":       product.get("productType") or "",
        "vendor":             product.get("vendor") or "",
        "status":             product.get("status") or "",
        "price":              num(variant.get("price")),
        "compare_at_price":   num(variant.get("compareAtPrice")),
        "cost":               num(unit_cost),
        "inventory_quantity": variant.get("inventoryQuantity"),
        "created_at":         product.get("createdAt") or None,
        "updated_at":         product.get("updatedAt") or None,
        "payload_json":       json.dumps({"product": product, "variant": variant}, ensure_ascii=False),
    }


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: python3 shopify_products_transform.py <input.jsonl> <output.jsonl>")
    src, dst = sys.argv[1], sys.argv[2]
    stats = {"products": 0, "variants": 0, "with_cost": 0, "skipped": 0}
    cur_product = None
    with open(src, "r", encoding="utf-8") as f_in, open(dst, "w", encoding="utf-8") as f_out:
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
                if cur_product is None:
                    continue
                row = build_variant_row(cur_product, node)
                f_out.write(json.dumps(row, ensure_ascii=False) + "\n")
                stats["variants"] += 1
                if row["cost"] is not None:
                    stats["with_cost"] += 1
            else:
                cur_product = node
                stats["products"] += 1
    print(f"products                 : {stats['products']}")
    print(f"variants (rows written)  : {stats['variants']}")
    print(f"variants with a cost set : {stats['with_cost']}")
    if stats["skipped"]:
        print(f"unparseable lines skipped: {stats['skipped']}")
    print(f"output                   : {dst}")


if __name__ == "__main__":
    main()
PYEOF
```

Run it:

```
python3 shopify_products_transform.py products_bulk.jsonl products_clean.jsonl
```

**Read the output carefully** — `variants with a cost set` vs `variants` tells you
the COGS coverage. If most variants have no cost, Dr. Dobias hasn't filled the
"Cost per item" field in Shopify, and margin can't be computed until he does (or
until costs are supplied another way).

---

## Step 6 — Load into BigQuery

```
bq load --source_format=NEWLINE_DELIMITED_JSON \
  oneeighty-warehouse:raw.raw_shopify_products products_clean.jsonl
```

---

## Step 7 — Verify

```
bq query --use_legacy_sql=false '
SELECT client_id,
       COUNT(*) AS variant_rows,
       COUNT(DISTINCT product_id) AS products,
       COUNTIF(cost IS NOT NULL) AS variants_with_cost,
       ROUND(AVG(cost), 2) AS avg_cost,
       ROUND(AVG(price), 2) AS avg_price
FROM `oneeighty-warehouse.raw.raw_shopify_products`
WHERE DATE(ingested_at) >= "2000-01-01"
GROUP BY client_id'
```

Send Claude the Step 5 output and the Step 7 row — that confirms the catalogue +
cost coverage, and then the mart SKU/product views get the cost join (Stage 2).
