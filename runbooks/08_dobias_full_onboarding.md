# Runbook 08 — Dr. Dobias Full Onboarding

End-to-end onboarding for Peter De Baez / Dr. Dobias as client #2. Three sources flowing into BigQuery: **Shopify** (e-commerce), **Klaviyo** (email), **Meta + IG** (paid + organic).

Assumes Manami (client #1) is already live across Shoptet + Ecomail + Meta Ads + IG media. Brief context in [CLAUDE_CODE_BRIEF.md].

**Total time:** ~60 minutes once all three sets of credentials are in hand.

---

## Pre-flight — what you need before starting

| Source | What you need | Who provides |
|---|---|---|
| Shopify | shop domain (`*.myshopify.com`), admin API access token (`shpat_...`), API version (`2025-01` or similar) | Dobias's developer (spec in [`06_dobias_shopify_dev_spec.md`](06_dobias_shopify_dev_spec.md)) |
| Klaviyo | API key (`pk_...`), region (`us`/`eu`), account ID | Dobias's developer (spec in [`09_klaviyo_dev_spec.md`](09_klaviyo_dev_spec.md)) |
| Meta + IG | Admin access on Dobias's Business Manager (or Peter does it himself) | Peter (or you, if he adds you as admin) |

---

## Step 1 — Add Dobias to `ref.clients`

If not already present, INSERT. If present (status=`onboarding`), UPDATE.

In BigQuery:

```sql
MERGE `oneeighty-warehouse.ref.clients` T
USING (
  SELECT
    'dobias' AS client_id,
    'dobias' AS slug,
    'Dr. Dobias Natural Pet Health' AS name,
    'CAD' AS currency,
    'America/Vancouver' AS timezone,
    'CA' AS country,
    'shopify' AS shop_platform,
    'klaviyo' AS email_platform
) S
ON T.client_id = S.client_id
WHEN MATCHED THEN UPDATE SET
  status = 'active',
  currency = S.currency,
  timezone = S.timezone,
  country = S.country,
  shop_platform = S.shop_platform,
  email_platform = S.email_platform,
  has_shopify = TRUE,
  has_klaviyo = TRUE,
  has_meta = TRUE,
  has_instagram = TRUE,
  updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT
  (client_id, slug, name, currency, timezone, country, shop_platform, email_platform,
   status, has_shopify, has_klaviyo, has_meta, has_instagram, created_at, updated_at)
VALUES
  (S.client_id, S.slug, S.name, S.currency, S.timezone, S.country, S.shop_platform, S.email_platform,
   'active', TRUE, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());
```

Verify:
```sql
SELECT * FROM `oneeighty-warehouse.ref.clients` WHERE slug='dobias';
```

---

## Step 2 — Shopify secrets (UI)

Per the existing Secret Manager flow (UI is faster than CLI if `gcloud` is misbehaving):

1. https://console.cloud.google.com/security/secret-manager?project=oneeighty-warehouse
2. **+ CREATE SECRET** — three secrets:

| Name | Value |
|---|---|
| `shopify-dobias-shop-domain` | `<store>.myshopify.com` (NOT customer-facing domain) |
| `shopify-dobias-access-token` | `shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `shopify-dobias-api-version` | `2025-01` (or whichever the dev provided) |

3. The `sa-n8n-writer` SA inherits Secret Manager Secret Accessor at project level — no per-secret permission grant needed.

---

## Step 3 — Klaviyo secrets (UI)

Same flow. Two secrets:

| Name | Value |
|---|---|
| `klaviyo-dobias-api-key` | `pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `klaviyo-dobias-region` | `us` or `eu` |

(The pre-existing `klaviyo-dr-dobias-*` placeholder secrets from the original brief can be **deleted**; we're standardizing on `klaviyo-dobias-*` to match the slug.)

---

## Step 4 — Meta App + System User for Dobias

**Important:** the existing Meta App (`One Eighty Warehouse`) is reusable across clients. You don't create a second app. You create a second **System User** inside **Dobias's Business Manager**.

If you're admin on Dobias's BM (preferred):

1. business.facebook.com → switch to **Dobias's Business Manager**.
2. Settings → Users → **System Users** → Add → name `oneeighty-warehouse` → role **Admin** → Create.
3. **Add Assets** → assign Dobias's:
   - Ad Account (View Performance)
   - Facebook Page (Analyze)
   - Instagram Business Account (View insights and content)
   - The **`One Eighty Warehouse` App** (Develop app permission) ← critical, otherwise tokens won't issue
4. **Generate New Token** → select `One Eighty Warehouse` app → tick all 7 scopes:
   - `ads_read`, `business_management`, `pages_read_engagement`, `pages_show_list`, `read_insights`, `instagram_basic`, `instagram_manage_insights`
5. Expiration: **Never** → Generate → copy.

Note the asset IDs as you go:
- **Ad Account ID:** `act_<number>`
- **Facebook Page ID:** numeric
- **Instagram Business Account ID:** numeric (the 17-digit one from Graph API, not the @username)

If Peter is admin and you're not: send him [`07_meta_app_and_system_user.md`](07_meta_app_and_system_user.md) — same instructions, he just substitutes "Dobias's BM" everywhere it says Manami's BM. He delivers the 6 values to you via 1Password Send or similar.

### Meta secrets for Dobias

6 secrets in Secret Manager:

| Name | Value |
|---|---|
| `meta-dobias-app-id` | (same as Manami — it's the same app) |
| `meta-dobias-app-secret` | (same as Manami — same app) |
| `meta-dobias-access-token` | the NEW System User token generated for Dobias's BM |
| `meta-dobias-ad-account-id` | `act_<number>` from his BM |
| `meta-dobias-fb-page-id` | numeric Page ID |
| `meta-dobias-ig-business-id` | numeric IG Business ID |

The `app-id` and `app-secret` are duplicated per client because the workflow keys them by slug — small waste of bytes, big win in code uniformity. Future clients work identically.

---

## Step 5 — Execute the workflows

The multi-tenant workflows auto-discover Dobias from `ref.clients` once the secrets are in place. No n8n changes required.

**Recommended order:**

1. **Shopify** (`wf_shopify_to_bigquery`) — Execute Workflow. 24-month backfill in 5–10 min. Verify:
   ```sql
   SELECT COUNT(*) AS rows, MIN(order_date) AS earliest, MAX(order_date) AS latest
   FROM `oneeighty-warehouse.raw.raw_shopify_orders`
   WHERE client_id='dobias' AND order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH);
   ```

2. **Klaviyo** (`wf_klaviyo_to_bigquery`) — Execute Workflow. Pulls all campaigns + flow snapshot. Verify:
   ```sql
   SELECT COUNT(*) AS rows, COUNT(DISTINCT campaign_id) AS ids
   FROM `oneeighty-warehouse.raw.raw_klaviyo_campaigns`
   WHERE client_id='dobias' AND DATE(send_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH);
   ```

3. **Meta Ads** (`wf_meta_ads_to_bigquery`) — Execute Workflow. Loops both clients; the Manami iteration is incremental, the Dobias iteration is fresh 90-day backfill. Verify:
   ```sql
   SELECT client_id, COUNT(*) AS rows, MIN(date_start) AS earliest, MAX(date_start) AS latest
   FROM `oneeighty-warehouse.raw.raw_meta_campaign_insights`
   WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
   GROUP BY client_id;
   ```

4. **Instagram** (`wf_instagram_to_bigquery`) — same pattern. Note: IG account insights branch may still be disabled per the FB/IG TODO doc; media branch is the priority.

5. **Facebook organic** — currently paused (see TODO doc).

---

## Step 6 — Backfill older Meta history (optional, manual)

If you want > 90 days of Meta Ads history for Dobias, do the 30-day chunk dance:

Edit `Fetch ad insights` and `Fetch campaign insights` time_range value, walk it backward in 30-day chunks:

```
{"since":"2026-01-12","until":"2026-02-12"}   ← chunk 1
{"since":"2025-12-12","until":"2026-01-12"}   ← chunk 2
{"since":"2025-11-12","until":"2025-12-12"}   ← chunk 3
...
```

Run workflow after each edit. About 24 chunks for 24 months. Restore the watermark-driven expression when done.

---

## Step 7 — Activate crons

Once all 24-month backfills are in:

1. In n8n, open each workflow → toggle **Active** (top-right).
2. They'll fire on their declared cron expressions automatically.

| Workflow | Cron |
|---|---|
| wf_shoptet (Manami only) | daily 04:00 CET |
| wf_ecomail (Manami only) | every 6h |
| wf_shopify (Dobias) | daily 10:00 UTC |
| wf_klaviyo (Dobias) | every 6h :20 |
| wf_meta_ads (both clients) | hourly :15 |
| wf_instagram (both clients) | every 6h :30 |

---

## Currency policy for Dobias — CAD throughout

Dobias trades in **CAD natively**. To keep analytics consistent, all of his revenue/spend metrics in BQ must arrive in CAD. Verify per source:

| Source | Where currency is set | Action |
|---|---|---|
| **`ref.clients.currency`** | `'CAD'` | Done by Step 1's MERGE above. |
| **Klaviyo** | Workflow uses `ctx.currency` from `ref.clients` → CAD. | No further action. Klaviyo itself stores conversions in whatever currency the Klaviyo account is configured for — confirm in Klaviyo admin: **Account → Settings → Brand assets → Default currency** must be **CAD**. |
| **Shopify** | Orders return in the **shop's native currency** (`currency` field) + the customer's `presentment_currency`. If Dobias's Shopify store is set to CAD, every order lands as CAD natively. | Confirm in Shopify admin: **Settings → General → Store currency = CAD**. If anything other than CAD, raise with the dev — we'd otherwise need FX conversion in the mart layer. |
| **Meta Ads** | Ad spend returns in the **ad account's currency** (set in Ads Manager when the ad account is created). Cannot be changed retroactively. | Verify in https://business.facebook.com → Settings → Accounts → Ad Accounts → Dobias's account → **Currency**. If it's USD, all `spend` and `purchase_value` from `wf_meta_ads` will be USD even though `ref.clients.currency='CAD'`. The mart layer would need to convert. If it's already CAD, no action. |
| **Instagram / FB organic** | No revenue figures. N/A. |

**If Meta ad account is USD and can't be changed:** flag it. Two options:
1. **Accept the mismatch in raw** (store as-is in USD), then **convert in mart** with FX rates from `ref.fx_rates` (table not yet created — would be a small DDL). Mart layer queries `JOIN ref.fx_rates ON fx_rates.date = insights.date_start AND fx_rates.from = 'USD' AND fx_rates.to = 'CAD'`. FX rates feed in via daily n8n cron from openexchangerates.org or similar.
2. **Don't convert, just label**. Mart presents Meta spend in USD with a clear label, leaves the analyst to mentally convert. Cheaper, less precise.

For Phase 1, option 2 is fine. Address option 1 when you have multiple non-CAD ad accounts to worry about.

---

## Step 8 — Connect Looker Studio

Once data is flowing, point Looker Studio at the BQ datasets:

1. https://lookerstudio.google.com → existing dashboard → **Resource → Manage added data sources → ADD A DATA SOURCE**.
2. **BigQuery → `oneeighty-warehouse` → `stg`** (or `raw` for now until stg views are built).
3. Pick tables as needed.
4. Duplicate one existing chart, swap its source to the new BQ-backed one, confirm numbers match (within 1%), iterate page by page.

For Dobias specifically: he gets his own dashboard (separate from Manami's) filtered to `client_id='dobias'`. Cross-client comparison dashboards filter by both.

---

## Failure modes / debugging

- **Shopify "X-Shopify-Access-Token invalid":** the dev's token didn't have `read_all_orders` scope, OR the token was regenerated and Secret Manager has the old one. Verify in Shopify admin → app → API credentials.
- **Klaviyo 401:** wrong API key OR wrong region. Test in curl: `curl -H "Authorization: Klaviyo-API-Key pk_..." -H "revision: 2024-10-15" https://a.klaviyo.com/api/campaigns/`.
- **Meta `#10 Application does not have permission`:** token scopes wrong — see `TODO_facebook_instagram_pending.md` debug steps.
- **BQ `Array specified for non-repeated field`:** Transform code outputting an array to a STRING column. Wrap with `JSON.stringify(...)`.
- **BQ `Could not parse '...' as a timestamp`:** ISO-with-T format failing on streaming insert. Use the `fmtTs` helper to convert `2026-04-22T15:21:31+0000` → `2026-04-22 15:21:31`.
- **Workflow "5 identical responses":** n8n's link-header pagination doesn't work for sources using body-based pagination. Disable pagination on the HTTP node.

---

## What's NOT in this runbook (still pending)

- IG account-level insights (token scope issue — `TODO_facebook_instagram_pending.md` §1)
- FB organic posts (Page Access Token + scope — TODO §2)
- FB Page Insights (deferred entirely — TODO §3)
- Klaviyo events ingestion (only campaigns + flows in v1 — events table designed in DDL but workflow doesn't populate yet; high volume, needs incremental design)
