# Runbook 24 — Venev full onboarding

Onboarding Venev (`venev`) as client #3. Czech cosmetics brand, Shopify store
opened **2022-06-24**, ~4 years of history to load.

Supersedes runbook 08's Shopify secret names, which were already wrong when they
were written — see §0.

**What makes Venev different from the first two clients:** it is the first client
whose **shop currency and ad-account currency disagree** (Shopify EUR, Meta CZK).
That is not cosmetic. `mart_daily_kpis` computes `CM2 = CM1 − meta_spend` and
`MER = revenue / paid_spend`; with revenue in EUR and spend in CZK those are
arithmetic across two currencies and produce a plausible, silently wrong number.
Handling is in §4.

---

## Source inventory

| Source | State | Notes |
|---|---|---|
| Shopify | ✅ secrets complete | `venevcosmetics.myshopify.com`, EUR, API 2026-07 |
| Meta Ads | ✅ secrets complete | ad account currency **CZK**, status ACTIVE |
| Instagram | ⛔ blocked | System User has no Page asset → no IG business id |
| Ecomail | ⛔ needs work | `wf_ecomail_to_bigquery` is hardcoded single-tenant |
| Klaviyo | ⏳ later | migration planned; secrets not created yet |
| Google Ads | ⏳ needs customer_id | via BigQuery DTS, not n8n |
| GA4 | ⏳ greenfield | not connected for any client; export cannot backfill |

---

## §0 — Secret names (runbook 08 is wrong)

Runbook 08 documents `shopify-<slug>-access-token`. The workflow does **not** read
that. `wf_shopify_to_bigquery` performs an OAuth `client_credentials` exchange and
reads four secrets:

```
shopify-venev-shop-domain      venevcosmetics.myshopify.com
shopify-venev-client-id
shopify-venev-client-secret
shopify-venev-api-version      2026-07
```

Meta reads exactly two (`app-id` / `app-secret` / `fb-page-id` are never read by
any workflow, despite runbook 08 listing them):

```
meta-venev-access-token
meta-venev-ad-account-id
```

Instagram additionally needs `meta-venev-ig-business-id` — **not yet created**.

Verify any client's secrets and what the credentials actually resolve to:

```bash
PROJECT=oneeighty-warehouse; SLUG=venev; GV=v22.0
get(){ gcloud secrets versions access latest --secret="$1" --project=$PROJECT 2>/dev/null; }
gcloud secrets list --project=$PROJECT --format='value(name)' | grep -E "^(shopify|meta|klaviyo|ecomail)-$SLUG-" | sort
SHOP=$(get shopify-$SLUG-shop-domain); VER=$(get shopify-$SLUG-api-version)
TOKEN=$(curl -s -X POST "https://$SHOP/admin/oauth/access_token" \
  -H 'Content-Type: application/x-www-form-urlencoded' -d grant_type=client_credentials \
  -d "client_id=$(get shopify-$SLUG-client-id)" -d "client_secret=$(get shopify-$SLUG-client-secret)" | jq -r .access_token)
curl -s "https://$SHOP/admin/api/$VER/shop.json" -H "X-Shopify-Access-Token: $TOKEN" \
  | jq -r '.shop | "\(.name) | \(.currency) | \(.iana_timezone) | \(.country_code) | since \(.created_at)"'
```

---

## §1 — Registry row (done)

```sql
-- status='onboarding' deliberately: wf_shopify filters WHERE status='active',
-- so the row exists for the backfill to reference without the cron picking it
-- up mid-load, and the dashboard (which also filters on active) stays clean.
MERGE `oneeighty-warehouse.ref.clients` T
USING (SELECT 'venev' AS client_id, 'venev' AS slug, 'Venev' AS name,
              'EUR' AS currency, 'Europe/Prague' AS timezone, 'CZ' AS country,
              'shopify' AS shop_platform, 'ecomail' AS email_platform) S
ON T.client_id = S.client_id
WHEN NOT MATCHED THEN INSERT
  (client_id, slug, name, currency, timezone, country, shop_platform, email_platform,
   status, has_shopify, has_shoptet, has_klaviyo, has_ecomail,
   has_meta, has_gads, has_ga4, has_instagram, created_at, updated_at)
VALUES
  (S.client_id, S.slug, S.name, S.currency, S.timezone, S.country, S.shop_platform,
   S.email_platform, 'onboarding', TRUE, FALSE, FALSE, FALSE,
   TRUE, FALSE, FALSE, FALSE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());
```

