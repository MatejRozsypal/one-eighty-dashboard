#!/usr/bin/env python3
"""
shopify_bulk_transform.py — reshape a Shopify Bulk Operations JSONL export of
orders into NEWLINE_DELIMITED_JSON matching the raw.raw_shopify_orders schema.

Usage:
    python3 shopify_bulk_transform.py <input.jsonl> <output.jsonl> <client_id>

Input  : raw Shopify bulk JSONL. Order nodes and lineItem nodes are on separate
         lines; a child line item carries `__parentId` pointing at its order.
         Shopify emits each parent immediately followed by its children, so this
         streams (one order in memory at a time — safe for huge exports).
Output : one JSON object per order, fields == columns of raw.raw_shopify_orders.
         Load with: bq load --source_format=NEWLINE_DELIMITED_JSON \\
                            oneeighty-warehouse:raw.raw_shopify_orders <output.jsonl>

`client_id` is a required argument rather than a constant edited before each run.
It used to be hardcoded to "dobias", which is fine while one client exists and
silently catastrophic the moment a second one is backfilled — a forgotten edit
tags every row with the wrong client, and nothing downstream can tell.
"""
import json
import sys
from datetime import datetime, timezone

CLIENT_ID = None  # set from argv in main(); see module docstring
INGEST_SOURCE = "backfill"
INGESTED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def gid(value):
    """gid://shopify/Order/123 -> '123'.  None/'' -> ''."""
    if not value:
        return ""
    return str(value).rsplit("/", 1)[-1]


def money(node, *path):
    """Dig a MoneyBag (e.g. totalPriceSet -> shopMoney -> amount). None if absent."""
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
        # NULL for exports taken before totalRefundedSet was added to the bulk
        # query — which is every Dobias row. NULL means "never fetched", not
        # "nothing was refunded", and the marts must keep treating it that way.
        "total_refunded":        money(order, "totalRefundedSet", "shopMoney", "amount"),
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
    global CLIENT_ID
    if len(sys.argv) != 4:
        sys.exit("usage: python3 shopify_bulk_transform.py <input.jsonl> <output.jsonl> <client_id>")
    src, dst, CLIENT_ID = sys.argv[1], sys.argv[2], sys.argv[3]

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

    print(f"client_id      : {CLIENT_ID}")
    print(f"orders written : {stats['orders']}")
    print(f"line items     : {stats['line_items']}")
    if stats["skipped"]:
        print(f"unparseable lines skipped: {stats['skipped']}")
    print(f"output         : {dst}")


if __name__ == "__main__":
    main()
