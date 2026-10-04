# one-eighty-dashboard

Multi-client marketing data warehouse + dashboard for One Eighty agency.

```
Sources → n8n (Hostinger VPS) → BigQuery → Looker Studio (Phase 1-3) + Vercel dashboard (Phase 4)
```

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Ingest | n8n on Hostinger VPS | Source-based workflows that loop over `ref.clients` |
| Warehouse | BigQuery (region EU) | `raw`, `raw_google_ads` (Google Ads transfer), `ref`, `stg`, `mart`, `ops`, `mart_qa` (regression sandbox, SOP step 7), plus GA4 exports `analytics_*` |
| Secrets | Google Secret Manager | Naming: `<source>-<client_slug>-<key_name>` |
| Dashboard (Phase 1-3) | Looker Studio | Reads BigQuery natively |
| Dashboard (Phase 4) | Next.js 14 on Vercel, `dashboard.oneeighty.cz` | Google SSO for `@oneeighty.cz`, plus email and password accounts (roles admin, agency, client) in Postgres. The session is checked in `app/(app)/layout.tsx`, there is no middleware |

## Repo layout

```
infra/
├── bigquery/         # Migrations, run in numeric order
│   └── live/         # Snapshot of the live views and tables (2026-10-04), the base for any view change
├── n8n/              # Workflow JSON exports
└── secrets/          # Secret Manager organization (no values committed)
runbooks/             # Click-by-click setup guides
dashboard/            # Next.js app (Phase 4), see dashboard/README.md
```

## Clients

Tracked in `ref.clients`. Adding a new client = one INSERT plus one UPDATE per source, no code changes. Each source is switched on by a `has_*` flag; Google Ads also needs `gads_customer_id` and `gads_currency` (runbook 17).

State on 2026-10-01 (the registry is the source of truth, this table is a snapshot):

| client_id | Name | Currency | Shop + email | Ads | Status |
|-----------|------|----------|--------------|-----|--------|
| `manami` | Manami s.r.o. | CZK | Shoptet + Ecomail | Meta + Google | active |
| `dobias` | Dr. Dobias Natural Pet Health | USD | Shopify + Klaviyo | Meta | active |
| `venev` | Venev | EUR | Shopify + Ecomail | Meta | active |
| `ethia` | Ethia | CZK | WooCommerce | Meta | active |
| `rawbark` | RawBark | CZK | WooCommerce | Google (Meta pending) | active |

Older snapshot kept from the repo (May 2026 seed, `infra/bigquery/003_seed_clients.sql`): `manami` (CZK, Shoptet + Ecomail, active) and `dr_dobias` (USD, Shopify + Klaviyo, onboarding). The table above uses the client_id `dobias`. Docs-merge flag 2026-10: confirm which id `ref.clients` holds today.

## Build sequence

1. Run `infra/bigquery/00*.sql` in order (creates datasets, registry, raw tables)
2. Set up Secret Manager per `runbooks/02_secret_manager.md`
3. Import n8n workflows from `infra/n8n/*.json`
4. First backfill: manually trigger each workflow with 24-month window
5. Connect Looker Studio to mart views
6. Deploy `dashboard/` to Vercel: `npx vercel --prod --yes` from the repo root (the Vercel project root directory is `dashboard/`). Git pushes do not deploy, see `VERCEL_DEPLOYS.md`

## Non-negotiables

- Every fact table has `client_id`. No exceptions.
- Every fact table is partitioned by date. No exceptions.
- Raw tables are append-only. Never UPDATE or DELETE.
- Credentials never live in BigQuery in plaintext. Always Secret Manager.
- n8n workflows loop over `ref.clients`. Never duplicate per client.
- Multi-currency: store raw at ingest. Convert in marts/frontend, never at ingest.
- Google Ads always queries `WHERE date < CURRENT_DATE()` (D-1 delay is unfixable).
- No account or client ids hardcoded in views. Google Ads account to client mapping lives in `ref.clients.gads_customer_id`; check `ops.v_gads_coverage` after onboarding.
- Efficiency metrics (MER, aMER, CAC) and CM3 divide by `paid_spend` (Meta + Google), never by `meta_spend` alone. Meta ROAS, CPA, CPC, CTR stay on `meta_spend`.

## Owners

- **Matěj Rožyšpal** (matej@oneeighty.cz), primary
- **Co-founder**, backup