Flip `has_*` flags on only as each source actually lands. A flag that is TRUE
before data exists renders a dashboard card that cannot tell "broken pipeline"
from "genuinely zero".

---

## §2 — FX rates (done, migration 014)

`ref.fx_rates` gained `EUR→CZK` and `CZK→EUR`, 2022-06 .. current month, from
ČNB monthly averages. Without them the currency toggle is padlocked for Venev and
the Meta normalisation in §4 has no rate to join.

Migration 014 also filled the **missing current-month `USD→CZK` row** — migration
013 stopped at 2026-07, so from 1 August the toggle was already silently disabled
for every range touching this month, for Dobias too. Runbook 23 exists to prevent
exactly this and had not been run.

Still stale, not fixed here: **`CAD→USD` ends 2026-05**. It feeds
`stg_shopify_orders` for historical Canadian orders; those months resolve to NULL
revenue. Bank of Canada source, different procedure — see runbook 23.

---

## §3 — Shopify backfill (Cloud Shell)

The n8n workflow **cannot** do this: `Fetch orders` has pagination **off** with
`limit=250`, and its watermark floors at 730 days. It is an incremental daily
sync. History goes through the Bulk Operations API, same as runbook 12.

### 3.1 Token

```bash
PROJECT=oneeighty-warehouse; SLUG=venev
get(){ gcloud secrets versions access latest --secret="$1" --project=$PROJECT; }
SHOP=$(get shopify-$SLUG-shop-domain); VER=$(get shopify-$SLUG-api-version)
TOKEN=$(curl -s -X POST "https://$SHOP/admin/oauth/access_token" \
  -H 'Content-Type: application/x-www-form-urlencoded' -d grant_type=client_credentials \
  -d "client_id=$(get shopify-$SLUG-client-id)" -d "client_secret=$(get shopify-$SLUG-client-secret)" \
  | jq -r .access_token)
echo "shop $SHOP  api $VER  token ${TOKEN:0:8}…"
```

Token is valid 24h — long enough for the whole run.

### 3.2 Submit the bulk export

No `query:` filter on `orders` — this is the whole history. `totalRefundedSet` is
requested, which runbook 12's version did not: refunds are the warehouse's
biggest known data gap, and fetching them later means re-running this entire
export.

```bash
cat > bulk_query.graphql <<'EOF'
mutation {
  bulkOperationRunQuery(
    query: """
    {
      orders {
        edges { node {
          id name createdAt updatedAt processedAt cancelledAt
          displayFinancialStatus displayFulfillmentStatus sourceName
          currencyCode presentmentCurrencyCode email
          totalPriceSet { shopMoney { amount } }
          subtotalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
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

jq -Rs '{query: .}' bulk_query.graphql | curl -s -X POST \
  "https://$SHOP/admin/api/$VER/graphql.json" \
  -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary @- | tee /tmp/bulk_submit.json | jq .
OPID=$(jq -r '.data.bulkOperationRunQuery.bulkOperation.id' /tmp/bulk_submit.json)
```

`userErrors` must be `[]`. A non-empty one names the exact field to fix.

**`ACCESS_DENIED` here means the app lacks `read_all_orders`.** Shopify limits
apps without it to the last 60 days, which would silently produce a "successful"
backfill covering two months of a four-year history.

### 3.3 Poll, download, transform, load

```bash
while true; do
  RESP=$(jq -n --arg q "{ bulkOperation(id: \"$OPID\") { status objectCount fileSize url errorCode } }" '{query:$q}' \
    | curl -s -X POST "https://$SHOP/admin/api/$VER/graphql.json" \
        -H "X-Shopify-Access-Token: $TOKEN" -H "Content-Type: application/json" --data-binary @-)
  echo "$RESP" | jq -c .data.bulkOperation
  S=$(echo "$RESP" | jq -r .data.bulkOperation.status)
  [ "$S" = "COMPLETED" ] && { URL=$(echo "$RESP" | jq -r .data.bulkOperation.url); break; }
  [ "$S" = "FAILED" ] && { echo "FAILED — see errorCode"; break; }
  sleep 20
done
curl -s -o orders_bulk.jsonl "$URL"
wc -l orders_bulk.jsonl
```

