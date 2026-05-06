# one-eighty-dashboard

Multi-client marketing data warehouse + dashboard for One Eighty agency.

```
Sources → n8n (Hostinger VPS) → BigQuery → Looker Studio (Phase 1-3) + Vercel dashboard (Phase 4)
```

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Ingest | n8n on Hostinger VPS | Source-based workflows that loop over `ref.clients` |
| Warehouse | BigQuery (region EU) | 5 datasets: `raw`, `ref`, `stg`, `mart`, `ops` |
| Secrets | Google Secret Manager | Naming: `<source>-<client_slug>-<key_name>` |
| Dashboard (Phase 1-3) | Looker Studio | Reads BigQuery natively |
| Dashboard (Phase 4) | Next.js 14 on Vercel | Google SSO restricted to `@oneeighty.cz` |

## Repo layout

```
infra/
├── bigquery/         # DDL files, run in numeric order
├── n8n/              # Workflow JSON exports
└── secrets/          # Secret Manager organization (no values committed)
runbooks/             # Click-by-click setup guides
dashboard/            # Next.js app (Phase 4)
```

## Clients

Tracked in `ref.clients`. Adding a new client = one INSERT, no code changes.

| client_id | Name | Currency | Stack | Status |
|-----------|------|----------|-------|--------|
| `manami` | Manami s.r.o. | CZK | Shoptet + Ecomail | active |
| `dr_dobias` | Dr. Dobias Natural Pet Health | USD | Shopify + Klaviyo | onboarding |

## Build sequence

1. Run `infra/bigquery/00*.sql` in order (creates datasets, registry, raw tables)
2. Set up Secret Manager per `runbooks/02_secret_manager.md`
3. Import n8n workflows from `infra/n8n/*.json`
4. First backfill — manually trigger each workflow with 24-month window
5. Connect Looker Studio to mart views
6. Deploy `dashboard/` to Vercel

## Non-negotiables

- Every fact table has `client_id`. No exceptions.
- Every fact table is partitioned by date. No exceptions.
- Raw tables are append-only. Never UPDATE or DELETE.
- Credentials never live in BigQuery in plaintext. Always Secret Manager.
- n8n workflows loop over `ref.clients`. Never duplicate per client.
- Multi-currency: store raw at ingest. Convert in marts/frontend, never at ingest.
- Google Ads always queries `WHERE date < CURRENT_DATE()` (D-1 delay is unfixable).

## Owners

- **Matěj Rožyšpal** (matej@oneeighty.cz) — primary
- **Co-founder** — backup
