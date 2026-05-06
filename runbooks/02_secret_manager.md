# Runbook 02 — Secret Manager populated

**Time:** 20 minutes
**Prerequisite:** Runbook 01 done (GCP project + service accounts exist)
**Outcome:** All Manami credentials live in Secret Manager. Placeholders for Dr. Dobias. n8n can read both.

---

## Step 1 — Open Secret Manager

1. Cloud Console → search "Secret Manager" → open
2. Confirm you're in project `oneeighty-warehouse`
3. Click **CREATE SECRET** for each item below

## Step 2 — Manami secrets (FILL with real values)

| Secret name | Value source |
|--------------|---------------|
| `shoptet-manami-client-id` | Shoptet admin → API Settings → your API access |
| `shoptet-manami-client-secret` | Same screen, shown once at creation |
| `shoptet-manami-shop-url` | `eshop.manami.cz` (no protocol, no trailing slash) |
| `ecomail-manami-api-key` | Ecomail → Account → API → API Key |
| `ecomail-manami-region` | `eu` (constant — `api2.ecomailapp.cz`) |

**For each:**
1. **CREATE SECRET**
2. Name: exactly the secret name above
3. Secret value: paste the actual credential
4. Region: **eu**
5. **CREATE**

## Step 3 — Dr. Dobias placeholders (empty for now)

| Secret name | Initial value |
|--------------|----------------|
| `shopify-dr-dobias-shop-domain` | `PLACEHOLDER_AWAITING_PETER` |
| `shopify-dr-dobias-access-token` | `PLACEHOLDER_AWAITING_PETER` |
| `klaviyo-dr-dobias-api-key` | `PLACEHOLDER_AWAITING_PETER` |
| `klaviyo-dr-dobias-region` | `us` |

When Peter responds, edit each secret → **NEW VERSION** with the real value. n8n picks up the latest version automatically.

## Step 4 — Service-account JSON key

Stash the `sa-n8n-writer-key.json` you downloaded in Runbook 01:

1. **CREATE SECRET**
2. Name: `sa-n8n-writer-key`
3. Secret value: paste the **entire contents** of the JSON file (open in a text editor, copy all)
4. **CREATE**
5. **DELETE THE LOCAL FILE:** `rm ~/Desktop/sa-n8n-writer-key.json`

The key now exists exactly once, in Secret Manager. If your laptop dies, the key is fine.

## Step 5 — Verify access

```bash
# Confirm sa-n8n-writer can read its own secrets
gcloud secrets versions access latest --secret=ecomail-manami-api-key \
  --impersonate-service-account=sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com
```

Should print the API key value. If you get a permissions error, re-check Step 4 of Runbook 01 (Secret Manager Secret Accessor role on `sa-n8n-writer`).

## Step 6 — Audit

After populating all secrets, run:

```bash
gcloud secrets list --filter="name~shoptet OR name~ecomail OR name~shopify OR name~klaviyo OR name~sa-n8n"
```

Expected count: 10 secrets (5 Manami filled + 4 Dr Dobias placeholders + 1 SA key).

---

## How n8n reads these

In each workflow, the credential field references the secret by name:
```
{{ $secrets.ecomail_manami_api_key }}     // hyphens become underscores
```

Or via the "Google Cloud Secret Manager" community node — fetches at runtime, never persists.

## Rotation reminder

Set yourself a calendar event for **90 days from creation**:
- Rotate Shoptet client secret in Shoptet admin
- Update `shoptet-manami-client-secret` in Secret Manager (creates new version)
- Done. n8n's next run uses the new value automatically.

(Once `wf_secret_rotation_reminder` is built in Phase 5, this becomes automated.)