Transform with the repo's `infra/shopify_bulk_transform.py`. **`client_id` is now a
required argument** — it used to be a constant hardcoded to `dobias`, which is a
silent catastrophe the second time it is used:

```bash
python3 shopify_bulk_transform.py orders_bulk.jsonl orders_venev.jsonl venev
bq load --source_format=NEWLINE_DELIMITED_JSON \
  oneeighty-warehouse:raw.raw_shopify_orders orders_venev.jsonl
```

### 3.4 Verify before trusting it

```sql
SELECT COUNT(*) AS orders, MIN(order_date) AS earliest, MAX(order_date) AS latest,
       COUNT(DISTINCT currency) AS currencies, ANY_VALUE(currency) AS currency,
       COUNTIF(total_refunded IS NOT NULL) AS with_refund_data
FROM `oneeighty-warehouse.raw.raw_shopify_orders`
WHERE client_id = 'venev';
```

`earliest` must be ~2022-06. If it is ~60 days ago, the `read_all_orders` scope is
missing and the export is a two-month sample wearing a four-year label.

---

## §3.5 — What the loaded data actually says

4,167 orders landed, all EUR, **2022-07-08 → 2026-06-25**, every one carrying
refund data. Two things in it need a decision rather than a fix:

**The store is close to dormant.** Orders by year: 2022 → 1,669 (€70k), 2023 →
2,010 (€86k), 2024 → 400 (€20k), 2025 → 59 (€2.9k), 2026 → 29 (€1.9k). The last
order is 25 June 2026. AOV ≈ €42. Meanwhile the Meta ad account is ACTIVE. An
active advertiser with five orders a month is either a business that has wound
down, or — more likely — **the wrong store**: `venevcosmetics.myshopify.com` may
be a legacy shop while the live one sits elsewhere. Confirm before building
anything on these numbers.

**70% of the history cannot reach the dashboard.** Every `stg` and `mart` view
filters `WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)`. Of
Venev's 4,167 orders, **2,936 (€119,375 of €181,250) fall outside that window** —
they are in `raw`, correct and complete, and invisible to everything downstream.
For Venev specifically the cut removes 2022 and most of 2023, which are its two
best years; the dashboard would show a brand that was always small rather than
one that shrank.

Widening the window to 60 months is a one-line change repeated across
`200_create_stg_views.sql`, `203`, `213`, `214` and `300_create_mart_views.sql`.
The cost is scan volume: `mart_daily_kpis` already reads ~150 MB per query, and
that grows roughly with the window.

**Two revenue bugs that Venev exposed — both now fixed (migrations 215, 216):**

*Cancelled orders counted as revenue.* Migration 100 filtered on payment status;
migration 203's rewrite dropped the filter, and every order has counted since,
for every client. Filtering on payment status is not the fix — Venev sells on
`Dobierka` (COD), where the courier takes the cash and Shopify leaves the order
PENDING or PARTIALLY_PAID forever, so 268 fulfilled orders would be deleted as
"unpaid". Cancellation is the criterion instead. Dobias −0.29%, Venev −€18,378.

*VAT counted as revenue.* `shop.taxesIncluded = true` for Venev, so its
`subtotal_price` already contained VAT while the project defines revenue as
ex-tax. Dobias, adding tax at checkout, was always correct. Venev −€16,175
(−9.9%); reconciles exactly: 146,697 + 16,175 = 162,872.

*Still open, deliberately:* the 715 unfulfilled PENDING orders from 2022
(~€31k) where a customer chose bank transfer and never paid. Almost certainly
not revenue, but "unfulfilled and unpaid" is a judgement about intent and the
conservative rule was chosen. Revisit if 2022 matters commercially.

*Noticed, not chased:* Dobias's `revenue + tax_collected` misses
`gross_revenue_incl_tax` by $12,125 (0.18%). Pre-existing and unrelated to these
changes — his revenue figure is identical before and after.

---

## §4 — The currency split (NOT yet built)

Shopify bills Venev in EUR, Meta in CZK, and `mart_daily_kpis` carries **one**
`currency` per row. The frontend's `fxSql` joins `fx.from_currency = k.currency`
and converts the whole row uniformly, so a row cannot hold two currencies.

