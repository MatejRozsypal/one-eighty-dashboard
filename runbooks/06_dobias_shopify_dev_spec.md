# Shopify Access Spec — Dr. Dobias / Peter De Baez

**Purpose:** read-only data access from Dr. Dobias's Shopify store into One Eighty's BigQuery warehouse for analytics dashboards. No writes, no order modifications, no customer messaging.

**Intended recipient:** the developer who manages Peter's Shopify store.

---

## What we need from you

A **Custom App access token** for the Dr. Dobias Shopify store, with the read-only scopes listed below. ~10 minutes of work in the Shopify admin.

We do NOT need:
- Shopify Partner account access
- App Store distribution
- A development store
- Any write permissions

---

## Step-by-step

### 1. Enable custom app development (if not already enabled)

Shopify admin → **Settings → Apps and sales channels → Develop apps** → click **Allow custom app development** → confirm.

(One-time per store. Skip if it's already enabled.)

### 2. Create the custom app

**Develop apps → Create an app**
- **App name:** `One Eighty Analytics`
- **App developer:** your account is fine

### 3. Configure Admin API scopes

In the new app → **Configuration → Admin API integration → Configure**.

Tick these read scopes (all read-only, no write):

| Scope | Why we need it |
|---|---|
| `read_orders` | order history, line items, legacy refunds, totals |
| `read_all_orders` | **critical** — without this, Shopify caps order history to last 60 days |
| `read_orders_edits` | order modification history (post-purchase edits, partial refunds breakdown) |
| `read_returns` | Shopify Returns API (2024-04+) — distinct from legacy refunds |
| `read_products` | product catalog, SKUs, variants |
| `read_inventory` | stock levels per SKU per location |
| `read_customers` | customer records, lifetime value calculation |
| `read_fulfillments` | shipment status, tracking |
| `read_discounts` | discount codes used per order |
| `read_price_rules` | discount rule definitions |
| `read_marketing_events` | marketing campaign performance attribution |
| `read_analytics` | Shopify's native analytics aggregates |
| `read_reports` | Shopify's pre-built reports (cohorts, sell-through, etc.) |
| `read_locations` | warehouse / location info for multi-location stores |
| `read_shipping` | shipping rates and zones |
| `read_shopify_payments_payouts` | **only if the store uses Shopify Payments** — payout reconciliation vs gross revenue |
| `read_shopify_payments_disputes` | **only if the store uses Shopify Payments** — chargebacks |

If the store is **not** on Shopify Payments (e.g. uses Stripe / Authorize.Net via Shopify), tick the two `shopify_payments_*` scopes anyway — they'll return empty data, no harm done. It's better than coming back later for a re-grant.

Save the configuration.

### 4. Install the app

App page → **API credentials → Install app**. Confirm.

### 5. Generate the Admin API access token

After install, the **Admin API access token** appears once on screen.

It looks like: `shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**This token is shown ONE TIME ONLY.** If you close the page without copying it, you have to uninstall and reinstall the app. Save it immediately.

### 6. Send us back

Three values, transmitted **securely** (1Password share, Bitwarden Send, or any zero-knowledge link — **NOT email, NOT Slack DM, NOT SMS**):

1. **Shop domain:** the `*.myshopify.com` URL (e.g. `dr-dobias-natural-pet-health.myshopify.com`) — NOT the customer-facing domain
2. **Admin API access token:** the `shpat_…` string from step 5
3. **API version:** whichever version is current at install time (Shopify shows it in the app config; e.g. `2025-01`)

---

## Security commitments from our side

- Token stored only in Google Cloud Secret Manager (encrypted at rest, audit-logged)
- Read-only service account access; no human reads the token in plain text
- Repository never contains the token (verified via GitHub secret scanning)
- We can rotate the token any time you ask — just generate a new one and uninstall the old app
- 90-day rotation reminder on our side regardless

---

## A few quick questions while you're in there

(Answers help us not bother you twice. If unsure on any, leave blank — we'll figure it out.)

1. **Payment processor:** Shopify Payments, Stripe, Authorize.Net, or other?
2. **Plan tier:** Basic / Shopify / Advanced / Plus?
3. **Multi-store / Shopify Markets active?** (Yes/No — affects how presentment_currency is interpreted)
4. **Approximate order volume per month?** (helps us size the initial backfill window)

---

## What we'll pull (for transparency)

- All historical orders (24 months back, then incremental daily)
- Products + variants + inventory snapshots (daily)
- Customer records (daily, no PII outside the secure pipeline — never lands in any browser)
- Marketing event metadata (daily)

Polling frequency: webhooks for real-time order events + a daily reconciliation pull at 03:00 PT. Average API call volume: <500 calls/day. Will not approach Shopify's rate limit.

---

## If something goes wrong

- **"Allow custom app development" greyed out:** the store owner has to enable it. That's Peter, not you.
- **Token shown but you didn't catch it:** uninstall the app, reinstall, regenerate. Token is destroyed; old token immediately invalid.
- **`read_all_orders` not appearing in scope list:** Shopify shows it only after you tick `read_orders`. Tick that one first.
- **Want to revoke later:** Apps and sales channels → One Eighty Analytics → Uninstall. Token is killed instantly.

---

Send the three values back to **matej@oneeighty.cz** via secure channel. Once we have them I'll confirm receipt and you can forget about this.
