#!/usr/bin/env python3
"""
shopify_products_transform.py — reshape a Shopify Bulk Operations products JSONL
into NEWLINE_DELIMITED_JSON matching the raw.raw_shopify_products schema
(one row per variant, carrying the variant's cost of goods).

Usage:
    python3 shopify_products_transform.py <input.jsonl> <output.jsonl> <client_id>

Input  : raw Shopify bulk JSONL. Product nodes and variant nodes on separate
         lines; a variant carries `__parentId` pointing at its product.
Output : one JSON object per variant, fields == columns of raw.raw_shopify_products.
         Load with: bq load --source_format=NEWLINE_DELIMITED_JSON \\
                           oneeighty-warehouse:raw.raw_shopify_products <output.jsonl>

`client_id` is a required argument for the same reason as in
shopify_bulk_transform.py: it was a constant reading "dobias", which is fine
with one client and mislabels every row of the second one.
"""
import json
import sys
from datetime import datetime, timezone

CLIENT_ID = None  # set from argv in main()
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
    global CLIENT_ID
    if len(sys.argv) != 4:
        sys.exit("usage: python3 shopify_products_transform.py <input.jsonl> <output.jsonl> <client_id>")
    src, dst, CLIENT_ID = sys.argv[1], sys.argv[2], sys.argv[3]

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