Meta spend must therefore be normalised into EUR **in the mart**, leaving `raw`
untouched in CZK so the figures still reconcile against Ads Manager. The display
toggle then flips the whole row EUR↔CZK as it does for every other client.

Today the mart hardcodes ad-account currency per client:

```sql
-- 300_create_mart_views.sql:281, :466, :486
CASE WHEN client_id='manami' THEN 'CZK' WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END
```

Venev falls into `UNKNOWN`. Extending the CASE is **not** sufficient — it would
label the spend CZK correctly and still subtract it from EUR revenue. Required:

1. A per-source currency in `ref.clients` (e.g. `meta_currency`), ending the
   hardcoded CASE — this is runbook 18's refactor, now unavoidable.
2. Meta insight views join `ref.fx_rates` on
   `month_start = DATE_TRUNC(date, MONTH) AND from_currency = <meta ccy> AND to_currency = <client ccy>`
   and expose spend in the client's currency.
3. `mart_daily_kpis` consumes the normalised column, so CM2/CM3/MER/aMER/CAC are
   single-currency arithmetic again.

Until this lands, **do not enable `has_meta` in the dashboard for Venev.** Meta
data may be loaded into `raw`; it just must not reach a card that subtracts it
from EUR.

---

## §5 — Instagram (blocked)

`GET /me/accounts` returns an empty list for the Venev token: the System User has
no Page asset, so there is no IG business account to discover and
`meta-venev-ig-business-id` cannot be created.

Fix in Venev's Business Manager: *Settings → Users → System Users →
`oneeighty-warehouse` → Add Assets* → the Facebook Page (Analyze) and the
Instagram account (View insights and content). Then re-run the §0 verification
block; it prints the IG id.

---

## §6 — Ecomail (needs a refactor first)

`wf_ecomail_to_bigquery` is the only single-tenant workflow left: `CLIENT_ID =
'manami'` is hardcoded in its Code nodes and it authenticates with a fixed n8n
credential rather than a Secret Manager lookup by slug. It does not read
`ref.clients` at all.

Two options, and the choice depends on how soon Klaviyo replaces Ecomail:

- **Migration is weeks away** → skip Ecomail; pull the email history from Klaviyo
  once it is live, and never refactor a workflow that is about to be deleted.
- **Migration is months away** → refactor to the standard pattern (loop
  `ref.clients WHERE has_ecomail`, `ecomail-<slug>-api-key` from Secret Manager),
  matching every other workflow.

---

## §6.5 — GA4 and the domain map

Venev is one Shopify store behind several domains, confirmed from the store's
own Markets config rather than assumed:

| Market | Web presence | Locales |
|---|---|---|
| Czech Republic *(primary market)* | **venev.cz** | cs |
| United Kingdom | **venev.eu** | en, sl, hr, cs, **sk** |
| Slovakia, EU, Croatia, Slovenia, International | none — served by the above | |

So `venev.cz` and `venev.eu` are the same shop and their traffic sums. **`venev.sk`
is not a domain of this store at all** — no market points at it — yet a GA4
property exists for it. Until its hostname is checked against real data, its
traffic must not be divided into Shopify orders; the conversion rate would come
out nonsensically low.

The commercial shape makes the priority obvious: **88.9% of orders ship to
Slovakia** (3,706 of 4,167) and Slovak customers buy on **venev.eu**, the domain
with no GA4 link yet. Czechia — the *primary* market in Shopify — is 4.3%.

GA4 links created 2026-08-03 cover `venev.sk` (property `324879665`) and
`venev.cz` (`325992935`). Together those are under 5% of the business. The
property covering `venev.eu` is pending an access request.

**A client can therefore have several GA4 properties**, which the registry's
single `has_ga4` flag cannot express. Model it as `ref.ga4_properties`
(`property_id → client_id`), the same shape as the Google Ads
`customer_id → client_id` map, before wiring the first one up.

---

## §7 — Still open

| Item | Needed from |
|---|---|
| Google Ads `customer_id`, confirmation it sits under our MCC | Matěj |
| GA4 property id — and note the BQ export **cannot backfill**, so linking late costs history permanently | Matěj |
| Klaviyo migration date | Matěj |
| Whether Venev maintains `InventoryItem.cost` in Shopify — without it CM1/CM2/CM3, unit economics and payback stay empty | Matěj |
| Display name: registry says `Venev`; Shopify says `VENEV` | Matěj |
