# Secret Manager — organization

All credentials for the warehouse live in Google Secret Manager (project: `oneeighty-warehouse`). This file documents naming, rotation, and access.

## Naming convention

```
<source>-<client_slug>-<key_name>
```

Examples:
- `shoptet-manami-client-id`
- `shoptet-manami-client-secret`
- `ecomail-manami-api-key`
- `shopify-dr-dobias-access-token`
- `klaviyo-dr-dobias-api-key`

System-wide secrets (not client-scoped) skip the slug:
- `slack-alerts-webhook`
- `n8n-webhook-signing-secret`

## Current secret inventory

### Manami (active — fill values now)
| Secret | What it is | Where to get |
|--------|-------------|---------------|
| `shoptet-manami-client-id` | Shoptet API OAuth client ID | Shoptet admin → API Settings |
| `shoptet-manami-client-secret` | Shoptet API OAuth client secret | Same screen, shown once |
| `shoptet-manami-shop-url` | e.g. `eshop.manami.cz` | The eshop's domain |
| `ecomail-manami-api-key` | Ecomail REST API key | Ecomail → Account → API |
| `ecomail-manami-region` | `eu` (default for `api2.ecomailapp.cz`) | Hardcoded value |

### Dr. Dobias (onboarding — placeholders until Peter responds)
| Secret | What it is | Where to get |
|--------|-------------|---------------|
| `shopify-dr-dobias-shop-domain` | e.g. `dr-dobias.myshopify.com` | Peter |
| `shopify-dr-dobias-access-token` | `shpat_…` Admin API access token | Peter (custom app install) |
| `klaviyo-dr-dobias-api-key` | Klaviyo private API key, scope: campaigns/flows/events read | Peter |
| `klaviyo-dr-dobias-region` | `us` (Klaviyo default) | Hardcoded |

### System-wide
| Secret | What it is |
|--------|-------------|
| `slack-alerts-webhook` | Optional. Slack webhook URL for `#data-alerts` |
| `sa-n8n-writer-key` | The `sa-n8n-writer` service account JSON, stored after creation |

## Rotation

- **Every 90 days** for source API keys (Shoptet, Ecomail, Shopify, Klaviyo)
- **Annually** for service account keys
- Reminder workflow `wf_secret_rotation_reminder` (built later) emails monthly with anything older than 80 days

## Access (IAM)

| Secret prefix | Service account | Role |
|----------------|------------------|------|
| `shoptet-*`, `ecomail-*`, `shopify-*`, `klaviyo-*`, `meta-*`, `gads-*`, `ga4-*`, `instagram-*` | `sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com` | Secret Manager Secret Accessor |
| `slack-*` | `sa-n8n-writer` | Secret Manager Secret Accessor |
| (none of the above) | `sa-frontend-reader` | Secret Manager Secret Accessor only on Google OAuth secrets |

Frontend service account does NOT have access to source API keys. It can only access its own OAuth credentials.

## What to do if a secret leaks

1. **Immediately** rotate the key at the source (Shopify admin, Ecomail admin, etc.)
2. Update the Secret Manager value (creates a new version automatically)
3. n8n picks up the new value on next workflow run (no restart needed)
4. Audit `ops.pipeline_log` for any unexpected runs in the leak window
5. Open a post-mortem in `runbooks/incidents/`

## Never

- Never commit a secret value to git, even temporarily
- Never paste a secret into chat (LLM transcripts get logged)
- Never store a secret in n8n's local credential store as the source of truth — n8n must read from Secret Manager
- Never grant `sa-frontend-reader` access to source API keys
