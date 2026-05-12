# Klaviyo Access Spec — Dr. Dobias / Peter De Baez

**Purpose:** read-only Klaviyo data access into One Eighty's BigQuery warehouse for email analytics. Campaigns, flows, events.

**Intended recipient:** the developer / admin who manages Peter's Klaviyo account.

**Time:** ~3 minutes.

---

## What we need from you

A **Private API Key** scoped to read-only access. Three values delivered back:

1. **API Key:** the `pk_...` string from Klaviyo
2. **Region:** `us` (most Klaviyo accounts are US-region — confirm via the URL of the Klaviyo admin UI; if it's `https://www.klaviyo.com/...` it's US; if `https://eu.klaviyo.com/...` it's EU)
3. **Klaviyo account ID:** found in **Account Settings → API Keys → Public API Key**, the 6-character string (e.g. `XyZ123`)

---

## Step-by-step

### 1. Create the Private API Key

1. Klaviyo admin → top-right account menu → **Settings → API keys**.
2. Click **Create Private API Key**.
3. **Name:** `One Eighty Analytics`
4. **Access level:** **Custom Key** (NOT Full Access)
5. Tick **read-only** for these scopes:

| Scope | Why |
|---|---|
| Campaigns: Read-Only | Campaign sends + stats |
| Flows: Read-Only | Automated flow stats |
| Events: Read-Only | Individual engagement events (opens, clicks, conversions) |
| Lists: Read-Only | List metadata |
| Metrics: Read-Only | Metric definitions and aggregates |
| Profiles: Read-Only | Subscriber profiles (LTV calc, segmentation) |
| Segments: Read-Only | Segment definitions |
| Templates: Read-Only | Email template metadata |
| Catalogs: Read-Only | Product catalog (if applicable) |

Leave all other scopes unchecked (especially anything marked "Full" or "Write").

6. Click **Create**.

### 2. Copy the key

Klaviyo shows the key **once**. Format: `pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (starts with `pk_`).

**This key is shown ONE TIME ONLY.** Copy immediately into a secure store. If lost, you'll have to create a new one.

### 3. Send us back

Three values, transmitted **securely** (1Password share, Bitwarden Send, or any zero-knowledge link — **NOT email, NOT Slack DM, NOT SMS**):

1. **API Key:** `pk_...` from step 2
2. **Region:** `us` or `eu`
3. **Klaviyo account ID:** the 6-char string from Account Settings → API Keys → Public API Key

Send to **matej@oneeighty.cz**.

---

## Security commitments from our side

- Key stored only in Google Cloud Secret Manager (encrypted at rest, audit-logged)
- Read-only service account access; no human reads the key in plain text
- Repository never contains the key (verified via GitHub secret scanning)
- We can rotate the key any time you ask — generate a new one + we update Secret Manager, old one revoked
- 90-day rotation reminder on our side regardless

---

## What we'll pull (for transparency)

- All historical **campaigns** + per-campaign send stats (delivered, opens, clicks, unsubs, conversions, revenue)
- All **flows** with cumulative stats (refreshed daily — period-over-period derived from diffs)
- **Profile events** (filtered to engagement + revenue events: Received Email, Opened Email, Clicked Email, Unsubscribed, Placed Order)
- **Subscriber lists** with counts

Polling frequency: every 6 hours for campaigns + flows, daily for full profile sync.

Volumes: depends on store activity; rough estimate ~50k–200k events/month flowing into our warehouse. Klaviyo rate limit (60 req/min on default plan) is plenty.

---

## If something goes wrong

- **Key lost before copying:** create a new one in step 1, old one stays revoked.
- **Want to revoke later:** Settings → API Keys → find "One Eighty Analytics" → **Revoke**. Key dies instantly; our workflow stops working until a new key is provided.
- **Region question:** if you're unsure whether the account is US or EU, paste the URL of Klaviyo admin (just the domain) and we'll figure it out.

---

Send the three values back to **matej@oneeighty.cz** via secure channel. Once we have them I'll confirm receipt and you can forget about this.
